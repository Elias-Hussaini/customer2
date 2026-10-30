/**
 * LOCAL deterministic document classification — «الگوریتم الگو».
 *
 * The cloud AI is a luxury, not a dependency: when the worker answers
 * garbage (or maps everything to «سایر مدارک»), these INVARIANT patterns
 * still decide where a document belongs — they are printed on the document
 * itself and never change:
 *
 *   1. FILENAME      — «پاسپورت.pdf», «تذکره-پشت.jpg», «passport.png»…
 *   2. PDF TEXT LAYER — MRZ lines + header keywords, read directly (no OCR).
 *   3. MRZ (ICAO 9303) — TD3 2×44 = passport data page, TD1/TD2 = e-ID
 *      card. Validated with the 7-3-1 check digits: a valid MRZ is proof,
 *      not a guess. Found via local OCR (tesseract, eng) when there is no
 *      text layer.
 *
 * Verdicts carry a basis so the UI can show WHY each file landed where it
 * did («الگوی MRZ»، «نام فایل»، «لایهٔ متن PDF»، «هوش مصنوعی»…).
 */

import type { DocSlotOption, DocSortTarget } from "./docsort";

/* ------------------------------------------------------------------ */
/* ICAO 7-3-1 check digits                                             */
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
/* MRZ line detection inside arbitrary text                            */
/* ------------------------------------------------------------------ */

