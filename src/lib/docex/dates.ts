/**
 * Deterministic date parsing for documents.
 * Accepts Gregorian (many print formats), Jalali/Persian digits, MRZ YYMMDD
 * and Dari month names. Everything normalizes to ISO yyyy-mm-dd.
 * Invalid dates return null — never guessed.
 */
import { toLatinDigits } from "../../utils/jalali";

export type MrzDateKind = "birth" | "expiry" | "issue";

/** MRZ YYMMDD with ICAO century inference. */
export function parseMrzDate(raw: string, kind: MrzDateKind): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = parseInt(raw.slice(0, 2), 10);
  const mm = parseInt(raw.slice(2, 4), 10);
  const dd = parseInt(raw.slice(4, 6), 10);
  const nowYY = new Date().getFullYear() % 100;
  let year: number;
  if (kind === "expiry") {
    year = 2000 + yy; // documents expire in the future, max ~20y
  } else if (kind === "issue") {
    // Issue dates are within the last ~15 years.
    year = yy > nowYY ? 1900 + yy : 2000 + yy;
  } else {
    // Birth: a "future" date means the person was born in the 1900s.
    // Someone born 20xx must be at most ~1 day old in the future.
    const as2000 = 2000 + yy;
    const now = new Date();
    const d = new Date(Date.UTC(as2000, mm - 1, dd));
    year = d.getTime() - now.getTime() > 366 * 86400_000 ? 1900 + yy : 2000 + yy;
  }
  return validIso(year, mm, dd);
}

export function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Persian / Dari month names → number (Jalali & Gregorian contexts). */
const FA_MONTHS: Record<string, number> = {
  // Jalali
  "فروردین": 1, "اردیبهشت": 2, "خرداد": 3, "تیر": 4, "مرداد": 5, "شهریور": 6,
  "مهر": 7, "آبان": 8, "آذر": 9, "دی": 10, "بهمن": 11, "اسفند": 12,
  // Dari month names (Afghan Shamsi)
  "حمل": 1, "ثور": 2, "جوزا": 3, "سرطان": 4, "اسد": 5, "سنبله": 6,
  "میزان": 7, "عقرب": 8, "قوس": 9, "جدی": 10, "دلو": 11, "حوت": 12,
  // Gregorian as written in Iran/Afghanistan
  "جنوری": 1, "فبروری": 2, "مارچ": 3, "اپریل": 4, "می": 5, "جون": 6,
  "جولای": 7, "اگست": 8, "سپتمبر": 9, "اکتوبر": 10, "نومبر": 11, "دسمبر": 12,
};

/** Jalali → Gregorian ISO via jalaali-js (already a project dependency). */
import { toGregorian } from "jalaali-js";

function jalaliToIso(jy: number, jm: number, jd: number): string | null {
  if (jy < 1200 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const g = toGregorian(jy, jm, jd);
  return validIso(g.gy, g.gm, g.gd);
}

/**
 * Parse any printed date. Returns ISO or null.
 * Handles: 1997-03-10, 10/03/1997, 10.03.1997, 10 MAR 1997, 10 march 1997,
 *          ۱۰ مارچ ۱۹۹۷, ۱۳۷۵/۰۱/۰۲ (Jalali), 1375/1/2, 10-03-97 (DD-MM-YY).
 */
/**
 * Latin OCR digit-lookalikes inside digit runs: 2O2O → 2020, 15 → 1S, …
 * Only rewrites letters that sit in unambiguous digit contexts.
 */
function fixDigitLookalikes(s: string): string {
  return s
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/(?<=\d)I(?=\d)/g, "1")
    .replace(/(?<=\d)L(?=\d)/g, "1")
    .replace(/(?<=\d)S(?=\d)/g, "5")
    .replace(/(?<=\d)B(?=\d)/g, "8")
    .replace(/(?<=\d)Z(?=\d)/g, "2")
    .replace(/(?<=\d)G(?=\d)/g, "6")
    .replace(/(?<=\d)O(?=[\s\/\-.,])/g, "0") // "1O MAR 2020" → "10 MAR 2020"
    .replace(/O(?=\d{3})/g, "0") // "O2020…" leading letter before a digit run
    .replace(/(?<=\d)O+$/gm, (m) => "0".repeat(m.length)); // "2O2O"→"2020"
}

export function parsePrintedDate(input: string): string | null {
  if (!input) return null;
  const s = fixDigitLookalikes(toLatinDigits(String(input)).replace(/\u00A0/g, " ")).trim();
  if (!s) return null;

  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    const y = +m[1];
    if (y > 1900 && y < 2100) return validIso(y, +m[2], +m[3]);
    if (y >= 1200 && y <= 1600) return jalaliToIso(y, +m[2], +m[3]); // Jalali year
    return null;
  }

  // dd <month-name> yyyy (EN or FA) — separators optional (OCR glues
  // “15MAR2022”); month lookup tolerates a leading 0 (O→0 misreads).
  m = s.match(/^(\d{1,2})[\s\-\/.]*(?:<[^>]*>\s*)?([A-Za-z\u0600-\u06FF]+)[\s\-\/.]*(\d{4})$/);
  if (m) {
    const monKey = m[2].toLowerCase();
    const mon = EN_MONTHS[monKey] ?? EN_MONTHS[monKey.replace(/^0/, "o")] ?? FA_MONTHS[m[2]];
    if (mon) return validIso(+m[3], mon, +m[1]);
    // Jalali month with year → try Jalali
    if (/^1[23456]\d\d$/.test(m[3]) && FA_MONTHS[m[2]] && ["حمل","ثور","جوزا","سرطان","اسد","سنبله","میزان","عقرب","قوس","جدی","دلو","حوت","فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"].includes(m[2])) {
      return jalaliToIso(+m[3], FA_MONTHS[m[2]], +m[1]);
    }
  }
  // yyyy <month-name> dd
  m = s.match(/^(\d{4})\s+([A-Za-z\u0600-\u06FF]+)\s+(\d{1,2})$/);
  if (m) {
    const mon = EN_MONTHS[m[2].toLowerCase()] ?? FA_MONTHS[m[2]];
    if (mon) return validIso(+m[1], mon, +m[3]);
  }

  // dd/mm/yyyy or dd.mm.yyyy — could be Jalali (13xx/14xx) or Gregorian.
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    if (y >= 1200 && y <= 1500 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return jalaliToIso(y, mo, d); // clearly a Jalali year
    }
    if (validIso(y, mo, d)) return validIso(y, mo, d); // assume D/M/Y (common in region)
    if (validIso(y, d, mo)) return validIso(y, d, mo); // else M/D/Y
    return null;
  }

  // dd/mm/yy (2-digit year — passports print e.g. 10 MAR 97 rarely; treat carefully)
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
  if (m) {
    const yy = +m[3];
    const y = yy > 30 ? 1900 + yy : 2000 + yy;
    const d = +m[1], mo = +m[2];
    if (validIso(y, mo, d)) return validIso(y, mo, d);
    if (validIso(y, d, mo)) return validIso(y, d, mo);
    return null;
  }

  // Bare yyyymmdd / ddmmyyyy (8 digits) — prefer yyyymmdd when plausible.
  m = s.match(/^(\d{8})$/);
  if (m) {
    const asY = validIso(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
    if (asY) return asY;
    return validIso(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2));
  }

  return null;
}
