/**
 * Text normalization + label-driven field extraction + document profiles.
 * Pure string functions — no DOM, no network. Fully deterministic.
 */
import type {
  CanonicalField,
  DocumentKind,
  DocumentProfile,
  ExtractedValue,
  ExtractionMethod,
} from "./types";
import { parsePrintedDate } from "./dates";

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Arabic presentation forms (ﻻ …) → base letters; OCR often emits these. */
export function normalizeUnicodeLine(line: string): string {
  return line
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/\u200C|\u200E|\u200F|\uFEFF/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Latin OCR noise cleanup: O0 ↔ O/0 in digit contexts etc. */
export function normalizeLatinDigits(token: string): string {
  // "O" between digits → 0 ; "l" between digits → 1
  return token
    .replace(/(?<=\d)O(?=\d)/g, "0")
    .replace(/(?<=\d)I(?=\d)/g, "1")
    .replace(/(?<=\d)S(?=\d)/g, "5")
    .replace(/(?<=\d)B(?=\d)/g, "8");
}

/** Uppercase Latin + collapse spaces; used for label matching.
 *  Keeps dashes/dots inside values (ID numbers like 1403-0302-55358). */
export function normLabel(s: string): string {
  return normalizeUnicodeLine(s)
    .toUpperCase()
    .replace(/[^A-Z0-9\u0600-\u06FF \-./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Levenshtein (small, for fuzzy label match)                          */
/* ------------------------------------------------------------------ */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/* ------------------------------------------------------------------ */
/* Label-driven extraction                                             */
/* ------------------------------------------------------------------ */

const SEX_FA: Record<string, string> = { م: "M", مرد: "M", ذکر: "M", ز: "F", زن: "F", مؤنث: "F", مونث: "F" };

/**
 * Extract fields from plain text (PDF text layer or OCR output) using a
 * profile's label rules. Line-based: a value is taken from the remainder of
 * the label line, or the following line when the label line holds no value.
 */
export function extractByLabels(
  text: string,
  profile: DocumentProfile,
  method: ExtractionMethod,
): Partial<Record<CanonicalField, ExtractedValue>> {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeUnicodeLine)
    .filter((l) => l.length > 0);
  const out: Partial<Record<CanonicalField, ExtractedValue>> = {};

  for (const rule of profile.labelRules) {
    const hit = matchRule(lines, rule);
    if (hit == null) continue;
    const { value, exact } = hit;
    if (rule.isDate) {
      const iso = parsePrintedDate(value);
      out[rule.field] = {
        value: iso,
        raw: value,
        status: iso ? (exact && method !== "ocr_handwriting" ? "confirmed" : "needs_review") : "invalid",
        method,
        note: iso ? undefined : "تاریخ خوانده‌شده معتبر نیست",
      };
    } else if (rule.field === "sex") {
      const v = SEX_FA[value.trim()] ?? (value.trim().toUpperCase().startsWith("M") ? "M" : value.trim().toUpperCase().startsWith("F") ? "F" : null);
      out[rule.field] = { value: v, raw: value, status: v ? "confirmed" : "invalid", method };
    } else {
      let cleaned = value.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
      cleaned = normalizeLatinDigits(cleaned);
      if (rule.valuePattern && !rule.valuePattern.test(cleaned.replace(/\s/g, ""))) {
        out[rule.field] = { value: cleaned, raw: value, status: "needs_review", method, note: "الگوی مقدار معمول نیست" };
      } else {
        out[rule.field] = {
          value: cleaned,
          raw: value,
          status: method === "ocr_handwriting" ? "needs_review" : "confirmed",
          method,
        };
      }
    }
  }
  return out;
}

function matchRule(
  lines: string[],
  rule: { labels: string[]; sameLine?: boolean },
): { value: string; exact: boolean } | null {
  for (let i = 0; i < lines.length; i++) {
    const norm = normLabel(lines[i]);
    for (const label of rule.labels) {
      const target = normLabel(label);
      if (!target) continue;
      const idx = norm.indexOf(target);
      if (idx === -1) {
        // fuzzy: whole-line label with 1 typo (OCR noise)
        if (norm.length <= target.length + 3 && levenshtein(norm, target) <= (target.length > 6 ? 2 : 1)) {
          const next = (lines[i + 1] ?? "").trim();
          if (next) return { value: next, exact: false };
        }
        continue;
      }
      // Label found — value = rest of line, or next line when rest is empty.
      // Single-letter values (sex M/F) are accepted.
      const rest = norm.slice(idx + target.length).replace(/^[\s:.\-–—]+/, "").trim();
      if (rest.length >= 1) return { value: rest, exact: true };
      if (rule.sameLine === false) continue;
      const next = (lines[i + 1] ?? "").trim();
      if (next && !isLabelLine(next, rule)) return { value: next, exact: false };
    }
  }
  return null;
}

function isLabelLine(line: string, rule: { labels: string[] }): boolean {
  const norm = normLabel(line);
  return rule.labels.some((l) => norm.includes(normLabel(l)));
}

/* ------------------------------------------------------------------ */
/* Document profiles                                                   */
/* ------------------------------------------------------------------ */

const NAME_LATIN = /^[A-Z][A-Z\s\-'.]{1,40}$/;
const DOC_NUM = /^[A-Z0-9\-\/.]{4,20}$/;

/** Passport data page (any country) — English printed labels. */
export const PASSPORT_PROFILE: DocumentProfile = {
  id: "passport-generic",
  title: "پاسپورت (صفحه مشخصات)",
  kinds: ["passport"],
  ocrLangs: ["eng"],
  labelRules: [
    { field: "surname", labels: ["Surname", "Nom de famille"], sameLine: true, valuePattern: NAME_LATIN },
    { field: "givenNames", labels: ["Given names", "Given name", "Prenoms", "Given Names"], sameLine: true, valuePattern: NAME_LATIN },
    { field: "nationality", labels: ["Nationality", "Nationalite"], sameLine: true },
    { field: "dateOfBirth", labels: ["Date of birth", "Date de naissance"], isDate: true },
    { field: "placeOfBirth", labels: ["Place of birth", "Lieu de naissance"], sameLine: true, valuePattern: /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s\-'.]{1,34}$/ },
    { field: "dateOfIssue", labels: ["Date of issue", "Date de delivrance"], isDate: true },
    { field: "dateOfExpiry", labels: ["Date of expiry", "Date of expiration", "Date d expiration"], isDate: true },
    { field: "sex", labels: ["Sex", "Sexe"], sameLine: true },
    { field: "documentNumber", labels: ["Passport no", "Passport number", "Document no", "Passeport no"], sameLine: true, valuePattern: DOC_NUM },
    { field: "nationalId", labels: ["ID No", "Identity no", "National id"], sameLine: true, valuePattern: DOC_NUM },
    { field: "occupation", labels: ["Occupation", "Profession"], sameLine: true },
  ],
};

/** Afghan e-Tazkira / paper tazkira / general Persian-Dari ID documents. */
export const TAZKIRA_PROFILE: DocumentProfile = {
  id: "tazkira-dari",
  title: "تذکره / کارت شناسایی (دری)",
  kinds: ["tazkira_paper", "id_card"],
  ocrLangs: ["fas"],
  preprocess: { binarize: true, contrast: 1.35 },
  labelRules: [
    { field: "surname", labels: ["نام خانوادگی", "تخلص", "اسم خانوادگی"], sameLine: true },
    { field: "givenNames", labels: ["نام", "نوم"], sameLine: true },
    { field: "fatherName", labels: ["نام پدر", "نوم پدر", "پدر نام"], sameLine: true },
    { field: "dateOfBirth", labels: ["تاریخ تولد", "تاريخ تولد", "د زیږیدنې نیټه", "تاریخ زیږیدن"], isDate: true },
    { field: "sex", labels: ["جنس", "جنسیت"], sameLine: true },
    { field: "nationality", labels: ["ملیت", "تبعه"], sameLine: true },
    { field: "nationalId", labels: ["شماره تذکره", "شماره تذکریه", "نمبر تذکره", "شماره شناسایی", "شماره ملی"], sameLine: true, valuePattern: DOC_NUM },
    { field: "placeOfBirth", labels: ["ولایت", "محل تولد", "محل صدور", "زون", "قریه"], sameLine: true },
  ],
};

/** Visa application form (printed labels, either language). */
export const VISA_FORM_PROFILE: DocumentProfile = {
  id: "visa-form",
  title: "فرم درخواست ویزا",
  kinds: ["visa_form"],
  ocrLangs: ["eng", "fas"],
  labelRules: [
    { field: "surname", labels: ["Family name", "Surname", "Last name", "نام خانوادگی"], sameLine: true },
    { field: "givenNames", labels: ["First name", "Given names", "نام"], sameLine: true },
    { field: "dateOfBirth", labels: ["Date of birth", "تاریخ تولد"], isDate: true },
    { field: "nationality", labels: ["Nationality", "ملیت"], sameLine: true },
    { field: "documentNumber", labels: ["Passport no", "Travel document no", "شماره پاسپورت"], sameLine: true },
    { field: "sex", labels: ["Sex", "Gender", "جنس"], sameLine: true },
  ],
};

export const PROFILES: DocumentProfile[] = [PASSPORT_PROFILE, TAZKIRA_PROFILE, VISA_FORM_PROFILE];

/* ------------------------------------------------------------------ */
/* Document kind detection from text                                   */
/* ------------------------------------------------------------------ */

/** Heuristics — deterministic keyword counting. */
export function detectKind(text: string, hasMrz: boolean, mrzFormat: string | null): DocumentKind {
  const t = normalizeUnicodeLine(text);
  const up = t.toUpperCase();
  if (hasMrz) return mrzFormat === "TD3" ? "passport" : "id_card";
  if (/\bPASSPORT\b/.test(up) || /پاسپورت|پاسپوټ/.test(t)) return "passport";
  if (/تذکره|تذکریه|شناسنامه|احوال شخص|TAZKIRA|TAZKERA/.test(up + t)) return "tazkira_paper";
  if (/VISA APPLICATION|APPLICATION FOR VISA|درخواست ویزا/.test(up + t)) return "visa_form";
  if (/REPUBLIC OF AFGHANISTAN|اسلامی افغانستان|جمهوری اسلامی افغانستان/.test(up + t)) return "id_card";
  const words = t.split(/\s+/).filter((w) => w.length > 1).length;
  if (words <= 4) return "photo";
  return "unknown";
}
