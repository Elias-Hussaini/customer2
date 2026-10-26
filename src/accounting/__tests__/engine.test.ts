/** Pure financial-engine rule tests — no database involved. */

import { describe, expect, it } from "vitest";
import type { Currency } from "../../types";
import {
  buildReversalDraft,
  buildStatementRows,
  computeAccountBalance,
  computePartyTotals,
  countsTowardTotals,
  groupByPeriod,
  outstandingEffectiveStatus,
  outstandingRemaining,
  reversalCancelsExactly,
  totalCashBalances,
  totalsByType,
  txEffects,
  validateTx,
} from "../engine";
import type { FinAccount, FinTransaction, OutstandingItem } from "../types";

const ACCOUNT_IRT: FinAccount = {
  id: "acc-irt",
  name: "صندوق تومانی",
  type: "cash",
  currency: "IRT",
  active: true,
  createdAt: 0,
  updatedAt: 0,
};
const ACCOUNT_IRT2: FinAccount = { ...ACCOUNT_IRT, id: "acc-irt2", name: "بانک تومانی" };
const ACCOUNT_USD: FinAccount = {
  id: "acc-usd",
  name: "حساب دلاری",
  type: "bank",
  currency: "USD",
  active: true,
  createdAt: 0,
  updatedAt: 0,
};

let seq = 0;
function tx(partial: Partial<FinTransaction>): FinTransaction {
  return {
    id: `tx-${++seq}`,
    number: `TR-1404-${String(seq).padStart(4, "0")}`,
    type: "receipt",
    partyId: null,
    amount: 100,
    currency: "IRT",
    date: "2025-10-01",
    affectsBalance: true,
    status: "final",
    createdAt: seq,
    updatedAt: seq,
    ...partial,
  };
}

describe("txEffects — direction of every transaction type", () => {
  it("receipt increases the destination account", () => {
    const effects = txEffects(tx({ type: "receipt", destAccountId: "acc-irt", amount: 500 }));
    expect(effects).toEqual([{ accountId: "acc-irt", minor: 500 }]);
  });

  it("payment and withdrawal decrease the source account", () => {
    expect(txEffects(tx({ type: "payment", sourceAccountId: "acc-irt", amount: 200 }))).toEqual([
      { accountId: "acc-irt", minor: -200 },
    ]);
    expect(txEffects(tx({ type: "withdrawal", sourceAccountId: "acc-irt", amount: 50 }))).toEqual([
      { accountId: "acc-irt", minor: -50 },
    ]);
  });

  it("informational records have zero effects", () => {
    expect(
      txEffects(tx({ type: "receipt", destAccountId: "acc-irt", affectsBalance: false })),
    ).toEqual([]);
  });

  it("cancelled records have zero effects; REVERSED records keep theirs (the counter-entry nets them)", () => {
    expect(txEffects(tx({ type: "receipt", destAccountId: "acc-irt", status: "cancelled" }))).toEqual([]);
    // A reversed transaction really happened — its effects stay, and the
    // linked counter-transaction cancels them. Skipping it here would
    // double-subtract the counter entry.
    const reversed = txEffects(
      tx({ type: "receipt", destAccountId: "acc-irt", amount: 70, status: "reversed" }),
    );
    expect(reversed).toEqual([{ accountId: "acc-irt", minor: 70 }]);
  });

  it("transfer moves money between two accounts of the same currency", () => {
    const effects = txEffects(
      tx({ type: "transfer", sourceAccountId: "acc-irt", destAccountId: "acc-irt2", amount: 300 }),
    );
    expect(effects).toEqual([
      { accountId: "acc-irt", minor: -300 },
      { accountId: "acc-irt2", minor: 300 },
    ]);
  });

  it("exchange records both sides in their own currencies", () => {
    const effects = txEffects(
      tx({
        type: "exchange",
        sourceAccountId: "acc-irt",
        amount: 50_000_000,
        currency: "IRT",
        destAccountId: "acc-usd",
        destAmount: 1000,
        destCurrency: "USD",
        exchangeRate: 50_000,
      }),
    );
    expect(effects).toEqual([
      { accountId: "acc-irt", minor: -50_000_000 },
      { accountId: "acc-usd", minor: 100_000 }, // USD minor units = cents
    ]);
  });

  it("adjustment direction follows the account side", () => {
    expect(txEffects(tx({ type: "adjustment", destAccountId: "acc-irt", amount: 20 }))).toEqual([
      { accountId: "acc-irt", minor: 20 },
    ]);
    expect(txEffects(tx({ type: "adjustment", sourceAccountId: "acc-irt", amount: 20 }))).toEqual([
      { accountId: "acc-irt", minor: -20 },
    ]);
  });

  it("USD amounts use integer cents (no float drift)", () => {
    const effects = txEffects(
      tx({ type: "receipt", destAccountId: "acc-usd", amount: 0.1 + 0.2, currency: "USD" }),
    );
    expect(effects[0].minor).toBe(30);
  });
});

