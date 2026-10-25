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
import type { StructuredRow } from "./pdfread";
import { parsePrintedDate } from "./dates";
import { toLatinDigits } from "../../utils/jalali";

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Arabic presentation forms (ﻻ …) → base letters; OCR often emits these.
 * Also folds Arabic-script variants onto their Persian equivalents (ي→ی،
 * ك→ک، ى→ی، أ/إ/ٱ→ا، ة→ه) — tesseract (fas) frequently outputs the Arabic
 * codepoints, which would otherwise never match Persian labels or get
 * stored with the wrong spelling. */
export function normalizeUnicodeLine(line: string): string {
  return line
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/\u064A|\u0649/g, "\u06CC") // Arabic yeh / alif maqsura → Persian ی
    .replace(/\u0643/g, "\u06A9") // Arabic kaf → Persian ک
    .replace(/[\u0623\u0625\u0671]/g, "\u0627") // أ/إ/ٱ → ا
    .replace(/\u0629/g, "\u0647") // ة → ه
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
/* OCR-confusion folding for label search                              */
/* ------------------------------------------------------------------ */

/**
 * 1:1 character fold of the shapes OCR most often confuses on printed
 * documents (I↔L↔1, O↔0↔Q↔D, S↔5, B↔8, Z↔2, G↔6). Applied to BOTH the
 * line and the label when exact matching fails — “Date of lssue” then
 * still finds “Date of issue”. Length-preserving, so a folded hit maps
 * back to the exact index in the original string.
 */
const FOLD_MAP: Record<string, string> = {
  O: "O", "0": "O", Q: "O", D: "O",
  I: "I", L: "I", "1": "I", "|": "I", "!": "I",
  S: "S", "5": "S",
  B: "B", "8": "B",
  Z: "Z", "2": "Z",
  G: "G", "6": "G",
};

export function foldForLabel(s: string): string {
  if (!s) return s;
  let out = "";
  for (const ch of s) out += FOLD_MAP[ch] ?? ch;
  return out;
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
/* Date candidate scanning (multi-date lines + smart fallback)          */
/* ------------------------------------------------------------------ */

const MONTH_WORD = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";
const FA_MONTH_WORD =
  "فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند|حمل|ثور|جوزا|سرطان|اسد|سنبله|میزان|عقرب|قوس|جدی|دلو|حوت|جنوری|فبروری|مارچ|اپریل|می|جون|جولای|اگست|سپتمبر|اکتوبر|نومبر|دسمبر";

const DATE_TOKEN_PATTERNS: RegExp[] = [
  new RegExp(`\\d{1,2}\\s+(?:${MONTH_WORD})[A-Za-z]*\\s+\\d{4}`, "g"), // 15 MAR 2022
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g, // 2022-03-15
  /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g, // 15/03/2022
  new RegExp(`[۰-۹0-9]{1,2}\\s+(?:${FA_MONTH_WORD})\\s+[۰-۹0-9]{2,4}`, "g"), // ۱۵ مارچ ۲۰۲۲
  /\b\d{8}\b/g, // 20220315
];

/** Scan free text for every date-like token that parses to a valid ISO date. */
export function findDateCandidates(text: string): { iso: string; raw: string }[] {
  if (!text) return [];
  const src = toLatinDigits(text);
  const out: { iso: string; raw: string }[] = [];
  for (const re of DATE_TOKEN_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const raw = m[0].trim();
      const iso = parsePrintedDate(raw);
      if (iso) out.push({ iso, raw });
    }
  }
  return out;
}

/**
 * Smart issue-date guess for passports whose printed label was unreadable.
 * MRZ gives birth + expiry but never the issue date; among the remaining
 * dates on the data page, the issue date is the one strictly between birth
 * and expiry. Deterministic; `strong` means "very likely correct".
 */
