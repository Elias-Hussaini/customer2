/**
 * Page relevance scoring — which page of an upload is the actual document
 * DATA page, and which pages are covers, stamps, letters or other noise.
 *
 * This is the structural answer to "only look for the passport page":
 * a page must PROVE itself before any of its text may fill the form —
 * either with a machine-readable zone (definitive) or with a dense set of
 * data-page labels (Surname / Date of issue / تاریخ صدور / تخلص …).
 * A page that merely contains the word "PASSPORT" (a cover, a support
 * letter, a ticket) never becomes a source, so its text can never
 * overwrite or pollute identity fields.
 *
 * Pure string analysis — deterministic, no dictionaries of names.
 */

/* ------------------------------------------------------------------ */
/* Label evidence                                                      */
/* ------------------------------------------------------------------ */

/**
 * STRONG labels — each one only ever appears on a real data page
 * (bio page of a passport, an ID card, a tazkira or a structured form).
 * Counted DISTINCTLY: a page repeating "date of birth" ten times still
 * scores 1, so keyword stuffing in a letter cannot fake a data page.
 */
const STRONG_LABEL_RES: RegExp[] = [
  // English (printed passports, visa forms)
  /\bSUR\s?NAMES?\b/,
  /\bFAMILY\s+NAMES?\b/,
  /\bLAST\s+NAMES?\b/,
  /\bGIVEN\s+NAMES?\b/,
  /\bFIRST\s+NAMES?\b/,
  /\bFORENAMES?\b/,
  /\bDATE\s+OF\s+BIRTH\b/,
  /\bPLACE\s+OF\s+BIRTH\b/,
  /\bDATE\s+OF\s+ISSUE\b/,
  /\bDATE\s+ISSUED\b/,
  /\bISSUE\s+DATE\b|\bISSUED\s+ON\b/,
  /\bDATE\s+OF\s+EXPIR\w+\b|\bEXPIR\w+\s+DATE\b|\bVALID\s+UNTIL\b/,
  /\bPASSPORT\s+(?:NO|NUMBER|N0)\b/,
  /\bTRAVEL\s+DOCUMENT\s+(?:NO|NUMBER)\b/,
  /\bNATIONALITY\b/,
  /\bNATIONAL\s+ID\b|\bIDENTITY\s+(?:NO|NUMBER)\b|\bID\s+NO\b/,
  /\bFATHER'?S?\s+NAMES?\b/,
  // Persian / Dari (tazkira, Persian passports, Dari forms)
  // NOTE: JS \b is defined on [A-Za-z0-9_] only — it never matches next to
  // Persian letters, so these use Arabic-script lookaround guards instead.
  /(?<![\u0600-\u06FF])نام\s+خانوادگی(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])تخلص(?![\u0600-\u06FF])/,
  /نام\s+پدر|پدر\s*نام/,
  /تاریخ\s+تولد|تاریخ\s+زیږیدن|د\s+زیږیدنې/,
  /تاریخ\s+صدور/,
  /تاریخ\s+انقضا/,
  /محل\s+تولد|محل\s+صدور/,
  /(?<![\u0600-\u06FF])ولایت(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])زون(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])قریه(?![\u0600-\u06FF])/,
  /شماره?\s*ی?\s*تذکر[یه]/,
  /شماره\s+ملی|شماره\s+شناسایی/,
  /شماره?\s+پاسپورت|پاسپورت\s+نمبر/,
  /(?<![\u0600-\u06FF])ملیت(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])تبعه(?![\u0600-\u06FF])/,
];

/**
 * WEAK labels — real data-page furniture (Type / Code / Sex / Authority)
 * that also occurs in ordinary prose. They only ever tip the balance,
 * never carry a page on their own.
 */
