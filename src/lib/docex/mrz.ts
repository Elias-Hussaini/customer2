/**
 * ICAO Doc 9303 machine-readable zone parsing — fully deterministic.
 *
 * Supports TD3 (passport, 2×44), TD2 (2×36) and TD1 (card, 3×30).
 * Implements the 7-3-1 check-digit algorithm with OCR-tolerant repair:
 * when a check digit fails, common OCR confusions are tried (O↔0, I↔1, …)
 * and the interpretation that validates is preferred. Fields whose check
 * digit cannot be repaired are marked needs_review — never silently kept.
 */
import type { ExtractedValue, MrzValidation, CanonicalField } from "./types";
import { parseMrzDate } from "./dates";

/* ------------------------------------------------------------------ */
/* Check digits                                                        */
/* ------------------------------------------------------------------ */

const WEIGHTS = [7, 3, 1] as const;

function charValue(c: string): number {
  if (c === "<") return 0;
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55; // A=10 … Z=35
  return -1;
}

export function checkDigit(input: string): number | null {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = charValue(input[i]);
    if (v < 0) return null;
    sum += v * WEIGHTS[i % 3];
  }
  return sum % 10;
}

/* ------------------------------------------------------------------ */
/* Line cleanup & candidate detection                                  */
/* ------------------------------------------------------------------ */

/** Chars valid in an MRZ. */
const MRZ_RE = /^[A-Z0-9<]+$/;

/**
 * Repair an OCR'd MRZ line:
 * - strip spaces and non-MRZ punctuation
 * - convert lookalikes (only when the char is invalid in MRZ charset)
 * - inside long filler runs, stray letters are almost always '<' (K, C, L…)
 */