export function disambiguateIssueDate(
  candidates: { iso: string; raw: string }[],
  birthIso: string | null,
  expiryIso: string | null,
): { iso: string; strong: boolean } | null {
  const uniq = [...new Set(candidates.map((c) => c.iso))];
  const today = new Date().toISOString().slice(0, 10);
  let pool = uniq.filter((d) => d <= today);
  if (expiryIso) pool = pool.filter((d) => d < expiryIso);
  if (birthIso) pool = pool.filter((d) => d > birthIso);
  if (pool.length === 0) return null;
  if (pool.length === 1) return { iso: pool[0], strong: true };
  // Passports are typically issued 5 or 10 years before expiry (± a few days).
  if (expiryIso) {
    const exp = Date.parse(expiryIso);
    const exact = pool.filter((d) => {
      const diffDays = (exp - Date.parse(d)) / 86_400_000;
      return Math.abs(diffDays - 365.25 * 5) <= 4 || Math.abs(diffDays - 365.25 * 10) <= 4;
    });
    if (exact.length === 1) return { iso: exact[0], strong: true };
  }
  // Several candidates survive: take the latest one (closest to expiry) but
  // flag it for review.
  const sorted = [...pool].sort();
  return { iso: sorted[sorted.length - 1], strong: false };
}

/* ------------------------------------------------------------------ */
/* Label-driven extraction                                             */
/* ------------------------------------------------------------------ */

const SEX_FA: Record<string, string> = { م: "M", مرد: "M", ذکر: "M", ز: "F", زن: "F", مؤنث: "F", مونث: "F" };

/** Apply one rule to a raw value string — shared by plain + layout paths. */
function applyRuleValue(
  rule: { field: CanonicalField; isDate?: boolean; valuePattern?: RegExp },
  rawValue: string,
  exact: boolean,
  method: ExtractionMethod,
  dateOrdinal = 0,
): ExtractedValue | null {
  const value = rawValue.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (rule.isDate) {
    let iso = parsePrintedDate(value);
    let usedRaw = value;
    if (!iso) {
      // Multi-date value (two-column layout collapsed into one line):
      // pick the date matching this label's column order.
      const cands = findDateCandidates(value);
      if (cands.length > 0) {
        const pick = dateOrdinal >= 0 && dateOrdinal < cands.length ? cands[dateOrdinal] : cands[0];
        iso = pick.iso;
        usedRaw = pick.raw;
      }
    }
    return {
      value: iso,
      raw: usedRaw,
      status: iso ? (exact && method !== "ocr_handwriting" ? "confirmed" : "needs_review") : "invalid",
      method,
      note: iso ? undefined : "تاریخ خوانده‌شده معتبر نیست",
    };
  }
  if (rule.field === "sex") {
    const v =
      SEX_FA[value.trim()] ??
      (value.trim().toUpperCase().startsWith("M")
        ? "M"
        : value.trim().toUpperCase().startsWith("F")
          ? "F"
          : null);
    return { value: v, raw: value, status: v ? "confirmed" : "invalid", method };
  }
  let cleaned = value.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
  cleaned = normalizeLatinDigits(cleaned);
  if (rule.valuePattern && !rule.valuePattern.test(cleaned.replace(/\s/g, ""))) {
    return { value: cleaned, raw: value, status: "needs_review", method, note: "الگوی مقدار معمول نیست" };
  }
  return {
    value: cleaned,
    raw: value,
    status: method === "ocr_handwriting" ? "needs_review" : "confirmed",
    method,
  };
}