const WEAK_LABEL_RES: RegExp[] = [
  /\bTYPE\b/,
  /\bCODE\b/,
  /\bSEX\b|\bGENDER\b/,
  /\bAUTHORITY\b/,
  /\bHOLDER'?S?\s+SIGNATURE\b|\bSIGNATURE\b/,
  /\bOCCUPATION\b|\bPROFESSION\b/,
  /(?<![\u0600-\u06FF])جنس(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])جنسیت(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])نوع(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])کد(?![\u0600-\u06FF])/,
  /(?<![\u0600-\u06FF])امضا(?![\u0600-\u06FF])/,
];

/** Headings that unambiguously mark an APPLICATION FORM, not a document. */
const FORM_MARKER_RE =
  /VISA\s+APPLICATION|APPLICATION\s+FOR\s+(?:A\s+)?VISA|درخواست\s+ویزا|فرم\s+درخواست|APPLICATION\s+FORM/i;

/** The document word alone — present on covers, letters and forms alike. */
const PASSPORT_WORD_RE = /\bPASSPORT\b|\u067E\u0627\u0633\u067E\u0648\u0631\u062A|\u067E\u0627\u0633\u067E\u0648\u067D|\u06AF\u0630\u0631\u0646\u0627\u0645\u0647/i;

/** A data-page line is short: labels + values, not prose sentences. */
const SHORT_LINE_MAX = 80;
/** A strong label is "label-like" on a line when at most this many tokens
 *  follow it — data rows carry a short value (maybe one more column);
 *  prose keeps talking long after the label word. */
const TOKENS_AFTER_LABEL_MAX = 5;

/** First match index of `re` in norm (or in the OCR-folded twin), −1 if none. */
function firstMatchIndex(re: RegExp, norm: string, folded: string): number {
  const m1 = re.exec(norm);
  if (m1) return m1.index;
  const m2 = re.exec(folded);
  return m2 ? m2.index : -1;
}

/* ------------------------------------------------------------------ */
/* Normalization (self-contained — no imports, no cycles)              */
/* ------------------------------------------------------------------ */

