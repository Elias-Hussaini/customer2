/**
 * Monthly statistics engine (آمار ماهانه) — pure, Jalali-native.
 *
 * Everything is bucketed by JALALI month: an ISO date lands in "1404-08"
 * (آبان ۱۴۰۴). Month lists are built oldest→newest including the current
 * month, correctly wrapping the year (اسفند ۱۴۰۴ → فروردین ۱۴۰۵).
 *
 * Money is summed with integer-safe minor units (dollars in cents) so the
 * charts never accumulate floating-point drift.
 */

import type { Currency, Customer, Payment, VisaRequest } from "../types";
import { JALALI_MONTHS, isoToJalali, toPersianDigits } from "../utils/jalali";
import { toGregorian } from "jalaali-js";
import { toMinor, fromMinor } from "../utils/num";

export interface MonthKey {
  /** "1404-08" — zero-padded, sorts lexicographically. */
  key: string;
  jy: number;
  jm: number;
  /** «آبان» */
  label: string;
  /** «آبان ۱۴۰۴» */
  fullLabel: string;
  /** First Gregorian ISO day of this Jalali month (chart tooltips). */
  startIso: string;
}

/** ISO date → Jalali month key, or null for garbage input. */
export function isoToMonthKey(iso: string | null | undefined): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return null;
  const j = isoToJalali(iso);
  return j ? `${j.jy}-${String(j.jm).padStart(2, "0")}` : null;
}

function monthKeyOf(jy: number, jm: number): string {
  return `${jy}-${String(jm).padStart(2, "0")}`;
}

/**
 * The last `count` Jalali months ending at (and including) `todayIso`'s
 * month — oldest first. Year wraps handled (1404-12 → 1405-01).
 */
export function buildRecentMonths(count: number, todayIsoStr: string): MonthKey[] {
  const j = isoToJalali(todayIsoStr);
  if (!j || count <= 0) return [];
  const out: MonthKey[] = [];
  let y = j.jy;
  let m = j.jm;
  for (let i = 0; i < count; i++) {
    out.unshift({
      key: monthKeyOf(y, m),
      jy: y,
      jm: m,
      label: JALALI_MONTHS[m - 1],
      fullLabel: `${JALALI_MONTHS[m - 1]} ${toPersianDigits(y)}`,
      startIso: jalaliFirstOfMonthIso(y, m),
    });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Gregorian ISO of day 1 of a Jalali month. */
function jalaliFirstOfMonthIso(jy: number, jm: number): string {
  const g = toGregorian(jy, jm, 1);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
}

/* ------------------------------ aggregation ------------------------------- */

export interface MonthAgg {
  key: string;
  label: string;
  fullLabel: string;
  /** New customers whose registrationDate falls in this month. */
  newCustomers: number;
  /** Requests whose registrationDate falls in this month. */
  newRequests: number;
  /** Visas ISSUED in this month (issuedAt; falls back to registration month). */
  issued: number;
  /** Applications REJECTED in this month (rejectedAt; falls back to registration month). */
  rejected: number;
  /** Documents/receipts created in this month (timestamps). */
  newDocs: number;
  /** Payments received this month — currencies never mix. */
  paidUSD: number;
  paidIRT: number;
}

export interface AggregateInput {
  months: MonthKey[];
  customers: Pick<Customer, "registrationDate">[];
  requests: Pick<VisaRequest, "registrationDate" | "issued" | "issuedAt" | "rejected" | "rejectedAt">[];
  payments: Pick<Payment, "date" | "amount" | "currency">[];
  /** Attachment createdAt timestamps (documents + receipts). */
  attachmentDates?: number[];
}

/** Timestamp → ISO (local time) without pulling the whole jalali util. */
function isoOfTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function aggregateMonthly(input: AggregateInput): MonthAgg[] {
  const rows = new Map<string, MonthAgg>(
    input.months.map((m) => [
      m.key,
      {
        key: m.key,
        label: m.label,
        fullLabel: m.fullLabel,
        newCustomers: 0,
        newRequests: 0,
        issued: 0,
        rejected: 0,
        newDocs: 0,
        paidUSD: 0,
        paidIRT: 0,
      },
    ]),
  );
  const bucket = (key: string | null): MonthAgg | undefined => (key ? rows.get(key) : undefined);

  for (const c of input.customers) {
    const b = bucket(isoToMonthKey(c.registrationDate));
    if (b) b.newCustomers++;
  }
  for (const r of input.requests) {
    const b = bucket(isoToMonthKey(r.registrationDate));
    if (b) b.newRequests++;
    if (r.issued) {
      const issuedKey = r.issuedAt ? isoToMonthKey(r.issuedAt) : isoToMonthKey(r.registrationDate);
      const ib = bucket(issuedKey);
      if (ib) ib.issued++;
    }
    if (r.rejected && !r.issued) {
      const rejKey = r.rejectedAt ? isoToMonthKey(r.rejectedAt) : isoToMonthKey(r.registrationDate);
      const rb = bucket(rejKey);
      if (rb) rb.rejected++;
    }
  }
  const minorByBucket = new Map<string, { usd: number; irt: number }>();
  for (const p of input.payments) {
    const key = isoToMonthKey(p.date);
    if (!key || !rows.has(key)) continue;
    const acc = minorByBucket.get(key) ?? { usd: 0, irt: 0 };
    if (p.currency === "USD") acc.usd += toMinor(p.amount, "USD");
    else acc.irt += toMinor(p.amount, "IRT");
    minorByBucket.set(key, acc);
  }
  for (const [key, acc] of minorByBucket) {
    const b = rows.get(key)!;
    b.paidUSD = fromMinor(acc.usd, "USD");
    b.paidIRT = acc.irt;
  }
  for (const ts of input.attachmentDates ?? []) {
    const b = bucket(isoToMonthKey(isoOfTimestamp(ts)));
    if (b) b.newDocs++;
  }
  return input.months.map((m) => rows.get(m.key)!);
}

/* -------------------------------- deltas ----------------------------------- */

/** Percentage change from prev → cur. null when previous is 0 (no baseline). */
export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Pretty compact money for chart labels: 2.4M / 850K (Persian digits). */
export function compactMoney(amount: number, currency: Currency): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  let body: string;
  if (abs >= 1_000_000_000) body = `${trim1(abs / 1_000_000_000)}B`;
  else if (abs >= 1_000_000) body = `${trim1(abs / 1_000_000)}M`;
  else if (abs >= 10_000) body = `${trim1(abs / 1_000)}K`;
  else body = abs.toLocaleString("fa-IR", { maximumFractionDigits: 1 });
  const unit = currency === "USD" ? "$" : "";
  return `${sign}${unit}${toPersianDigits(body)}`;
}

function trim1(n: number): string {
  return n.toLocaleString("fa-IR", { maximumFractionDigits: 1 });
}

/** Months ranked by issued visas (descending). */
export function topIssuedMonths(months: MonthAgg[], count = 3): MonthAgg[] {
  return [...months]
    .filter((m) => m.issued > 0)
    .sort((a, b) => b.issued - a.issued || (a.key < b.key ? -1 : 1))
    .slice(0, count);
}