describe("computeAccountBalance — derived from transactions only", () => {
  it("opening + receipts − payments = balance", () => {
    const account: FinAccount = { ...ACCOUNT_IRT };
    const txs = [
      tx({ type: "opening", destAccountId: account.id, amount: 1_000_000, date: "2025-01-01" }),
      tx({ type: "receipt", destAccountId: account.id, amount: 500_000 }),
      tx({ type: "payment", sourceAccountId: account.id, amount: 200_000 }),
      tx({ type: "withdrawal", sourceAccountId: account.id, amount: 100_000 }),
      // Informational and cancelled rows must not count.
      tx({ type: "receipt", destAccountId: account.id, amount: 999, affectsBalance: false }),
      tx({ type: "receipt", destAccountId: account.id, amount: 999, status: "cancelled" }),
    ];
    const { balance, txCount } = computeAccountBalance(account, txs);
    expect(balance).toBe(1_200_000);
    expect(txCount).toBe(4);
  });
});

describe("validateTx — structural + currency rules", () => {
  const ctx = { accounts: [ACCOUNT_IRT, ACCOUNT_IRT2, ACCOUNT_USD] };

  it("receipt needs a destination account", () => {
    const res = validateTx({ type: "receipt", amount: 100, currency: "IRT", affectsBalance: true, sourceAccountId: null, destAccountId: null }, ctx);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("rejects a currency mismatch between transaction and account", () => {
    const res = validateTx({ type: "receipt", amount: 100, currency: "USD", affectsBalance: true, sourceAccountId: null, destAccountId: "acc-irt" }, ctx);
    expect(res.errors.some((e) => e.field === "destAccountId")).toBe(true);
  });

  it("informational records must not reference accounts", () => {
    const res = validateTx({ type: "withdrawal", amount: 100, currency: "IRT", affectsBalance: false, sourceAccountId: "acc-irt", destAccountId: null }, ctx);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("transfer: same account or mixed currencies are rejected", () => {
    expect(
      validateTx({ type: "transfer", amount: 10, currency: "IRT", affectsBalance: true, sourceAccountId: "acc-irt", destAccountId: "acc-irt" }, ctx).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateTx({ type: "transfer", amount: 10, currency: "IRT", affectsBalance: true, sourceAccountId: "acc-irt", destAccountId: "acc-usd" }, ctx).errors.some((e) => e.field === "currency"),
    ).toBe(true);
  });

  it("exchange: same currencies rejected, dest amount + rate required", () => {
    expect(
      validateTx({ type: "exchange", amount: 10, currency: "IRT", affectsBalance: true, sourceAccountId: "acc-irt", destAccountId: "acc-irt2", destAmount: 1, destCurrency: "IRT", exchangeRate: 1 }, ctx).errors.length,
    ).toBeGreaterThan(0);
    const missing = validateTx({ type: "exchange", amount: 10, currency: "IRT", affectsBalance: true, sourceAccountId: "acc-irt", destAccountId: "acc-usd", destAmount: null, destCurrency: "USD", exchangeRate: null }, ctx);
    expect(missing.errors.some((e) => e.field === "destAmount")).toBe(true);
    expect(missing.errors.some((e) => e.field === "exchangeRate")).toBe(true);
  });

  it("insufficient funds is a warning, not an error", () => {
    const balances = new Map([["acc-irt", { balance: 50, txCount: 1 }]]);
    const res = validateTx(
      { type: "payment", amount: 100, currency: "IRT", affectsBalance: true, sourceAccountId: "acc-irt", destAccountId: null },
      { accounts: ctx.accounts, balances },
    );
    expect(res.errors.length).toBe(0);
    expect(res.insufficientFunds).toBeDefined();
    expect(res.insufficientFunds!.available).toBe(50);
  });

  it("amount must be positive", () => {
    const res = validateTx({ type: "receipt", amount: 0, currency: "IRT", affectsBalance: true, sourceAccountId: null, destAccountId: "acc-irt" }, ctx);
    expect(res.errors.some((e) => e.field === "amount")).toBe(true);
  });
});

describe("reversals cancel exactly, once, for every type", () => {
  const cases: FinTransaction[] = [
    tx({ type: "receipt", destAccountId: "acc-irt", amount: 500 }),
    tx({ type: "payment", sourceAccountId: "acc-irt", amount: 300 }),
    tx({ type: "withdrawal", sourceAccountId: "acc-usd", amount: 75, currency: "USD" }),
    tx({ type: "transfer", sourceAccountId: "acc-irt", destAccountId: "acc-irt2", amount: 125 }),
    tx({
      type: "exchange",
      sourceAccountId: "acc-usd",
      amount: 200,
      currency: "USD",
      destAccountId: "acc-irt",
      destAmount: 10_000_000,
      destCurrency: "IRT",
      exchangeRate: 50_000,
    }),
    tx({ type: "adjustment", destAccountId: "acc-irt", amount: 40 }),
    tx({ type: "adjustment", sourceAccountId: "acc-irt", amount: 40 }),
    tx({ type: "opening", destAccountId: "acc-usd", amount: 900, currency: "USD" }),
  ];

  it.each(cases)("reversal of %s #%d cancels exactly", (original) => {
    const draft = buildReversalDraft(original);
    const counter: FinTransaction = {
      ...tx({
        type: draft.type,
        amount: draft.amount,
        currency: draft.currency,
        sourceAccountId: draft.sourceAccountId ?? null,
        destAccountId: draft.destAccountId ?? null,
        affectsBalance: draft.affectsBalance,
        destAmount: draft.destAmount ?? null,
        destCurrency: draft.destCurrency ?? null,
        exchangeRate: draft.exchangeRate ?? null,
      }),
      reversalOf: original.id,
    };
    expect(reversalCancelsExactly(original, counter)).toBe(true);
  });
});

describe("party statements", () => {
  it("totals per currency exclude reversed/cancelled and compute net", () => {
    const txs = [
      tx({ type: "receipt", partyId: "p1", amount: 1_000_000, currency: "IRT" }),
      tx({ type: "payment", partyId: "p1", amount: 400_000, currency: "IRT" }),
      tx({ type: "receipt", partyId: "p1", amount: 150, currency: "USD" }),
      tx({ type: "receipt", partyId: "p1", amount: 999_999, status: "cancelled" }),
      tx({ type: "payment", partyId: "other", amount: 1 }),
    ];
    const totals = computePartyTotals("p1", txs);
    expect(totals.receipts.IRT).toBe(1_000_000);
    expect(totals.payments.IRT).toBe(400_000);
    expect(totals.net.IRT).toBe(600_000);
    expect(totals.receipts.USD).toBe(150);
    expect(totals.net.USD).toBe(150);
    expect(totals.count).toBe(3);
  });

  it("statement rows carry a running balance in date order", () => {
    const txs = [
      tx({ type: "receipt", partyId: "p1", amount: 100, date: "2025-01-03" }),
      tx({ type: "payment", partyId: "p1", amount: 30, date: "2025-01-01" }),
      tx({ type: "receipt", partyId: "p1", amount: 200, currency: "USD", date: "2025-01-02" }),
    ];
    const { rows, closing } = buildStatementRows("p1", txs);
    expect(rows.map((r) => r.tx.date)).toEqual(["2025-01-01", "2025-01-02", "2025-01-03"]);
    expect(rows[2].running.IRT).toBe(70);
    expect(rows[1].running.USD).toBe(200);
    expect(closing.IRT).toBe(70);
    expect(closing.USD).toBe(200);
  });
});

describe("outstanding items", () => {
  const item = (settlements: number[], partials: Partial<OutstandingItem> = {}): OutstandingItem => ({
    id: "o1",
    kind: "receivable",
    partyId: "p1",
    amount: 1_000,
    currency: "IRT",
    status: "open",
    settlements: settlements.map((amount, i) => ({
      id: `s${i}`,
      amount,
      date: "2025-01-01",
    })),
    createdAt: 0,
    updatedAt: 0,
    ...partials,
  });

  it("remaining = amount − settlements", () => {
    expect(outstandingRemaining(item([]))).toBe(1000);
    expect(outstandingRemaining(item([300, 200]))).toBe(500);
  });

  it("status derives open / partial / overdue", () => {
    const today = "2025-06-01";
    expect(outstandingEffectiveStatus(item([]), today)).toBe("open");
    expect(outstandingEffectiveStatus(item([100]), today)).toBe("partial");
    expect(
      outstandingEffectiveStatus(item([], { dueDate: "2025-05-01" }), today),
    ).toBe("overdue");
    expect(
      outstandingEffectiveStatus(item([100], { dueDate: "2025-05-01" }), today),
    ).toBe("overdue");
    // Fully settled → not overdue even with a past due date.
    expect(
      outstandingEffectiveStatus(item([1000], { dueDate: "2025-05-01" }), today),
    ).toBe("settled");
  });
});

describe("aggregations", () => {
  it("totalCashBalances keeps the two currencies apart", () => {
    const accounts = [ACCOUNT_IRT, ACCOUNT_USD];
    const txs = [
      tx({ type: "opening", destAccountId: "acc-irt", amount: 5_000_000 }),
      tx({ type: "opening", destAccountId: "acc-usd", amount: 500, currency: "USD" }),
      tx({ type: "receipt", destAccountId: "acc-usd", amount: 12.34, currency: "USD" }),
    ];
    const totals = totalCashBalances(accounts, txs);
    expect(totals.IRT).toBe(5_000_000);
    expect(totals.USD).toBe(512.34);
  });

  it("groupByPeriod buckets by day/week/month/year with Saturday weeks", () => {
    const txs = [
      tx({ date: "2025-10-25" }), // Saturday
      tx({ date: "2025-10-26" }), // Sunday — same Iranian week
      tx({ date: "2025-11-02" }),
    ];
    const weeks = groupByPeriod(txs, "week", (iso) => iso);
    expect(weeks.length).toBe(2);
    expect(weeks[0].count).toBe(2);
    const months = groupByPeriod(txs, "month", (iso) => iso.slice(0, 7));
    expect(months.length).toBe(2);
  });

  it("reversed transactions and their counter-entries are excluded from totals (refunds subtract from income/expense)", () => {
    const original = tx({
      type: "receipt",
      destAccountId: "acc-irt",
      amount: 5_000_000,
      date: "2025-10-01",
    });
    const counter = tx({
      type: "payment",
      sourceAccountId: "acc-irt",
      amount: 5_000_000,
      date: "2025-10-02",
      status: "final",
      reversalOf: original.id,
    });
    const reversedOriginal = { ...original, status: "reversed" as const, reversedBy: counter.id };
    const otherReceipt = tx({ type: "receipt", destAccountId: "acc-irt", amount: 2_000_000 });

    // Before reversal: 7M receipts.
    const before = totalsByType([original, otherReceipt]);
    expect(before.totals.receipt?.IRT).toBe(7_000_000);

    // After reversal: only the untouched 2M receipt counts — neither the
    // reversed original nor its counter-entry may inflate either side.
    const after = totalsByType([reversedOriginal, counter, otherReceipt]);
    expect(after.totals.receipt?.IRT).toBe(2_000_000);
    expect(after.totals.payment?.IRT).toBeUndefined();
    expect(after.count.receipt).toBe(1);
    expect(after.count.payment).toBeUndefined();

    // Balance still nets to zero through the counter-entry (unchanged rule).
    const balance = computeAccountBalance(ACCOUNT_IRT, [reversedOriginal, counter, otherReceipt]);
    expect(balance.balance).toBe(2_000_000);

    expect(countsTowardTotals(reversedOriginal)).toBe(false);
    expect(countsTowardTotals(counter)).toBe(false);
    expect(countsTowardTotals(otherReceipt)).toBe(true);
  });

  it("groupByPeriod ignores reversals so charts show real activity only", () => {
    const original = tx({ type: "receipt", date: "2025-10-01", destAccountId: "acc-irt" });
    const reversed = { ...original, status: "reversed" as const, reversedBy: "c1" };
    const counter = tx({ type: "payment", date: "2025-10-01", reversalOf: original.id });
    const live = tx({ type: "receipt", date: "2025-10-01", destAccountId: "acc-irt", amount: 50 });

    const days = groupByPeriod([reversed, counter, live], "day", (iso) => iso);
    expect(days.length).toBe(1);
    expect(days[0].count).toBe(1);
    expect(days[0].receipts.IRT).toBe(50);
  });
});