/** Strip spaces/punctuation and normalize common OCR confusions. */
export function cleanMrzLine(rawLine: string): string {
  let s = rawLine
    .toUpperCase()
    .replace(/[\s\u00A0]/g, "")
    .replace(/[^A-Z0-9<]/g, "");
  s = s.replace(/Ø/g, "<").replace(/[{([]/g, "<");
  // Stray letters inside filler runs are almost always '<' (K, C, L…).
  s = s.replace(/(?<=<)[A-Z](?=<{2,})/g, "<");
  s = s.replace(/(?<=<{2,})[A-Z](?=<)/g, "<");
  return s;
}

function mrzness(line: string): number {
  if (!line.length) return 0;
  let ok = 0;
  for (const c of line) if (/[A-Z0-9<]/.test(c)) ok++;
  return ok / line.length;
}

/**
 * Groups of consecutive lines that look like an MRZ. A candidate line is
 * long, mostly MRZ-charset and carries digits or filler runs.
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
/* MRZ format detection + validation → document kind                   */
/* ------------------------------------------------------------------ */

export type MrzDocKind = "passport" | "idcard";

export interface MrzDetection {
  kind: MrzDocKind;
  /** Check-digit tests passed / total (composite included). */
  passed: number;
  total: number;
  /** True when every check digit validates — mathematical certainty. */
  certain: boolean;
  format: "TD3" | "TD2" | "TD1";
}

/** Pad a short line with fillers / trim a long one (OCR misses fillers). */
function fit(line: string, len: number): string {
  if (line.length >= len) return line.slice(0, len);
  return line + "<".repeat(len - line.length);
}

function digitOk(field: string, check: string): boolean {
  const cd = checkDigit(field);
  const expected = charValue(check);
  return cd !== null && expected >= 0 && cd === expected;
}

/** TD3 — passport booklet: 2 lines × 44, line 1 starts with «P<». */
function tryTD3(lines: string[]): MrzDetection | null {
  if (lines.length < 2) return null;
  const A = fit(lines[0], 44);
  const B = fit(lines[1], 44);
  if (!/^P[<A-Z]/.test(A)) return null;
  // ICAO 9303-5 composite check digit: line 2 positions 1-10, 14-20 and
  // 22-43 (0-based [0:10)+[13:20)+[21:43)), stored at line2[43].
  const compChar = B[43];
  const compInput = B.slice(0, 10) + B.slice(13, 20) + B.slice(21, 43);
  const parts: [boolean, string, string][] = [
    [digitOk(B.slice(0, 9), B[9]), B.slice(0, 9), B[9]], // document number
    [digitOk(B.slice(13, 19), B[19]), B.slice(13, 19), B[19]], // date of birth
    [digitOk(B.slice(21, 27), B[27]), B.slice(21, 27), B[27]], // expiry
    [compChar >= "0" && compChar <= "9" && digitOk(compInput, compChar), compInput, compChar],
  ];
  const passed = parts.filter((p) => p[0]).length;
  if (passed < 2) return null; // misread garbage, not an MRZ
  return {
    kind: "passport",
    passed,
    total: parts.length,
    certain: passed >= 3,
    format: "TD3",
  };
}

/** TD1 — ID card: 3 lines × 30, line 1 starts with «I<» or «I»+state. */
function tryTD1(lines: string[]): MrzDetection | null {
  if (lines.length < 3) return null;
  const A = fit(lines[0], 30);
  const B = fit(lines[1], 30);
  if (!/^I[<A-Z]/.test(A)) return null;
  // ICAO 9303-3 TD1: line1[5-13] document number, check digit line1[14];
  // line2[0-5] DOB check [6]; line2[8-13] expiry check [14]; composite check
  // digit at line2[29] over line1[5-30) + line2[0-7) + line2[8-15) + line2[18-29).
  const docOk = digitOk(A.slice(5, 14), A[14]);
  const dobOk = digitOk(B.slice(0, 6), B[6]);
  const expOk = digitOk(B.slice(8, 14), B[14]);
  const composite = A.slice(5, 30) + B.slice(0, 7) + B.slice(8, 15) + B.slice(18, 29);
  const compOk = B[29] >= "0" && B[29] <= "9" ? digitOk(composite, B[29]) : false;
  const checks = [docOk, dobOk, expOk, compOk];
  const passed = checks.filter(Boolean).length;
  if (passed < 2) return null;
  return { kind: "idcard", passed, total: checks.length, certain: passed >= 3, format: "TD1" };
}

/**
 * TD2 — ID card, 2 lines × 36, line 1 starts with «I<». ICAO 9303-3 TD2:
 * line1[5-13] document number + check digit line1[14]; line2[0-5] DOB check
 * [6], sex [7], line2[8-13] expiry check [14], nationality [15-17], optional
 * [18-34], composite check digit line2[35] over line2[0-7) + [8-15) + [18-35).
 */
function tryTD2(lines: string[]): MrzDetection | null {
  if (lines.length < 2) return null;
  const A = fit(lines[0], 36);
  const B = fit(lines[1], 36);
  if (!/^I[<A-Z]/.test(A)) return null;
  const docOk = digitOk(A.slice(5, 14), A[14]);
  const dobOk = digitOk(B.slice(0, 6), B[6]);
  const expOk = digitOk(B.slice(8, 14), B[14]);
  const composite = B.slice(0, 7) + B.slice(8, 15) + B.slice(18, 35);
  const compOk = /[0-9]/.test(B[35]) ? digitOk(composite, B[35]) : false;
  const checks = [docOk, dobOk, expOk, compOk];
  const passed = checks.filter(Boolean).length;
  if (passed < 2) return null;
  return { kind: "idcard", passed, total: checks.length, certain: passed >= 3, format: "TD2" };
}

/**
 * Find and validate an MRZ inside arbitrary text (PDF text layer or OCR).
 * Returns the strongest detection across all candidate groups.
 */
export function detectMrz(text: string): MrzDetection | null {
  let best: MrzDetection | null = null;
  for (const group of findMrzCandidates(text)) {
    const tries = [tryTD3(group), tryTD1(group), tryTD2(group)].filter(
      (t): t is MrzDetection => t !== null,
    );
    for (const t of tries) {
      if (!best || t.passed > best.passed || (t.passed === best.passed && t.certain && !best.certain)) {
        best = t;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Slot matching — document kind → the user's own slot list            */
/* ------------------------------------------------------------------ */

/** Normalize Persian text for comparisons (spaces/ZWNJ/prefix عکس ignored). */
function normFa(s: string): string {
  return s
    .replace(/[\s\u200c\u200f\u200e]+/g, "")
    .replace(/^عکس/, "")
    .replace(/^اسکن/, "")
    .replace(/^سند/, "");
}

export type SlotKind = "passport" | "tazkiraFront" | "tazkiraBack";

/** Which built-in document KIND a slot label refers to (keyword rules). */
export function slotKind(label: string): SlotKind | null {
  const n = normFa(label);
  if (n.includes("پاسپورت") || n.includes("پاسپورط")) return "passport";
  if (n.includes("تذکره") || n.includes("تذکاری")) {
    return n.includes("پشت") || n.includes("عقب") ? "tazkiraBack" : "tazkiraFront";
  }
  return null;
}

/** Find the slot matching a document kind, or null when the agency has none. */
export function findSlotForKind(slots: DocSlotOption[], kind: SlotKind): DocSlotOption | null {
  for (const s of slots) {
    if (slotKind(s.label) === kind) return s;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 1) Filename patterns                                                */
/* ------------------------------------------------------------------ */

export type LocalBasis = "filename" | "pdftext" | "mrz" | "ocr";

export interface LocalVerdict {
  target: DocSortTarget;
  basis: LocalBasis;
  certain: boolean;
}

const FA_LETTER = /[\u0621-\u064A\u0671-\u06D3]/;

/**
 * Classify by the FILE NAME ONLY. File names are typed by humans, so the
 * vocabulary is small and the match is deterministic:
 *   پاسپورت / passport / pasport …      → passport slot
 *   تذکره + پشت / back                  → tazkira back slot
 *   تذکره (+ روی / front)               → tazkira front slot
 *   عکس شخصی / پرسنل / personal photo   → profile photo
 */
export function classifyByFilename(
  name: string,
  slots: DocSlotOption[],
): LocalVerdict | null {
  const n = name.toLowerCase();
  const fa = FA_LETTER.test(name);
  if (!n.trim()) return null;

  const hasPassport =
    n.includes("passport") || n.includes("pasport") || name.includes("پاسپورت") || name.includes("پاسپورط");
  const hasTazkira =
    n.includes("tazkira") || n.includes("tazkere") || name.includes("تذکره") || name.includes("تذکاری");
  const hasBack =
    n.includes("back") || name.includes("پشت") || name.includes("عقب") || n.includes("پشت");
  const hasFront = n.includes("front") || name.includes("روی") || name.includes("جلوي") || name.includes("جلو");
  const hasPhoto =
    n.includes("personal") || n.includes("portrait") || n.includes("photo") ||
    name.includes("عکس شخصی") || name.includes("شخصی") || name.includes("پرسنل") || name.includes("پرنسل");

  // A personal photo is never a document page.
  if (hasPhoto && !hasPassport && !hasTazkira) return { target: { kind: "photo" }, basis: "filename", certain: false };

  if (hasPassport) {
    const slot = findSlotForKind(slots, "passport");
    if (slot) return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis: "filename", certain: true };
  }
  if (hasTazkira) {
    const kind: SlotKind = hasBack ? "tazkiraBack" : "tazkiraFront";
    const slot = findSlotForKind(slots, kind);
    if (slot) return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis: "filename", certain: true };
    // تذکره named but no تذکره slot — try the other side before giving up.
    const other = findSlotForKind(slots, hasBack ? "tazkiraFront" : "tazkiraBack");
    if (other) return { target: { kind: "slot", slotId: other.id, label: other.label }, basis: "filename", certain: false };
  }
  void fa;
  return null;
}

/* ------------------------------------------------------------------ */
/* 2+3) Text classification (PDF text layer or OCR output)             */
/* ------------------------------------------------------------------ */

/** Identity-side labels — printed on the FRONT of a تذکره. */
const FRONT_LABELS = [
  "نام پدر", "نام پدربزرگ", "زادگاه", "زادۀ", "سال تولد", "تخلص", "ولد",
  "نام خانوادگی", "مذهب", "ولایت", "جنسیت", "خواهر", "برادر",
];
/** Issue/record-side labels — printed on the BACK of a paper تذکره. */
const BACK_LABELS = [
  "تاریخ صدور", "محل صدور", "نشانی", "نشانۀ", "شماره پرونده", "قوس",
  "جدید", "تمدید", "صفحهٔ", "برگهٔ",
];
/** State header printed on Afghan identity papers. */
const STATE_HEADERS = ["جمهوری اسلامی افغانستان", "وزارت داخله", "افغانستان"];

export interface TazkiraSideScore {
  front: number;
  back: number;
  /** Distinct matched labels (not raw counts). */
  frontLabels: string[];
  backLabels: string[];
}

/** Score which SIDE of a تذکره the text comes from. Pure + deterministic. */
export function scoreTazkiraSide(text: string): TazkiraSideScore {
  const norm = text.replace(/[\u200c\u200f\u200e]/g, " ").replace(/\s+/g, " ");
  const frontLabels = FRONT_LABELS.filter((l) => norm.includes(l));
  const backLabels = BACK_LABELS.filter((l) => norm.includes(l));
  const header = STATE_HEADERS.filter((h) => norm.includes(h)).length;
  return {
    front: frontLabels.length + (header > 0 ? 1 : 0),
    back: backLabels.length,
    frontLabels,
    backLabels,
  };
}

/**
 * Classify a document from RAW TEXT (PDF text layer, or OCR output).
 * MRZ verdicts are check-digit backed; label verdicts need ≥2 distinct
 * identity labels to count.
 */
export function classifyByText(
  text: string,
  slots: DocSlotOption[],
  basis: LocalBasis,
): LocalVerdict | null {
  if (!text || !text.trim()) return null;

  // --- MRZ: the mathematical proof -------------------------------------
  const mrz = detectMrz(text);
  if (mrz) {
    if (mrz.kind === "passport") {
      const slot = findSlotForKind(slots, "passport");
      if (slot) {
        return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis, certain: mrz.certain || mrz.passed >= 3 };
      }
    } else {
      // TD1/TD2 = the electronic ID card — its data side is the FRONT.
      const slot = findSlotForKind(slots, "tazkiraFront");
      if (slot) {
        return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis, certain: mrz.certain || mrz.passed >= 3 };
      }
    }
  }

  // --- English passport keywords (covers pages without MRZ) ------------
  const up = text.toUpperCase();
  const passportHits = ["PASSPORT", "REPUBLIC OF AFGHANISTAN", "ISLAMIC REPUBLIC OF AFGHANISTAN"].filter((k) =>
    up.includes(k),
  ).length;
  if (passportHits >= 1 && !FA_LETTER.test(text)) {
    const slot = findSlotForKind(slots, "passport");
    if (slot) return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis, certain: passportHits >= 2 };
  }

  // --- تذکره side by labels --------------------------------------------
  const side = scoreTazkiraSide(text);
  const isTazkiraText =
    text.includes("تذکره") || text.includes("تذکاری") || side.front > 0 || side.back > 0;
  if (isTazkiraText) {
    if (side.front >= 2 && side.front > side.back) {
      const slot = findSlotForKind(slots, "tazkiraFront");
      if (slot) return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis, certain: side.front >= 3 && side.back === 0 };
    }
    if (side.back >= 2 && side.back > side.front) {
      const slot = findSlotForKind(slots, "tazkiraBack");
      if (slot) return { target: { kind: "slot", slotId: slot.id, label: slot.label }, basis, certain: side.back >= 3 && side.front === 0 };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Merge — local verdict vs cloud AI answer                            */
/* ------------------------------------------------------------------ */

/**
 * Decide the final target for one piece.
 *
 * - A CERTAIN local verdict (valid MRZ check digits, filename rule, or a
 *   text-layer MRZ) beats ANY cloud answer — the pattern is printed on the
 *   document and cannot be argued with, while the model may be having a bad
 *   day (the «همه چیز → سایر مدارک» failure).
 * - A LIKELY local verdict beats only «other»/broken cloud answers.
 * - No local verdict → the cloud answer stands.
 */
export function mergeVerdicts(
  local: LocalVerdict | null,
  cloud: DocSortTarget | null,
): { target: DocSortTarget | null; basis: LocalBasis | "ai" | "unknown" } {
  if (local && local.certain) return { target: local.target, basis: local.basis };
  if (local && (!cloud || cloud.kind === "other")) return { target: local.target, basis: local.basis };
  if (cloud && cloud.kind !== "other") return { target: cloud, basis: "ai" };
  if (cloud) return { target: cloud, basis: "ai" };
  return { target: local?.target ?? null, basis: local ? local.basis : "unknown" };
}
