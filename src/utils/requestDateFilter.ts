/**
 * Date-basis filtering for visa requests.
 *
 * The from/to range pickers used to always compare against the registration
 * date (تاریخ ثبت). Users also need to filter by the date a visa was ISSUED
 * (تاریخ صدور) or REJECTED (تاریخ رد) — e.g. "visas issued today" before
 * exporting a report. This module is the single source of truth for that
 * logic across every filter surface (reports, requests list, list detail).
 */
import type { VisaRequest } from "../types";
import { dateFromIso, isoFromDate, todayIso } from "./jalali";

/** Which request date the from/to range applies to. */
export type RequestDateBasis = "registration" | "issued" | "rejected";

export const REQUEST_DATE_BASIS_OPTIONS: { value: RequestDateBasis; label: string }[] = [
  { value: "registration", label: "تاریخ ثبت" },
  { value: "issued", label: "تاریخ صدور" },
  { value: "rejected", label: "تاریخ رد" },
];

export function isRequestDateBasis(v: string): v is RequestDateBasis {
  return v === "registration" || v === "issued" || v === "rejected";
}

/** Persian label of a basis — single source for UI text and export subtitles. */
export function requestBasisLabel(basis: RequestDateBasis): string {
  return REQUEST_DATE_BASIS_OPTIONS.find((o) => o.value === basis)?.label ?? "تاریخ ثبت";
}

/** The date a range should be compared against for this request, per basis. */
export function requestBasisDate(
  r: Pick<VisaRequest, "registrationDate" | "issuedAt" | "rejectedAt">,
  basis: RequestDateBasis,
): string | null {
  if (basis === "issued") return r.issuedAt ?? null;
  if (basis === "rejected") return r.rejectedAt ?? null;
  return r.registrationDate;
}

/**
 * Range check. A request that lacks the basis date (e.g. not issued yet while
 * filtering by issuance date) never matches an active range.
 */
export function requestWithinRange(
  r: Pick<VisaRequest, "registrationDate" | "issuedAt" | "rejectedAt">,
  basis: RequestDateBasis,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (!from && !to) return true;
  const ref = requestBasisDate(r, basis);
  if (!ref) return false;
  if (from && ref < from) return false;
  if (to && ref > to) return false;
  return true;
}

/** Range-picker placeholders that reflect the active basis. */
export function basisRangePlaceholders(basis: RequestDateBasis): { from: string; to: string } {
  if (basis === "issued") return { from: "از تاریخ صدور", to: "تا تاریخ صدور" };
  if (basis === "rejected") return { from: "از تاریخ رد", to: "تا تاریخ رد" };
  return { from: "از تاریخ", to: "تا تاریخ" };
}

export interface QuickDateRange {
  key: "today" | "yesterday" | "d7" | "d30";
  label: string;
  from: string;
  to: string;
}

/** One-click ranges (امروز / دیروز / ۷ روز / ۳۰ روز) relative to today. */
export function quickDateRanges(): QuickDateRange[] {
  const today = dateFromIso(todayIso());
  if (!today) return [];
  const back = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return isoFromDate(d);
  };
  return [
    { key: "today", label: "امروز", from: back(0), to: back(0) },
    { key: "yesterday", label: "دیروز", from: back(1), to: back(1) },
    { key: "d7", label: "۷ روز اخیر", from: back(6), to: back(0) },
    { key: "d30", label: "۳۰ روز اخیر", from: back(29), to: back(0) },
  ];
}