/**
 * Extract fields from plain text (PDF text layer or OCR output) using a
 * profile's label rules. Line-based: a value is taken from the remainder of
 * the label line, or the following line when the label line holds no value.
 * A remainder that is itself another known label (two-column data pages)
 * is NOT mistaken for a value.
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
  const allLabelNorms = profile.labelRules
    .flatMap((r) => r.labels.map(normLabel))
    .filter((l) => l.length > 0);
  /** A line/rest that contains a full label and no digits is a label line. */
  const looksLikeLabel = (s: string): boolean => {
    const n = normLabel(s);
    if (!n || /\d/.test(n)) return false;
    return allLabelNorms.some(
      (l) => n === l || n.startsWith(l + " ") || n.endsWith(" " + l) || n.includes(" " + l + " "),
    );
  };

  // Per line: date rules whose label appears here, ordered left-to-right —
  // used to pair multiple dates on the value line with their columns.
  const dateRulesOnLine: Map<number, { rule: (typeof profile.labelRules)[number]; pos: number }[]> = new Map();
  for (let i = 0; i < lines.length; i++) {
    const norm = normLabel(lines[i]);
    const hits: { rule: (typeof profile.labelRules)[number]; pos: number }[] = [];
    for (const r of profile.labelRules) {
      if (!r.isDate) continue;
      let best = -1;
      for (const label of r.labels) {
        const t = normLabel(label);
        if (!t) continue;
        const idx = norm.indexOf(t);
        if (idx !== -1 && (best === -1 || idx < best)) best = idx;
      }
      if (best !== -1) hits.push({ rule: r, pos: best });
    }
    hits.sort((a, b) => a.pos - b.pos);
    dateRulesOnLine.set(i, hits);
  }

  for (const rule of profile.labelRules) {
    const hit = matchRule(lines, rule, looksLikeLabel);
    if (hit == null) continue;
    const ordinal = dateRulesOnLine.get(hit.labelLine)?.findIndex((h) => h.rule === rule) ?? -1;
    const val = applyRuleValue(rule, hit.value, hit.exact, method, ordinal);
    if (val) out[rule.field] = val;
  }
  return out;
}

