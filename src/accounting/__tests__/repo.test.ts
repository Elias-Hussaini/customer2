/**
 * Repository integration tests on fake-indexeddb — the critical financial
 * workflows end-to-end: atomic posting, balances, idempotency, reversal,
 * settlements, numbering and backup round-trip.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/schema";
import {
  cancelInformationalTx,
  createAccount,
  createOutstanding,
  createParty,
  editTransaction,
  postTransaction,
  reconcileAccount,
  removeSettlement,
  resetAccounting,
  reverseTransaction,
  settleOutstanding,
  TxValidationError,
} from "../repo";
import { computeAccountBalance, outstandingRemaining } from "../engine";
import { buildAccBackup, applyAccBackup } from "../backup";

async function balances() {
  const accounts = await db.accAccounts.toArray();
  const txs = await db.accTransactions.toArray();
  const out = new Map<string, number>();
  for (const a of accounts) {
    out.set(a.name, computeAccountBalance(a, txs).balance);
  }
  return out;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("parties", () => {
  it("creates individual and company accounts with sequential codes", async () => {
    const p1 = await createParty({ type: "individual", name: "علی رضایی", tags: [], active: true });
    const p2 = await createParty({ type: "company", name: "شرکت سفر", tags: [], active: true });
    expect(p1.code).toBe("P-0001");
    expect(p2.code).toBe("C-0002");
    expect(p1.id).not.toBe(p2.id);
  });

  it("requires a name", async () => {
    await expect(
      createParty({ type: "individual", name: "  ", tags: [], active: true }),
    ).rejects.toThrow();
  });
});

describe("transaction posting & balances", () => {
  it("receipt increases the destination account in USD cents", async () => {
    const account = await createAccount({
      name: "بانک دلاری",
      type: "bank",
      currency: "USD",
      active: true,
    });
    await postTransaction({
      type: "receipt",
      amount: 100.5,
      currency: "USD",
      date: "2025-10-01",
      affectsBalance: true,
      destAccountId: account.id,
    });
    expect((await balances()).get("بانک دلاری")).toBe(100.5);
  });

  it("payment and withdrawal decrease the source; informational does nothing", async () => {
    const account = await createAccount({
      name: "صندوق",
      type: "cash",
      currency: "IRT",
      active: true,
      openingBalance: 1_000_000,
      openingDate: "2025-01-01",
    });
    expect((await balances()).get("صندوق")).toBe(1_000_000); // opening = auditable tx

    await postTransaction({
      type: "payment",
      amount: 200_000,
      currency: "IRT",
      date: "2025-01-02",
      affectsBalance: true,
      sourceAccountId: account.id,
    });
    await postTransaction({
      type: "withdrawal",
      amount: 50_000,
      currency: "IRT",
      date: "2025-01-03",
      affectsBalance: true,
      sourceAccountId: account.id,
    });
    await postTransaction({
      type: "withdrawal",
      amount: 999_999,
      currency: "IRT",
      date: "2025-01-04",
      affectsBalance: false, // informational
    });
    expect((await balances()).get("صندوق")).toBe(750_000);
  });

  it("internal transfer preserves the total within the same currency", async () => {
    const a = await createAccount({ name: "صندوق A", type: "cash", currency: "IRT", active: true, openingBalance: 500_000 });
    const b = await createAccount({ name: "صندوق B", type: "cash", currency: "IRT", active: true, openingBalance: 100_000 });
    await postTransaction({
      type: "transfer",
      amount: 200_000,
      currency: "IRT",
      date: "2025-02-01",
      affectsBalance: true,
      sourceAccountId: a.id,
      destAccountId: b.id,
    });
    const map = await balances();
    expect(map.get("صندوق A")).toBe(300_000);
    expect(map.get("صندوق B")).toBe(300_000);
  });

  it("rejects a mixed-currency transfer outright", async () => {
    const irt = await createAccount({ name: "تومانی", type: "cash", currency: "IRT", active: true });
    const usd = await createAccount({ name: "دلاری", type: "bank", currency: "USD", active: true });
    await expect(
      postTransaction({
        type: "transfer",
        amount: 100,
        currency: "IRT",
        date: "2025-02-01",
        affectsBalance: true,
        sourceAccountId: irt.id,
        destAccountId: usd.id,
      }),
    ).rejects.toBeInstanceOf(TxValidationError);
  });

  it("exchange moves both sides with the recorded rate", async () => {
    const irt = await createAccount({ name: "تومانی", type: "cash", currency: "IRT", active: true, openingBalance: 100_000_000 });
    const usd = await createAccount({ name: "دلاری", type: "bank", currency: "USD", active: true });
    const tx = await postTransaction({
      type: "exchange",
      amount: 50_000_000,
      currency: "IRT",
      date: "2025-03-01",
      affectsBalance: true,
      sourceAccountId: irt.id,
      destAccountId: usd.id,
      destAmount: 1000,
      destCurrency: "USD",
      exchangeRate: 50_000,
    });
    expect(tx.exchangeRate).toBe(50_000);
    const map = await balances();
    expect(map.get("تومانی")).toBe(50_000_000);
    expect(map.get("دلاری")).toBe(1000);
  });

  it("blocks insufficient funds unless explicitly overridden (audited)", async () => {
    const account = await createAccount({ name: "کم", type: "cash", currency: "IRT", active: true, openingBalance: 100 });
    await expect(
      postTransaction({
        type: "payment",
        amount: 500,
        currency: "IRT",
        date: "2025-03-01",
        affectsBalance: true,
        sourceAccountId: account.id,
      }),
    ).rejects.toBeInstanceOf(TxValidationError);
    const withOverride = await postTransaction({
      type: "payment",
      amount: 500,
      currency: "IRT",
      date: "2025-03-01",
      affectsBalance: true,
      sourceAccountId: account.id,
      overrideInsufficientFunds: true,
    });
    expect(withOverride.reason).toContain("کسری");
    expect((await balances()).get("کم")).toBe(-400);
  });

  it("idempotency: the same key never posts twice", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    const input = {
      type: "receipt" as const,
      amount: 1000,
      currency: "IRT" as const,
      date: "2025-04-01",
      affectsBalance: true,
      destAccountId: account.id,
      idempotencyKey: "retry-1",
    };
    const first = await postTransaction(input);
    const second = await postTransaction({ ...input });
    expect(second.id).toBe(first.id);
    expect(await db.accTransactions.count()).toBe(1);
    expect((await balances()).get("صندوق")).toBe(1000);
  });

  it("transaction numbers are sequential and unique", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    const t1 = await postTransaction({ type: "receipt", amount: 1, currency: "IRT", date: "2025-10-01", affectsBalance: true, destAccountId: account.id });
    const t2 = await postTransaction({ type: "receipt", amount: 1, currency: "IRT", date: "2025-10-02", affectsBalance: true, destAccountId: account.id });
    expect(t1.number).not.toBe(t2.number);
    const numbers = (await db.accTransactions.toArray()).map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("reversal & cancellation", () => {
  it("reverses exactly once and restores the balance", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true, openingBalance: 0 });
    const original = await postTransaction({
      type: "receipt",
      amount: 250_000,
      currency: "IRT",
      date: "2025-05-01",
      affectsBalance: true,
      destAccountId: account.id,
    });
    expect((await balances()).get("صندوق")).toBe(250_000);

    const counter = await reverseTransaction(original.id, "ثبت اشتباه");
    expect(counter.reversalOf).toBe(original.id);
    expect((await balances()).get("صندوق")).toBe(0);

    const stored = (await db.accTransactions.get(original.id))!;
    expect(stored.status).toBe("reversed");
    expect(stored.reversedBy).toBe(counter.id);

    await expect(reverseTransaction(original.id, "دوباره")).rejects.toBeInstanceOf(TxValidationError);
    expect(await db.accTransactions.count()).toBe(2); // original + counter (no opening tx — balance was 0)
  });

  it("reason is mandatory for reversal", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    const tx = await postTransaction({ type: "receipt", amount: 10, currency: "IRT", date: "2025-05-01", affectsBalance: true, destAccountId: account.id });
    await expect(reverseTransaction(tx.id, "  ")).rejects.toBeInstanceOf(TxValidationError);
  });

  it("cancels informational records only", async () => {
    const info = await postTransaction({
      type: "payment",
      amount: 5,
      currency: "IRT",
      date: "2025-05-01",
      affectsBalance: false,
    });
    await cancelInformationalTx(info.id, "تکراری بود");
    expect((await db.accTransactions.get(info.id))!.status).toBe("cancelled");

    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    const real = await postTransaction({
      type: "payment",
      amount: 5,
      currency: "IRT",
      date: "2025-05-01",
      affectsBalance: true,
      sourceAccountId: account.id,
      overrideInsufficientFunds: true,
    });
    await expect(cancelInformationalTx(real.id, "x")).rejects.toBeInstanceOf(TxValidationError);
  });
});

describe("outstanding items & settlements", () => {
  it("partial settlements update status and remaining; over-settlement is capped", async () => {
    const party = await createParty({ type: "individual", name: "مشتری", tags: [], active: true });
    const item = await createOutstanding({
      kind: "receivable",
      partyId: party.id,
      amount: 1_000_000,
      currency: "IRT",
    });
    expect(item.status).toBe("open");

    await settleOutstanding(item.id, { amount: 400_000, date: "2025-06-01" });
    let stored = (await db.accOutstanding.get(item.id))!;
    expect(stored.status).toBe("partial");
    expect(outstandingRemaining(stored)).toBe(600_000);

    // Linked transaction settle — settlement auto-capped at remaining.
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    await postTransaction({
      type: "receipt",
      partyId: party.id,
      amount: 900_000, // more than remaining 600k
      currency: "IRT",
      date: "2025-06-02",
      affectsBalance: true,
      destAccountId: account.id,
      settlementOf: item.id,
    });
    stored = (await db.accOutstanding.get(item.id))!;
    expect(stored.settlements[1].amount).toBe(600_000); // capped
    expect(stored.status).toBe("settled");
    expect(outstandingRemaining(stored)).toBe(0);

    // Removing a settlement re-opens the remainder.
    await removeSettlement(item.id, stored.settlements[1].id);
    stored = (await db.accOutstanding.get(item.id))!;
    expect(stored.status).toBe("partial");
  });

  it("settlement cannot exceed the remaining amount (manual path)", async () => {
    const party = await createParty({ type: "individual", name: "مشتری", tags: [], active: true });
    const item = await createOutstanding({
      kind: "payable",
      partyId: party.id,
      amount: 100,
      currency: "USD",
    });
    await expect(
      settleOutstanding(item.id, { amount: 101, date: "2025-06-01" }),
    ).rejects.toThrow();
  });
});

describe("controlled edit", () => {
  it("audited edit updates the record and the derived balance", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true });
    const tx = await postTransaction({
      type: "receipt",
      amount: 100_000,
      currency: "IRT",
      date: "2025-07-01",
      affectsBalance: true,
      destAccountId: account.id,
    });
    await editTransaction(tx.id, {
      type: "receipt",
      amount: 150_000,
      currency: "IRT",
      date: "2025-07-01",
      affectsBalance: true,
      destAccountId: account.id,
    });
    expect((await balances()).get("صندوق")).toBe(150_000);

    // After reversal, editing must be refused.
    const reversed = await postTransaction({
      type: "receipt",
      amount: 10,
      currency: "IRT",
      date: "2025-07-02",
      affectsBalance: true,
      destAccountId: account.id,
    });
    await reverseTransaction(reversed.id, "test");
    await expect(
      editTransaction(reversed.id, {
        type: "receipt",
        amount: 20,
        currency: "IRT",
        date: "2025-07-02",
        affectsBalance: true,
        destAccountId: account.id,
      }),
    ).rejects.toBeInstanceOf(TxValidationError);
  });
});

describe("reconciliation", () => {
  it("records the difference as an audited adjustment transaction", async () => {
    const account = await createAccount({ name: "صندوق", type: "cash", currency: "IRT", active: true, openingBalance: 500_000 });
    const { difference, tx } = await reconcileAccount(account.id, 480_000, "شمارش نقدی");
    expect(difference).toBe(-20_000);
    expect(tx?.type).toBe("adjustment");
    expect((await balances()).get("صندوق")).toBe(480_000);

    const matching = await reconcileAccount(account.id, 480_000, "بازبینی");
    expect(matching.difference).toBe(0);
    expect(matching.tx).toBeNull();
  });
});

describe("backup round-trip", () => {
  it("build → wipe → restore(merge) brings everything back", async () => {
    const party = await createParty({ type: "company", name: "شرکت نمونه", tags: ["VIP"], active: true });
    const account = await createAccount({ name: "بانک", type: "bank", currency: "USD", active: true, openingBalance: 250 });
    await postTransaction({
      type: "receipt",
      partyId: party.id,
      amount: 120.5,
      currency: "USD",
      date: "2025-08-01",
      affectsBalance: true,
      destAccountId: account.id,
    });
    const backup = await buildAccBackup();
    expect(backup.counts.parties).toBe(1);
    expect(backup.counts.transactions).toBe(2); // opening + receipt

    // Simulate a data wipe.
    await db.transaction("rw", [db.accParties, db.accAccounts, db.accTransactions, db.accOutstanding], async () => {
      await db.accParties.clear();
      await db.accAccounts.clear();
      await db.accTransactions.clear();
      await db.accOutstanding.clear();
    });
    expect(await db.accTransactions.count()).toBe(0);

    const result = await applyAccBackup(backup.data, "merge");
    expect(result.inserted).toBe(4); // 1 party + 1 account + 2 tx
    const restored = await db.accTransactions.toArray();
    expect(restored.length).toBe(2);
    const map = await balances();
    expect(map.get("بانک")).toBe(370.5);
  });
});

describe("resetAccounting", () => {
  it("wipes every accounting table back to a clean slate and logs an activity", async () => {
    const party = await createParty({ type: "individual", name: "علی", tags: [], active: true });
    const account = await createAccount({
      name: "صندوق",
      type: "cash",
      currency: "IRT",
      active: true,
      openingBalance: 1_000,
      openingDate: "2025-08-01",
    });
    await createOutstanding({
      kind: "receivable",
      partyId: party.id,
      amount: 500,
      currency: "IRT",
      dueDate: "2025-09-01",
    });
    expect(await db.accTransactions.count()).toBeGreaterThan(0);
    expect(await db.accParties.count()).toBe(1);
    expect(await db.accOutstanding.count()).toBe(1);

    await resetAccounting();

    expect(await db.accParties.count()).toBe(0);
    expect(await db.accAccounts.count()).toBe(0);
    expect(await db.accTransactions.count()).toBe(0);
    expect(await db.accOutstanding.count()).toBe(0);
    expect(await db.accDocs.count()).toBe(0);
    expect(await db.accMeta.count()).toBe(0);
    const log = await db.activities.toArray();
    expect(log.some((a) => a.type === "acc-reset")).toBe(true);
  });
});
