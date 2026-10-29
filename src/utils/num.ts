import type { Currency } from "../types";
import { CURRENCY_LABELS } from "../types";
import { toLatinDigits, toPersianDigits } from "./jalali";

/** Currencies that keep fractional major units (USD → cents). IRT and AFN
 *  are integer-only — one افغانی has no practical fractional use here. */
const FRACTIONAL = new Set<Currency>(["USD"]);

export function hasFractionalUnit(currency: Currency): boolean {
  return FRACTIONAL.has(currency);
}

/** Grouped number with Persian digits: 1234567 → «۱٬۲۳۴٬۵۶۷» */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "۰";
  return n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/** Money in major units → «۱٬۲۰۰ دلار» / «۵٬۰۰۰٬۰۰۰ تومان» / «۹٬۰۰۰ افغانی». */
export function formatMoney(amount: number | null | undefined, currency: Currency): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const decimals = hasFractionalUnit(currency) && !Number.isInteger(amount) ? 2 : 0;
  const n = amount.toLocaleString("fa-IR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${n} ${CURRENCY_LABELS[currency]}`;
}

export function formatAmountPlain(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  return toPersianDigits(amount.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

/** Parse typed money input (Persian/Arabic/Latin digits, separators) → number. */
export function parseAmountInput(text: string): number | null {
  const t = toLatinDigits(text).replace(/[,٬\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------------
 * Integer-safe money math. USD amounts are normalized to cents; IRT (toman)
 * and AFN (afghani) amounts are integers. Sums never accumulate floating
 * point drift.
 * ------------------------------------------------------------------------- */

export function toMinor(amount: number, currency: Currency): number {
  return hasFractionalUnit(currency) ? Math.round(amount * 100) : Math.round(amount);
}

export function fromMinor(minor: number, currency: Currency): number {
  return hasFractionalUnit(currency) ? Math.round(minor) / 100 : minor;
}

/** Normalize a typed amount to a safe storable value. */
export function normalizeAmount(amount: number, currency: Currency): number {
  return fromMinor(toMinor(amount, currency), currency);
}

export interface HasAmount {
  amount: number;
  currency: Currency;
}

/** Sum amounts per currency using integer minor units. Currencies never mix. */
export function sumByCurrency<T extends HasAmount>(items: T[]): Record<Currency, number> {
  const acc: Record<Currency, number> = { USD: 0, IRT: 0, AFN: 0 };
  for (const item of items) {
    if (!Number.isFinite(item.amount)) continue;
    acc[item.currency] += toMinor(item.amount, item.currency);
  }
  return {
    USD: fromMinor(acc.USD, "USD"),
    IRT: acc.IRT,
    AFN: acc.AFN,
  };
}

/** Sum a list of same-currency amounts safely. */
export function sumAmounts(amounts: number[], currency: Currency): number {
  let minor = 0;
  for (const a of amounts) minor += toMinor(a, currency);
  return fromMinor(minor, currency);
}