function matchRule(
  lines: string[],
  rule: { labels: string[]; sameLine?: boolean },
  looksLikeLabel: (s: string) => boolean,
): { value: string; exact: boolean; labelLine: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const norm = normLabel(lines[i]);
    for (const label of rule.labels) {
      const target = normLabel(label);
      if (!target) continue;
      let idx = norm.indexOf(target);
      if (idx === -1) {
        // OCR-confusion fallback: “DATE OF LSSUE” / “OATE OF ISSUE” …
        idx = foldForLabel(norm).indexOf(foldForLabel(target));
      }
      if (idx === -1) {
        // fuzzy: whole-line label with 1 typo (OCR noise)
        if (norm.length <= target.length + 3 && levenshtein(norm, target) <= (target.length > 6 ? 2 : 1)) {
          const next = (lines[i + 1] ?? "").trim();
          if (next) return { value: next, exact: false, labelLine: i };
        }
        continue;
      }
      // Label found — value = rest of line, or next line when rest is empty
      // or another label (two-column pages put two labels on one line).
      const rest = norm.slice(idx + target.length).replace(/^[\s:.\-–—]+/, "").trim();
      if (rest.length >= 1 && !looksLikeLabel(rest)) return { value: rest, exact: true, labelLine: i };
      if (rule.sameLine === false) continue;
      const next = (lines[i + 1] ?? "").trim();
      if (next && !looksLikeLabel(next)) return { value: next, exact: false, labelLine: i };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Column-aware layout extraction (PDF text layers with x positions)   */
/* ------------------------------------------------------------------ */

interface LabelHit {
  ruleIndex: number;
  start: number;
  end: number;
  partStart: number;
  partEnd: number; // inclusive
  x: number;
}
interface ValueSegment {
  partStart: number;
  partEnd: number; // inclusive
  x: number;
  text: string;
}

/**
 * Extract fields using x/y geometry — real passport data pages are two-
 * column grids ("Date of issue  15 MAR 2022    Date of expiry  15 MAR 2027"
 * on ONE visual row, or labels row + values row). Line-collapsed matching
 * fails on those; this pairs each label with the value beside/below it.
 * Only for LTR (Latin-label) profiles.
 */
export function extractByLayout(
  rows: StructuredRow[],
  profile: DocumentProfile,
  method: ExtractionMethod,
): Partial<Record<CanonicalField, ExtractedValue>> {
  const firstLabel = profile.labelRules[0]?.labels[0] ?? "";
  if (!/[A-Za-z]/.test(firstLabel)) return {}; // RTL profiles → plain path only

  // Pre-normalize rules
  const ruleLabels: { ruleIndex: number; norm: string }[] = [];
  profile.labelRules.forEach((r, i) => {
    for (const l of r.labels) {
      const n = normLabel(l);
      if (n) ruleLabels.push({ ruleIndex: i, norm: n });
    }
  });

  // Normalize each row into parts with joined text + char offsets
  const normRows = rows
    .map((r) => {
      const parts: { x: number; norm: string; start: number }[] = [];
      let joined = "";
      for (const p of r.parts) {
        const norm = normLabel(p.s);
        if (!norm) continue;
        parts.push({ x: p.x, norm, start: joined.length ? joined.length + 1 : 0 });
        joined = joined ? `${joined} ${norm}` : norm;
      }
      return { parts, joined };
    })
    .filter((r) => r.joined.length > 0);

  const out: Partial<Record<CanonicalField, ExtractedValue>> = {};

  for (let ri = 0; ri < normRows.length; ri++) {
    const { parts, joined } = normRows[ri];
    if (!parts.length) continue;

    // 1) Find every label occurrence on this row (longest match wins on overlap).
    const hits: LabelHit[] = [];
    for (const { ruleIndex, norm } of ruleLabels) {
      let from = 0;
      for (;;) {
        const idx = joined.indexOf(norm, from);
        if (idx === -1) break;
        const end = idx + norm.length;
        // part range overlapping [idx, end)
        const partStart = parts.findIndex((p) => p.start + p.norm.length > idx && p.start < end);
        let partEnd = partStart;
        if (partStart >= 0) {
          for (let k = partStart; k < parts.length && parts[k].start < end; k++) partEnd = k;
        }
        if (partStart >= 0) {
          hits.push({ ruleIndex, start: idx, end, partStart, partEnd, x: parts[partStart].x });
        }
        from = idx + 1;
      }
    }
    if (hits.length === 0) continue;

    // Resolve overlaps: keep the longest label, comparing each hit against
    // the last KEPT hit (not the previous array element).
    const sortedHits = hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept: LabelHit[] = [];
    for (const h of sortedHits) {
      const last = kept[kept.length - 1];
      if (!last || h.start >= last.end) kept.push(h);
    }
    const covered = new Set<number>();
    for (const h of kept) for (let k = h.partStart; k <= h.partEnd; k++) covered.add(k);

    // 2) Value segments = maximal runs of uncovered parts.
    const segments: ValueSegment[] = [];
    let k = 0;
    while (k < parts.length) {
      if (covered.has(k)) {
        k++;
        continue;
      }
      let j = k;
      while (j + 1 < parts.length && !covered.has(j + 1)) j++;
      segments.push({
        partStart: k,
        partEnd: j,
        x: parts[k].x,
        text: parts.slice(k, j + 1).map((p) => p.norm).join(" "),
      });
      k = j + 1;
    }

    // 3) Pair each label with the value segment right after it (same row) —
    //    or, when the label row holds no values, with the parts of the next
    //    row that fall inside the label's column strip (stacked layout:
    //    "Date of issue  Date of expiry" / "15 MAR 2022  15 MAR 2027").
    const nextRow = normRows[ri + 1];
    let nextStrips: { hit: LabelHit; text: string }[] | null = null;
    if (nextRow && segments.length === 0 && nextRow.parts.length) {
      const nextHasLabel = ruleLabels.some(({ norm }) => nextRow.joined.includes(norm));
      if (!nextHasLabel) {
        // Column strips anchored at each label's x position.
        const byX = [...kept].sort((a, b) => a.x - b.x);
        const strips = byX.map((h, i) => ({
          hit: h,
          from: h.x - 15,
          to: i + 1 < byX.length ? byX[i + 1].x - 15 : Infinity,
          parts: [] as string[],
        }));
        for (const p of nextRow.parts) {
          const strip = strips.find((s) => p.x >= s.from && p.x < s.to);
          if (strip) strip.parts.push(p.norm);
        }
        nextStrips = strips
          .map((s) => ({ hit: s.hit, text: s.parts.join(" ").trim() }))
          .filter((s) => s.text.length > 0);
      }
    }

    // ordinal (for multi-date segments) = order among date-rule hits on this row
    const dateHits = kept
      .filter((h) => profile.labelRules[h.ruleIndex].isDate)
      .sort((a, b) => a.x - b.x);

    for (let hi = 0; hi < kept.length; hi++) {
      const h = kept[hi];
      const rule = profile.labelRules[h.ruleIndex];
      // Same-row: the segment between this label and the next one (or row end).
      const limit = hi + 1 < kept.length ? kept[hi + 1].partStart : Infinity;
      let seg = segments.find((s) => s.partStart > h.partEnd && s.partStart < limit);
      let exact = true;
      let text: string | null = seg ? seg.text : null;
      if (seg) {
        segments.splice(segments.indexOf(seg), 1);
      } else if (nextStrips) {
        const strip = nextStrips.find((s) => s.hit === h);
        if (strip) {
          text = strip.text;
          exact = false;
        }
      }
      if (!text) continue;
      const ordinal = rule.isDate ? dateHits.findIndex((d) => d === h) : 0;
      const val = applyRuleValue(rule, text, exact, method, ordinal);
      if (val) {
        const prev = out[rule.field];
        if (!prev || (val.value && !prev.value)) out[rule.field] = val;
      }
    }
  }
  return out;
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
    { field: "dateOfBirth", labels: ["Date of birth", "Birth date", "Date de naissance", "تاریخ تولد"], isDate: true },
    { field: "placeOfBirth", labels: ["Place of birth", "Lieu de naissance"], sameLine: true, valuePattern: /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s\-'.]{1,34}$/ },
    {
      field: "dateOfIssue",
      labels: ["Date of issue", "Date issued", "Issue date", "Issued on", "Date de delivrance", "تاریخ صدور"],
      isDate: true,
    },
    {
      field: "dateOfExpiry",
      labels: ["Date of expiry", "Date of expiration", "Expiry date", "Expires on", "Valid until", "Date d expiration", "تاریخ انقضا"],
      isDate: true,
    },
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

/**
 * Visa stamps / annotation pages — entry date (تاریخ ورود) lives here, not on
 * the passport bio page. Runs on visa_form pages AND on “unknown” pages (a
 * scanned stamp rarely matches any keyword). Deliberately tiny: only the
 * entry date, so junk pages can never pollute passport fields.
 */
export const VISA_STAMP_PROFILE: DocumentProfile = {
  id: "visa-stamp",
  title: "مهر/برگه ویزا",
  kinds: ["visa_form", "unknown"],
  ocrLangs: ["eng", "fas"],
  labelRules: [
    {
      field: "entryDate",
      labels: [
        "تاریخ ورود",
        "تاريخ ورود", // Arabic yeh — normalized, kept for safety
        "Date of entry",
        "Entry date",
        "Date of arrival",
      ],
      isDate: true,
    },
  ],
};

export const PROFILES: DocumentProfile[] = [PASSPORT_PROFILE, TAZKIRA_PROFILE, VISA_FORM_PROFILE, VISA_STAMP_PROFILE];

/* ------------------------------------------------------------------ */
/* Document kind detection from text                                   */
/* ------------------------------------------------------------------ */

/** Heuristics — deterministic keyword counting. */
export function detectKind(text: string, hasMrz: boolean, mrzFormat: string | null): DocumentKind {
  const t = normalizeUnicodeLine(text);
  const up = t.toUpperCase();
  if (hasMrz) return mrzFormat === "TD3" ? "passport" : "id_card";
  // Visa forms mention “passport” in every field name — check the stronger
  // signal first so a visa application is never classified as a passport page.
  if (/VISA APPLICATION|APPLICATION FOR VISA|درخواست ویزا/.test(up + t)) return "visa_form";
  if (/گذرنامه/.test(t)) return "passport";
  if (/\bPASSPORT\b/.test(up) || /پاسپورت|پاسپوټ/.test(t)) return "passport";
  if (/تذکره|تذکریه|شناسنامه|احوال شخص|TAZKIRA|TAZKERA/.test(up + t)) return "tazkira_paper";
  if (/REPUBLIC OF AFGHANISTAN|اسلامی افغانستان|جمهوری اسلامی افغانستان/.test(up + t)) return "id_card";
  const words = t.split(/\s+/).filter((w) => w.length > 1).length;
  if (words <= 4) return "photo";
  return "unknown";
}