export function cleanMrzLine(rawLine: string): string {
  let s = rawLine
    .toUpperCase()
    .replace(/[\s\u00A0]/g, "")
    .replace(/[^A-Z0-9<]/g, "");
  // Common OCR confusions → canonical MRZ chars.
  s = s.replace(/Ø/g, "<").replace(/\{/g, "<").replace(/\(/g, "<");
  // Stray letters inside filler runs (e.g. "<<K<<<" → "<<<<<")
  s = s.replace(/(?<=<)[A-Z](?=<{2,})/g, "<");
  s = s.replace(/(?<=<{2,})[A-Z](?=<)/g, "<");
  return s;
}

/** Fraction of chars that are A-Z0-9< — MRZ lines are ≥ 0.8 after cleanup. */
function mrzness(line: string): number {
  if (!line.length) return 0;
  let ok = 0;
  for (const c of line) if (/[A-Z0-9<]/.test(c)) ok++;
  return ok / line.length;
}

/**
 * Find MRZ line groups inside arbitrary OCR text.
 * A line is a candidate when it is long enough, mostly MRZ-charset, and
 * contains either a digit (data lines) or a filler run (name lines such as
 * "SPECIMEN<<FAKE<<<<" carry no digits at all).
 * Returns arrays of consecutive cleaned candidate lines.
 */
export function findMrzCandidates(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const cand = lines.map(cleanMrzLine);
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const line of cand) {
    const looksMrz =
      line.length >= 26 &&
      mrzness(line) >= 0.85 &&
      line.includes("<") &&
      (/\d/.test(line) || /<{3}/.test(line));
    if (looksMrz) {
      cur.push(line);
    } else {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) groups.push(cur);
  return groups;
}

/* ------------------------------------------------------------------ */
/* Field-level tolerant repair                                         */
/* ------------------------------------------------------------------ */

const SUBSTITUTIONS: Record<string, string> = {
  O: "0",
  Q: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
  Z: "2",
  G: "6",
  D: "0",
};

/**
 * Try to repair `field` so that checkDigit(field) === expected.
 * `field` chars may be digits or letters (doc numbers); the substitution map
 * converts letter lookalikes to digits one position at a time.
 * Returns the repaired string or null.
 */
function repairAgainstCheck(field: string, expected: number): string | null {
  const positions = [...field];
  // Try single-position substitutions first, then pairs.
  for (let round = 1; round <= 2; round++) {
    const idxs: number[][] = [[]];
    // build all combinations of `round` distinct positions
    for (let r = 1; r <= round; r++) {
      const next: number[][] = [];
      for (const base of idxs.length && r === 1 ? [[]] : idxs) {
        for (let i = 0; i < positions.length; i++) {
          if (base.includes(i)) continue;
          next.push([...base, i]);
        }
      }
      if (r === 1) {
        idxs.length = 0;
        idxs.push(...next);
      } else {
        idxs.length = 0;
        idxs.push(...next.filter((c) => c.length === r));
      }
    }
    for (const combo of idxs) {
      const trial = [...positions];
      let changed = false;
      for (const i of combo) {
        const c = trial[i];
        const alt = SUBSTITUTIONS[c];
        if (alt !== undefined) {
          trial[i] = alt;
          changed = true;
        }
      }
      if (!changed) continue;
      const t = trial.join("");
      if (checkDigit(t) === expected) return t;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Name parsing                                                        */
/* ------------------------------------------------------------------ */

const VOWELS = /[AEIOU]/;

/**
 * Structural repair of an OCR'd MRZ name field (ICAO Doc 9303 layout):
 *
 *  1. A single consonant SANDWICHED between filler runs ("AHMADI<K<NOOR")
 *     is a misread '<' — real MRZ separators are '<' and the OCR engine
 *     routinely emits K/L/C for them. Vowel initials ("<A<") are kept.
 *  2. A vowel-less letter cluster flanked by filler runs ("<<<KLKL<<<")
 *     is filler garble — every real romanized Persian/Arabic name token
 *     carries at least one vowel (A E I O U).
 *
 * Deterministic, dictionary-free. Returns the repaired field plus whether
 * garble was dropped (used to flag the name for review).
 */
export function repairNameField(field: string): { field: string; dropped: boolean } {
  // 1. consonant between fillers → filler
  let s = field.replace(/(?<=<)([B-Z])(?=<)/g, (c) => (VOWELS.test(c) ? c : "<"));
  // 2. vowel-less clusters adjacent to filler runs (or the field edges) → garble
  let dropped = false;
  const parts = s.split(/(<+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("<")) {
      out.push(p);
      continue;
    }
    const leftIsFiller = out.length > 0 && out[out.length - 1].includes("<");
    const rightIsFiller = i + 1 < parts.length && parts[i + 1].includes("<");
    // Only PURE-LETTER vowel-less clusters are garble — tokens with digits
    // are data (optional-data field: personal numbers, issue dates…).
    const pureLetters = !/\d/.test(p);
    if (pureLetters && !VOWELS.test(p) && (leftIsFiller || out.length === 0) && (rightIsFiller || i + 1 >= parts.length)) {
      dropped = true;
      out.push("<"); // treat the garble cluster as filler
    } else {
      out.push(p);
    }
  }
  return { field: out.join(""), dropped };
}

export interface MrzName {
  surname: string;
  givenNames: string;
  /** True when the << surname/given separator was reconstructed from
   *  single-< tokens (OCR merged it) — flagged for review. */
  inferredSplit?: boolean;
}

export function parseMrzName(field: string): MrzName | null {
  // field like "AHMADI<<NOOR<MOHAMMAD<<<<<<"
  const s = field.replace(/<+$/g, "");
  if (!s) return null;
  const m = s.match(/^([A-Z]+(?:<[A-Z]+)*)<<(.*)$/);
  if (m) {
    const surname = dropOcrGarble(m[1].replace(/</g, " ").trim());
    const givenNames = dropOcrGarble((m[2] || "").replace(/</g, " ").trim());
    if (!surname && !givenNames) return null;
    return { surname, givenNames };
  }
  // OCR merged the << separator into single < everywhere ("AHMADI<NOOR<MOHAMMAD"):
  // ICAO order is SURNAME first — split first token vs the rest, flagged.
  const toks = s.split(/<+/).filter(Boolean);
  if (toks.length >= 2) {
    const surname = dropOcrGarble(toks[0]);
    const givenNames = dropOcrGarble(toks.slice(1).join(" "));
    if (!surname && !givenNames) return null;
    return { surname, givenNames, inferredSplit: true };
  }
  // Single-name documents (no separator at all): everything is the surname.
  if (/^[A-Z]+$/.test(s)) return { surname: dropOcrGarble(s), givenNames: "" };
  return null;
}

/**
 * OCR filler-garbage removal: vowel-less letter clusters mixed into filler
 * runs are dropped ("LLLCLLLLLKLKL" ← misread '<' fillers). Real name tokens
 * contain vowels. Only applied inside filler-adjacent context (the caller
 * repairs the field first); a lone vowel-less token is kept only when it is
 * the whole name — and then flagged downstream.
 */
function dropOcrGarble(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens[0] ?? "";
  const kept = tokens.filter((t) => VOWELS.test(t));
  return (kept.length ? kept : tokens).join(" ");
}

/* ------------------------------------------------------------------ */
/* Format parsers                                                      */
/* ------------------------------------------------------------------ */

interface RawParsed {
  format: "TD3" | "TD2" | "TD1";
  lines: string[];
  fields: Partial<Record<CanonicalField, ExtractedValue>>;
  checks: Record<string, boolean>;
  allValid: boolean;
}

/** Pad a line with '<' or trim to reach exact length (OCR misses fillers). */
function fit(line: string, len: number): string {
  if (line.length >= len) return line.slice(0, len);
  return line + "<".repeat(len - line.length);
}

function validateWithCheck(
  value: string,
  check: string,
  label: string,
  checks: Record<string, boolean>,
): { value: string; repaired: boolean } {
  const cd = checkDigit(value);
  const expected = charValue(check);
  if (cd !== null && expected >= 0 && cd === expected) {
    checks[label] = true;
    return { value, repaired: false };
  }
  // Try repairing the *value* against the given check digit first.
  if (expected >= 0) {
    const fixed = repairAgainstCheck(value, expected);
    if (fixed) {
      checks[label] = true;
      return { value: fixed, repaired: true };
    }
    // Then try repairing the check digit itself.
    const altCheck = SUBSTITUTIONS[check] ?? (check === "0" ? "O" : undefined);
    if (altCheck !== undefined && checkDigit(value) === charValue(altCheck)) {
      checks[label] = true;
      return { value, repaired: true };
    }
  }
  checks[label] = false;
  return { value, repaired: false };
}

/** Shared name-field → fields mapping with repair + honest statuses. */
function applyMrzName(
  fields: Partial<Record<CanonicalField, ExtractedValue>>,
  nameFieldRaw: string,
): void {
  const { field: nameField, dropped } = repairNameField(nameFieldRaw);
  const name = parseMrzName(nameField);
  if (!name) return;
  const clean = !dropped && !name.inferredSplit;
  const note = name.inferredSplit
    ? "جداکنندهٔ نام/نام خانوادگی در MRZ ناخوانا بود — بازبینی کنید"
    : dropped
      ? "بخش ناخوانای نام نادیده گرفته شد — بازبینی کنید"
      : undefined;
  if (name.surname) {
    fields.surname = {
      value: name.surname,
      raw: nameFieldRaw,
      status: clean ? "confirmed" : "needs_review",
      method: "mrz",
      note,
    };
  }
  if (name.givenNames) {
    fields.givenNames = {
      value: name.givenNames,
      raw: nameFieldRaw,
      status: clean ? "confirmed" : "needs_review",
      method: "mrz",
      note,
    };
  }
  const full = `${name.givenNames} ${name.surname}`.trim();
  if (full) {
    fields.fullName = {
      value: full,
      raw: nameFieldRaw,
      status: clean ? "confirmed" : "needs_review",
      method: "mrz",
      note,
    };
  }
}

/** TD3 — passport booklet, 2 lines × 44 chars. */
function parseTD3(l1: string, l2: string): RawParsed | null {
  const A = fit(l1, 44);
  const B = fit(l2, 44);
  if (!/^P[<A-Z]/.test(A)) return null;
  const checks: Record<string, boolean> = {};
  const fields: Partial<Record<CanonicalField, ExtractedValue>> = {};
  applyMrzName(fields, A.slice(5));

  // Line 2: doc(9) ck(1) nat(3) dob(6) ck(1) sex(1) exp(6) ck(1) optional(14) ck(1)
  const docRaw = B.slice(0, 9);
  const docCk = B[9];
  const nat = B.slice(10, 13);
  const dobRaw = B.slice(13, 19);
  const dobCk = B[19];
  const sex = B[20];
  const expRaw = B.slice(21, 27);
  const expCk = B[27];
  const opt = B.slice(28, 42);
  const optCk = B[42];

  const doc = validateWithCheck(docRaw, docCk, "documentNumber", checks);
  fields.documentNumber = {
    value: doc.value.replace(/<+$/g, ""),
    raw: docRaw,
    status: checks.documentNumber ? "confirmed" : "needs_review",
    method: "mrz",
    note: checks.documentNumber ? undefined : "رقم کنترل شماره سند مطابقت ندارد",
  };
  fields.issuingCountry = {
    value: A.slice(2, 5),
    raw: A.slice(2, 5),
    status: "confirmed",
    method: "mrz",
  };
  fields.nationality = {
    value: nat,
    raw: nat,
    status: "confirmed",
    method: "mrz",
  };
  const dob = parseMrzDate(dobRaw, "birth");
  checks.dob = checkDigit(dobRaw) === charValue(dobCk);
  fields.dateOfBirth = {
    value: dob,
    raw: dobRaw,
    status: dob && checks.dob ? "confirmed" : dob ? "needs_review" : "invalid",
    method: "mrz",
    note: !dob ? "تاریخ تولد نامعتبر است" : checks.dob ? undefined : "رقم کنترل تاریخ تولد مطابقت ندارد",
  };
  const exp = parseMrzDate(expRaw, "expiry");
  checks.expiry = checkDigit(expRaw) === charValue(expCk);
  fields.dateOfExpiry = {
    value: exp,
    raw: expRaw,
    status: exp && checks.expiry ? "confirmed" : exp ? "needs_review" : "invalid",
    method: "mrz",
    note: !exp ? "تاریخ انقضا نامعتبر است" : checks.expiry ? undefined : "رقم کنترل تاریخ انقضا مطابقت ندارد",
  };
  fields.sex = {
    value: sex === "M" ? "M" : sex === "F" ? "F" : sex === "<" ? "X" : null,
    raw: sex,
    status: sex === "M" || sex === "F" || sex === "<" ? "confirmed" : "needs_review",
    method: "mrz",
  };
  // Optional data: filler-adjacent garble letters are misread '<' — clean
  // them out before deciding between personal number / issue date.
  const optClean = repairNameField(opt).field;
  const personal = optClean.replace(/<+$/g, "").replace(/</g, "").trim();
  if (personal) {
    const p = validateWithCheck(opt, optCk, "personalNumber", checks);
    fields.personalNumber = {
      value: personal,
      raw: opt,
      status: checks.personalNumber ? "confirmed" : "needs_review",
      method: "mrz",
    };
    // Some issuing states put the issue date (YYMMDD) in the optional-data
    // field. Trust it only when the optional-data check digit validates and
    // the date sits between birth and expiry — otherwise it's a personal no.
    if (checks.personalNumber && /^\d{6}$/.test(personal)) {
      const issueIso = parseMrzDate(personal, "issue");
      const dobIso = (fields.dateOfBirth?.value as string | null) ?? null;
      const expIso = (fields.dateOfExpiry?.value as string | null) ?? null;
      if (issueIso && (!dobIso || issueIso > dobIso) && (!expIso || issueIso < expIso)) {
        fields.dateOfIssue = {
          value: issueIso,
          raw: personal,
          status: "needs_review",
          method: "mrz",
          note: "تاریخ صدور از دادهٔ اختیاری MRZ خوانده شد",
        };
      }
    }
  }
  // Composite check (position 44): doc+ck, dob+ck, exp+ck, optional+ck
  // (nationality at 11-13 and sex at 21 are excluded per ICAO 9303).
  if (B.length >= 44) {
    const compositeInput =
      B.slice(0, 10) + B.slice(13, 20) + B.slice(21, 28) + B.slice(28, 43);
    const ccd = checkDigit(compositeInput);
    if (ccd !== null) checks.composite = ccd === charValue(B[43]);
  }
  return { format: "TD3", lines: [A, B], fields, checks, allValid: Object.values(checks).every(Boolean) };
}

/** TD1 — ID card, 3 lines × 30 chars. */
function parseTD1(l1: string, l2: string, l3: string): RawParsed | null {
  const A = fit(l1, 30);
  const B = fit(l2, 30);
  const C = fit(l3, 30);
  // doc code usually I< / AC / ID / C<
  if (!/^[A-Z<]{2}[A-Z]{3}/.test(A)) return null;
  const checks: Record<string, boolean> = {};
  const fields: Partial<Record<CanonicalField, ExtractedValue>> = {};

  const docRaw = A.slice(5, 14);
  const docCk = A[14];
  const optional1 = A.slice(15, 30);
  const dobRaw = B.slice(0, 6);
  const dobCk = B[6];
  const sex = B[7];
  const expRaw = B.slice(8, 14);
  const expCk = B[14];
  const nat = B.slice(15, 18);
  const optional2 = B.slice(18, 29);
  const compositeCk = B[29];

  const doc = validateWithCheck(docRaw, docCk, "documentNumber", checks);
  fields.documentNumber = {
    value: doc.value.replace(/<+$/g, ""),
    raw: docRaw,
    status: checks.documentNumber ? "confirmed" : "needs_review",
    method: "mrz",
    note: checks.documentNumber ? undefined : "رقم کنترل شماره سند مطابقت ندارد",
  };
  fields.issuingCountry = { value: A.slice(2, 5), raw: A.slice(2, 5), status: "confirmed", method: "mrz" };
  fields.nationality = { value: nat, raw: nat, status: "confirmed", method: "mrz" };
  applyMrzName(fields, C);
  const dob = parseMrzDate(dobRaw, "birth");
  checks.dob = checkDigit(dobRaw) === charValue(dobCk);
  fields.dateOfBirth = {
    value: dob,
    raw: dobRaw,
    status: dob && checks.dob ? "confirmed" : dob ? "needs_review" : "invalid",
    method: "mrz",
    note: !dob ? "تاریخ تولد نامعتبر است" : checks.dob ? undefined : "رقم کنترل تاریخ تولد مطابقت ندارد",
  };
  const exp = parseMrzDate(expRaw, "expiry");
  checks.expiry = checkDigit(expRaw) === charValue(expCk);
  fields.dateOfExpiry = {
    value: exp,
    raw: expRaw,
    status: exp && checks.expiry ? "confirmed" : exp ? "needs_review" : "invalid",
    method: "mrz",
    note: !exp ? "تاریخ انقضا نامعتبر است" : checks.expiry ? undefined : "رقم کنترل تاریخ انقضا مطابقت ندارد",
  };
  fields.sex = {
    value: sex === "M" ? "M" : sex === "F" ? "F" : sex === "<" ? "X" : null,
    raw: sex,
    status: sex === "M" || sex === "F" || sex === "<" ? "confirmed" : "needs_review",
    method: "mrz",
  };
  // Afghan e-Tazkira: optional data holds the national ID (e.g. 55358…).
  // OCR often turns trailing fillers into letter garbage — keep the leading
  // digit run only, and flag it for review.
  const opt = (optional1 + optional2).replace(/<+$/g, "");
  const nid = opt.match(/^\d{4,}/);
  if (nid) {
    fields.nationalId = {
      value: nid[0],
      raw: optional1 + "|" + optional2,
      status: "needs_review",
      method: "mrz",
      note: "شماره ملی از داده اختیاری MRZ",
    };
  }
  // Composite check: L1[6-30] + L2[1-7] + L2[9-15] + L2[19-29] + L3[1-30]
  const composite =
    A.slice(5) + B.slice(0, 7) + B.slice(8, 15) + B.slice(18, 29) + C;
  const cd = checkDigit(composite);
  if (cd !== null && charValue(compositeCk) >= 0) {
    checks.composite = cd === charValue(compositeCk);
  }
  return { format: "TD1", lines: [A, B, C], fields, checks, allValid: Object.values(checks).every(Boolean) };
}

/** TD2 — 2 lines × 36 chars (some ID / driving licences). */
function parseTD2(l1: string, l2: string): RawParsed | null {
  const A = fit(l1, 36);
  const B = fit(l2, 36);
  if (!/^[A-Z<]{2}[A-Z]{3}/.test(A)) return null;
  const checks: Record<string, boolean> = {};
  const fields: Partial<Record<CanonicalField, ExtractedValue>> = {};
  const nameField = A.slice(5, 36);
  applyMrzName(fields, nameField);
  const docRaw = B.slice(0, 9);
  const docCk = B[9];
  const nat = B.slice(10, 13);
  const dobRaw = B.slice(13, 19);
  const dobCk = B[19];
  const sex = B[20];
  const expRaw = B.slice(21, 27);
  const expCk = B[27];
  const opt = B.slice(28, 35);

  const doc = validateWithCheck(docRaw, docCk, "documentNumber", checks);
  fields.documentNumber = {
    value: doc.value.replace(/<+$/g, ""),
    raw: docRaw,
    status: checks.documentNumber ? "confirmed" : "needs_review",
    method: "mrz",
  };
  fields.issuingCountry = { value: A.slice(2, 5), raw: A.slice(2, 5), status: "confirmed", method: "mrz" };
  fields.nationality = { value: nat, raw: nat, status: "confirmed", method: "mrz" };
  const dob = parseMrzDate(dobRaw, "birth");
  checks.dob = checkDigit(dobRaw) === charValue(dobCk);
  fields.dateOfBirth = {
    value: dob,
    raw: dobRaw,
    status: dob && checks.dob ? "confirmed" : "needs_review",
    method: "mrz",
  };
  const exp = parseMrzDate(expRaw, "expiry");
  checks.expiry = checkDigit(expRaw) === charValue(expCk);
  fields.dateOfExpiry = {
    value: exp,
    raw: expRaw,
    status: exp ? "confirmed" : "needs_review",
    method: "mrz",
  };
  fields.sex = {
    value: sex === "M" ? "M" : sex === "F" ? "F" : sex === "<" ? "X" : null,
    raw: sex,
    status: "confirmed",
    method: "mrz",
  };
  const personal = repairNameField(opt).field.replace(/<+$/g, "").replace(/</g, "").trim();
  if (personal) fields.personalNumber = { value: personal, raw: opt, status: "needs_review", method: "mrz" };
  return { format: "TD2", lines: [A, B], fields, checks, allValid: Object.values(checks).every(Boolean) };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse the first valid MRZ found in `text`.
 * Tries every candidate group as TD3 / TD2 / TD1 and returns the best
 * (most check digits valid). Deterministic: same input → same output.
 */
export function parseMrzFromText(text: string): {
  fields: Partial<Record<CanonicalField, ExtractedValue>>;
  mrz: MrzValidation;
  kind: "passport" | "id_card" | null;
} | null {
  const groups = findMrzCandidates(text);
  let best: (RawParsed & { kind: "passport" | "id_card" }) | null = null;
  let bestScore = -1;

  for (const g of groups) {
    const attempts: (RawParsed | null)[] = [];
    if (g.length >= 2) {
      attempts.push(parseTD3(g[0], g[1]));
      attempts.push(parseTD2(g[0], g[1]));
    }
    if (g.length >= 3) attempts.push(parseTD1(g[0], g[1], g[2]));
    // Sometimes OCR merges/splits lines — try shifted pairs.
    if (g.length >= 3) attempts.push(parseTD3(g[1], g[2]));
    for (const a of attempts) {
      if (!a) continue;
      const validCount = Object.values(a.checks).filter(Boolean).length;
      const hasName = Boolean(a.fields.surname?.value);
      const fieldCount = Object.keys(a.fields).length;
      const score = validCount * 10 + (hasName ? 5 : 0) + fieldCount;
      if (score > bestScore) {
        bestScore = score;
        best = { ...a, kind: a.format === "TD3" ? "passport" : "id_card" };
      }
    }
  }
  if (!best) return null;
  return {
    fields: best.fields,
    mrz: { format: best.format, lines: best.lines, checks: best.checks, allValid: best.allValid },
    kind: best.kind,
  };
}
