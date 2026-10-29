import { describe, expect, it } from "vitest";
import type { Currency } from "../../types";
import { CURRENCIES, CURRENCY_LABELS, currencyLabel, zeroByCurrency } from "../../types";
import { fromMinor, sumByCurrency, toMinor } from "../../utils/num";
import {
  computePartyTotals,
  buildStatementRows,
  totalCashBalances,
  totalsByType,
} from "../engine";
import type { FinAccount, FinTransaction } from "../types";

const ACCOUNT_AFN: FinAccount = {
  id: "acc-afn",
  name: "صندوق افغانی",
  type: "cash",
  currency: "AFN",
  active: true,
  createdAt: 0,
  updatedAt: 0,
};
const ACCOUNT_IRT: FinAccount = { ...ACCOUNT_AFN, id: "acc-irt", name: "صندوق تومانی", currency: "IRT" };

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

describe("AFN (افغانی) — the third currency", () => {
  it("labels and constants cover all three currencies", () => {
    expect(CURRENCIES).toEqual(["IRT", "USD", "AFN"]);
    expect(CURRENCY_LABELS.AFN).toBe("افغانی");
    expect(currencyLabel("AFN")).toBe("افغانی");
    expect(currencyLabel(undefined)).toBe("");
  });

  it("AFN is integer-only like تومان (no cents)", () => {
    expect(toMinor(9_000, "AFN")).toBe(9_000);
    expect(fromMinor(9_000, "AFN")).toBe(9_000);
    // USD keeps its cents
    expect(toMinor(12.34, "USD")).toBe(1234);
    expect(fromMinor(1234, "USD")).toBe(12.34);
  });

  it("zeroByCurrency initializes every bucket", () => {
    const z = zeroByCurrency();
    expect(Object.keys(z).sort()).toEqual(["AFN", "IRT", "USD"]);
    expect(z.AFN).toBe(0);
  });

  it("sumByCurrency keeps افغانی separate from تومان and دلار", () => {
    const totals = sumByCurrency([
      { amount: 5_000_000, currency: "IRT" as Currency },
      { amount: 800, currency: "USD" as Currency },
      { amount: 9_500, currency: "AFN" as Currency },
      { amount: 2_500, currency: "AFN" as Currency },
    ]);
    expect(totals.IRT).toBe(5_000_000);
    expect(totals.USD).toBe(800);
    expect(totals.AFN).toBe(12_000);
  });

  it("AFN accounts balance and aggregate independently", () => {
    const accounts = [ACCOUNT_IRT, ACCOUNT_AFN];
    const txs = [
      tx({ type: "opening", destAccountId: "acc-irt", amount: 5_000_000 }),
      tx({ type: "opening", destAccountId: "acc-afn", amount: 20_000, currency: "AFN" }),
      tx({ type: "receipt", destAccountId: "acc-afn", amount: 4_500, currency: "AFN" }),
      tx({ type: "payment", sourceAccountId: "acc-afn", amount: 1_000, currency: "AFN" }),
    ];
    const totals = totalCashBalances(accounts, txs);
    expect(totals.IRT).toBe(5_000_000);
    expect(totals.AFN).toBe(23_500);
    expect(totals.USD).toBe(0);

    const byType = totalsByType(txs);
    expect(byType.totals.receipt?.AFN).toBe(4_500);
    expect(byType.totals.payment?.AFN).toBe(1_000);
    expect(byType.totals.opening?.AFN).toBe(20_000);
  });

  it("party statements run a per-currency balance including افغانی", () => {
    const txs = [
      tx({ type: "receipt", partyId: "p1", amount: 90_000, currency: "AFN", date: "2025-10-01" }),
      tx({ type: "payment", partyId: "p1", amount: 30_000, currency: "AFN", date: "2025-10-02" }),
      tx({ type: "receipt", partyId: "p1", amount: 1_000_000, date: "2025-10-03" }),
    ];
    const { closing, rows } = buildStatementRows("p1", txs);
    expect(closing.AFN).toBe(60_000);
    expect(closing.IRT).toBe(1_000_000);
    expect(rows[rows.length - 1].running.AFN).toBe(60_000);

    const totals = computePartyTotals("p1", txs);
    expect(totals.receipts.AFN).toBe(90_000);
    expect(totals.payments.AFN).toBe(30_000);
    expect(totals.net.AFN).toBe(60_000);
  });
});
