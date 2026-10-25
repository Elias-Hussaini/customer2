import {
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian,
  toJalaali,
} from "jalaali-js";

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

/** Persian week starts on Saturday. */
export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function toLatinDigits(input: string): string {
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in the local timezone as ISO yyyy-mm-dd. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateFromIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidIso(iso: string | null | undefined): iso is string {
  if (!iso) return false;
  return dateFromIso(iso) !== null;
}

export interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
}

export function isoToJalali(iso: string | null | undefined): JalaliParts | null {
  const d = iso ? dateFromIso(iso) : null;
  if (!d) return null;
  return toJalaali(d);
}

export function jalaliToIso(jy: number, jm: number, jd: number): string | null {
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

export type JalaliStyle = "numeric" | "long" | "medium";

/** Format an ISO date for display: numeric → ۱۴۰۳/۰۸/۱۵، long → ۱۵ آبان ۱۴۰۳، medium → ۱۵ آبان */
export function formatJalali(iso: string | null | undefined, style: JalaliStyle = "numeric"): string {
  const j = isoToJalali(iso);
  if (!j) return "—";
  if (style === "numeric") return toPersianDigits(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`);
  if (style === "medium") return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
  return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`;
}

/** Parse free-form Jalali input like "۱۴۰۳/۸/۱۵" or "1403-8-15" → ISO. */
export function parseJalaliInput(text: string): string | null {
  const t = toLatinDigits(text).replace(/[^\d]/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!t) return null;
  const parts = t.split("/").map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [jy, jm, jd] = parts;
  if (jy < 100) return null; // require full year
  return jalaliToIso(jy, jm, jd);
}

/** 0 = Saturday … 6 = Friday */
export function jalaliWeekdayIndex(iso: string): number {
  const d = dateFromIso(iso);
  if (!d) return 0;
  return (d.getDay() + 1) % 7;
}

/** 42-cell grid (starting Saturday) of ISO dates for the given Jalali month. */
export function monthGrid(jy: number, jm: number): (string | null)[] {
  const len = jalaaliMonthLength(jy, jm);
  const firstIso = jalaliToIso(jy, jm, 1);
  const startOffset = firstIso ? jalaliWeekdayIndex(firstIso) : 0;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= len; d++) cells.push(jalaliToIso(jy, jm, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Lexicographic comparison works for ISO dates. Returns negative if a < b. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isWithinRange(iso: string | undefined, from: string | undefined, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/** Timestamp → "۱۴۰۳/۰۸/۱۵ ساعت ۰۹:۳۰" */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${formatJalali(isoFromDate(d))} ساعت ${toPersianDigits(time)}`;
}

/** Short relative time: "چند لحظه پیش", "۵ دقیقه پیش", "۳ ساعت پیش", "امروز"، otherwise jalali date. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 45_000) return "چند لحظه پیش";
  if (diff < 3_600_000) return `${toPersianDigits(Math.max(1, Math.floor(diff / 60_000)))} دقیقه پیش`;
  if (diff < 86_400_000) return `${toPersianDigits(Math.floor(diff / 3_600_000))} ساعت پیش`;
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return "امروز";
  if (diff < 7 * 86_400_000) return `${toPersianDigits(Math.floor(diff / 86_400_000))} روز پیش`;
  return formatJalali(isoFromDate(d), "long");
}
