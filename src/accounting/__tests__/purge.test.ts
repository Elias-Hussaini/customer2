/**
 * deleteTransactionPermanently — «حذف دائمی از تاریخچه»:
 *  - plain final/cancelled/informational rows are simply deleted (effect gone);
 *  - a reversed original takes its counter with it (net effect zero);
 *  - a counter on its own is REFUSED (would silently change balances);
 *  - settlement parts are removed from outstanding items;
 *  - linked documents are detached (transactionId → null), never destroyed.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db/schema";
import {
  addAccDoc,
  cancelInformationalTx,
  createAccount,
  createOutstanding,
  postTransaction,
  reverseTransaction,
  deleteTransactionPermanently,
  type AccountInput,
} from "../repo";
import { computeAccountBalance } from "../engine";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function mkAccount(name: string, currency: "IRT" | "USD" = "IRT") {
  const input: AccountInput = {
    name,
    type: "cash",
    currency,
    active: true,
  };
  return createAccount(input);
}

async function balanceOf(accountId: string): Promise<number> {
  const account = await db.accAccounts.get(accountId);
  if (!account) return 0;
  const txs = await db.accTransactions.toArray();
  return computeAccountBalance(account, txs).balance;
}

describe("deleteTransactionPermanently", () => {
  it("deletes a plain final receipt and removes its effect from balances", async () => {
    const acc = await mkAccount("صندوق اصلی");
    const tx = await postTransaction({
      type: "receipt",
      amount: 500_000,
      currency: "IRT",
      date: "2025-03-01",
      affectsBalance: true,
      destAccountId: acc.id,
    });
    expect(await balanceOf(acc.id)).toBe(500_000);

    await deleteTransactionPermanently(tx.id);
    expect(await db.accTransactions.get(tx.id)).toBeUndefined();
    expect(await balanceOf(acc.id)).toBe(0);
  });

  it("deletes an informational (cancelled) record outright", async () => {
    const acc = await mkAccount("صندوق");
    const tx = await postTransaction({
      type: "withdrawal",
      amount: 10_000,
      currency: "IRT",
      date: "2025-03-02",
      affectsBalance: false,
    });
    await cancelInformationalTx(tx.id, "آزمایشی");
    expect((await db.accTransactions.get(tx.id))?.status).toBe("cancelled");

    await deleteTransactionPermanently(tx.id);
    expect(await db.accTransactions.get(tx.id)).toBeUndefined();
    expect(await balanceOf(acc.id)).toBe(0);
  });

  it("purges a reversed pair TOGETHER and keeps balances identical", async () => {
    const acc = await mkAccount("صندوق");
    const tx = await postTransaction({
      type: "receipt",
      amount: 800,
      currency: "IRT",
      date: "2025-03-03",
      affectsBalance: true,
      destAccountId: acc.id,
    });
    const before = await balanceOf(acc.id);
    const counter = await reverseTransaction(tx.id, "ثبت اشتباه");
    // original reversed + counter final → net zero vs before? No: before=800, after=0.
    expect(await balanceOf(acc.id)).toBe(0);

    await deleteTransactionPermanently(tx.id);
    expect(await db.accTransactions.get(tx.id)).toBeUndefined();
    expect(await db.accTransactions.get(counter.id)).toBeUndefined();
    // 800 in then 800 out then both rows gone → still 0, exactly as with the pair.
    expect(await balanceOf(acc.id)).toBe(0);
    expect(before).toBe(800);
  });

  it("REFUSES to delete a counter-reversal on its own", async () => {
    const acc = await mkAccount("صندوق");
    const tx = await postTransaction({
      type: "payment",
      amount: 5,
      currency: "IRT",
      date: "2025-03-04",
      affectsBalance: true,
      sourceAccountId: acc.id,
      overrideInsufficientFunds: true,
    });
    const counter = await reverseTransaction(tx.id, "اشتباه");
    await expect(deleteTransactionPermanently(counter.id)).rejects.toThrow(/تراکنش اصلی/);
    // nothing was deleted
    expect(await db.accTransactions.get(tx.id)).toBeDefined();
    expect(await db.accTransactions.get(counter.id)).toBeDefined();
    expect(await balanceOf(acc.id)).toBe(0);
  });

  it("removes settlement parts the deleted rows had created", async () => {
    const party = await db.accParties.add({
      id: "p1",
      code: "P-0001",
      type: "individual",
      name: "طرف حساب",
      tags: [],
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const acc = await mkAccount("صندوق");
    const item = await createOutstanding({
      kind: "receivable",
      partyId: "p1",
      amount: 1_000,
      currency: "IRT",
      dueDate: "2025-04-01",
      description: "باقی‌مانده",
    });
    void party;
    const tx = await postTransaction({
      type: "receipt",
      amount: 400,
      currency: "IRT",
      date: "2025-04-02",
      affectsBalance: true,
      destAccountId: acc.id,
      partyId: "p1",
      settlementOf: item.id,
    });
    // posting with settlementOf already records the settlement part
    const stored = await db.accOutstanding.get(item.id);
    expect(stored?.settlements.length).toBe(1);
    expect(stored?.settlements[0]?.transactionId).toBe(tx.id);

    await deleteTransactionPermanently(tx.id);
    const after = await db.accOutstanding.get(item.id);
    expect(after?.settlements.length).toBe(0);
    expect(after?.status).not.toBe("settled");
  });

  it("detaches linked documents instead of destroying them", async () => {
    const acc = await mkAccount("صندوق");
    const tx = await postTransaction({
      type: "receipt",
      amount: 100,
      currency: "IRT",
      date: "2025-03-05",
      affectsBalance: true,
      destAccountId: acc.id,
    });
    const doc = await addAccDoc({
      file: new File([new Uint8Array([1, 2, 3])], "رسید.jpg", { type: "image/jpeg" }),
      transactionId: tx.id,
    });
    await deleteTransactionPermanently(tx.id);
    const kept = await db.accDocs.get(doc.id);
    expect(kept).toBeDefined();
    expect(kept?.transactionId).toBeNull();
    expect(kept?.blob.size).toBe(3);
  });
});
