import type { Currency, Customer, Payment, Representative, VisaRequest } from "../types";
import { sumByCurrency } from "../utils/num";

export interface RepStats {
  total: number;
  issued: number;
  inProgress: number;
  rejected: number;
  customers: number;
  urgent: number;
}

export interface CurrencyBalance {
  currency: Currency;
  quoted: number;
  paid: number;
  balance: number;
}

/** Request-related counters for one representative. */
export function computeRepStats(
  repId: string,
  requests: VisaRequest[],
  urgentTagIds: Set<string>,
): RepStats {
  const own = requests.filter((r) => r.representativeId === repId);
  return {
    total: own.length,
    issued: own.filter((r) => r.issued).length,
    inProgress: own.filter((r) => !r.issued && !r.rejected).length,
    rejected: own.filter((r) => r.rejected && !r.issued).length,
    customers: new Set(own.map((r) => r.customerId)).size,
    urgent: own.filter((r) => r.tags.some((t) => urgentTagIds.has(t))).length,
  };
}

/** Quoted / paid / balance per currency — currencies never mix. */
export function computeBalances(
  requests: VisaRequest[],
  payments: Payment[],
): CurrencyBalance[] {
  const quoted = sumByCurrency(
    requests.filter((r) => r.quotedAmount != null).map((r) => ({
      amount: r.quotedAmount ?? 0,
      currency: r.currency ?? "IRT",
    })),
  );
  const paid = sumByCurrency(payments);
  const currencies = new Set<Currency>([
    ...requests.map((r) => r.currency ?? "IRT"),
    ...payments.map((p) => p.currency),
  ]);
  return [...currencies]
    .filter((c) => quoted[c] !== 0 || paid[c] !== 0)
    .map((currency) => ({
      currency,
      quoted: quoted[currency],
      paid: paid[currency],
      balance: quoted[currency] - paid[currency],
    }));
}

export interface DashboardStats {
  customers: number;
  representatives: number;
  requests: number;
  issued: number;
  inProgress: number;
  rejected: number;
  urgent: number;
  balances: CurrencyBalance[];
  lists: number;
}

export function computeDashboardStats(
  customers: Customer[],
  representatives: Representative[],
  requests: VisaRequest[],
  payments: Payment[],
  lists: number,
  urgentTagIds: Set<string>,
): DashboardStats {
  return {
    customers: customers.length,
    representatives: representatives.length,
    requests: requests.length,
    issued: requests.filter((r) => r.issued).length,
    inProgress: requests.filter((r) => !r.issued && !r.rejected).length,
    rejected: requests.filter((r) => r.rejected && !r.issued).length,
    urgent: requests.filter((r) => r.tags.some((t) => urgentTagIds.has(t))).length,
    balances: computeBalances(requests, payments),
    lists,
  };
}