/** Uppercase, NFKC, Arabic→Persian folds, punctuation → space, collapse. */
function normForScoring(line: string): string {
  return line
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/\u064A|\u0649/g, "\u06CC") // ي/ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/[\u0623\u0625\u0671]/g, "\u0627") // أ/إ → ا
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/[\u200C\u200E\u200F\uFEFF]/g, " ")
    .toUpperCase()
    .replace(/[^A-Z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * OCR-confusion fold for the LATIN side (O↔0↔Q, I↔L↔1, S↔5, B↔8, Z↔2,
 * G↔6) so "DATE OF LSSUE" / "PASSP0RT N0" still count as label hits.
 */
function foldLatin(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[0-9A-Z]/.test(ch)) {
      if ("0QD".includes(ch)) out += "O";
      else if ("L1|!".includes(ch)) out += "I";
      else if (ch === "5") out += "S";
      else if (ch === "8") out += "B";
      else if (ch === "2") out += "Z";
      else if (ch === "6") out += "G";
      else out += ch;
    } else {
      out += ch; // Persian letters pass through untouched
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface PageRelevance {
  /** 1 = machine-readable data page (MRZ) — definitive.
   *  2 = label-dense data/form page — trusted source.
   *  3 = cover / stamp / letter / noise — never feeds identity fields. */
  tier: 1 | 2 | 3;
  /** Distinct STRONG labels found anywhere on the page. */
  strongHits: number;
  /** Distinct STRONG labels found on SHORT lines (label: value rows) —
   *  the structural signature of a real data page. Labels buried inside
   *  long prose sentences (sponsorship letters) do NOT count here. */
  shortLineHits: number;
  /** Distinct WEAK labels found. */
  weakHits: number;
  /** Application-form markers present (visa application etc.). */
  isForm: boolean;
  /** The word "passport" appears (cover pages have it, so do bio pages). */
  hasPassportWord: boolean;
}

/**
 * Score one page's text. `hasMrz` short-circuits to tier 1 — a page with a
 * check-digit machine-readable zone IS the data page by definition.
 *
 * A page without an MRZ becomes a trusted source (tier 2) only when it
 * looks like a DATA PAGE, not like prose that happens to mention document
 * fields:
 *   • at least 3 distinct strong labels, AND
 *   • at least 2 of them sit on short "label: value" lines — or the page
 *     is so label-dense (≥ 4 short-line hits… or ≥ 5 total) that joined
 *     two-column layouts still qualify.
 * A cover or a sponsorship letter naming "date of issue / passport no"
 * never passes both gates, so its text can never reach the form.
 */
export function scorePageText(text: string, hasMrz: boolean): PageRelevance {
  const rawLines = text.split(/\r?\n/);
  const strongAnywhere = new Set<RegExp>();
  const strongShort = new Set<RegExp>();
  let weakHits = 0;

  for (const raw of rawLines) {
    const norm = normForScoring(raw);
    if (!norm) continue;
    const folded = foldLatin(norm);
    const tokens = norm.split(" ").filter(Boolean);
    let lineWeak = 0;
    for (const re of WEAK_LABEL_RES) {
      if (re.test(norm) || re.test(folded)) lineWeak++;
    }
    weakHits += lineWeak > 0 ? 1 : 0; // distinct-ish per page: cap at 1 per line
    for (const re of STRONG_LABEL_RES) {
      const idx = firstMatchIndex(re, norm, folded);
      if (idx < 0) continue;
      strongAnywhere.add(re);
      // label-like: the line is a short label row, or the label is followed
      // by a short value run — never by a long prose tail.
      const tokensAfter = tokens.slice(norm.slice(0, idx).trim().split(" ").filter(Boolean).length).length;
      const labelLike =
        norm.length <= SHORT_LINE_MAX && tokensAfter <= TOKENS_AFTER_LABEL_MAX;
      if (labelLike) strongShort.add(re);
    }
  }

  const strongHits = strongAnywhere.size;
  const shortLineHits = strongShort.size;
  const isForm = FORM_MARKER_RE.test(text) || FORM_MARKER_RE.test(normForScoring(text));
  const hasPassportWord = PASSPORT_WORD_RE.test(normForScoring(text));

  let tier: 1 | 2 | 3;
  if (hasMrz) {
    tier = 1;
  } else if (
    strongHits >= 3 &&
    (shortLineHits >= 2 || strongHits >= 5)
  ) {
    // A real data page (or a structured form — forms are legitimate
    // label-anchored sources for their own fields).
    tier = 2;
  } else {
    tier = 3;
  }
  return { tier, strongHits, shortLineHits, weakHits, isForm, hasPassportWord };
}

/** May this page's extracted fields feed the identity merge? */
export function isIdentitySource(rel: Pick<PageRelevance, "tier">): boolean {
  return rel.tier <= 2;
}

/* ------------------------------------------------------------------ */
/* Structural garbage-name rejection                                   */
/* ------------------------------------------------------------------ */

/**
 * OCR sometimes emits a single letter repeated ("کلکللل", "AAAA") or a
 * two-letter shuffle ("ABAB") where the real name should be. Structural,
 * dictionary-free test on the LETTER CONTENT of a candidate name token:
 * if there is (almost) no information in it, it is noise, not a name.
 */
export function isGarbageNameToken(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, "");
  if (letters.length === 0) return true;
  const uniq = new Set(letters).size;
  if (uniq === 1 && letters.length >= 2) return true; // aaaa / کلکللل
  if (letters.length >= 4 && uniq <= 2) return true; // abab / klklll
  return false;
}

/** Drop every garbage token; null when nothing credible remains. */
export function filterNameTokens(name: string): string | null {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[:؛.,!؟"'`|_]+/g, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  const kept = words.filter((w) => !isGarbageNameToken(w));
  if (kept.length === 0) return null;
  return kept.join(" ");
}
