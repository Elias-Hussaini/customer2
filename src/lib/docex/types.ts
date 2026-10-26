/**
 * Canonical data model for rule-based document extraction (docex).
 *
 * Everything here is deterministic — no AI services, no cloud calls.
 * Uncertainty is represented per field, never hidden behind one score.
 */

/** Per-field provenance & validation state. */
export type FieldStatus = "confirmed" | "needs_review" | "invalid" | "not_found";

/** How a value was obtained. Ordered by reliability for merge decisions. */
export type ExtractionMethod =
  | "mrz" // machine-readable zone, check-digit validated
  | "pdf_text" // selectable text layer inside a PDF
  | "ocr_printed" // OCR of printed (typeset) text
  | "ocr_handwriting" // OCR attempt on handwriting / Nastaliq — low trust
  | "manual"; // typed by the operator

export const METHOD_RANK: Record<ExtractionMethod, number> = {
  mrz: 5,
  pdf_text: 4,
  ocr_printed: 3,
  ocr_handwriting: 1,
  manual: 2,
};

export type CanonicalField =
  | "surname"
  | "givenNames"
  | "fullName"
  | "documentNumber"
  | "nationality"
  | "issuingCountry"
  | "dateOfBirth"
  | "placeOfBirth"
  | "sex"
  | "dateOfIssue"
  | "dateOfExpiry"
  | "entryDate"
  | "personalNumber"
  | "fatherName"
  | "nationalId"
  | "occupation";

/** A single extracted value with its own status + provenance. */
export interface ExtractedValue<T = string> {
  /** Normalized value (dates as ISO yyyy-mm-dd, names as written on the doc). */
  value: T | null;
  /** Original recognized string, preserved verbatim for review. */
  raw: string | null;
  status: FieldStatus;
  method: ExtractionMethod;
  /** Human-readable Persian explanation when status != confirmed. */
  note?: string;
}

/** MRZ check-digit summary for the document. */
export interface MrzValidation {
  format: "TD3" | "TD2" | "TD1";
  /** Raw MRZ lines after cleanup. */
  lines: string[];
  /** Field -> check digit ok? (absent when not applicable) */
  checks: Record<string, boolean>;
  /** True when every applicable check digit validated. */
  allValid: boolean;
}

export type DocumentKind =
  | "passport" // TD3 booklet
  | "id_card" // TD1/TD2 card (e-ID, tazkira card)
  | "tazkira_paper" // paper booklet / printout, no MRZ
  | "visa_form" // visa application form
  | "photo" // portrait photo, no text
  | "unknown";

/** Result of processing one page of the uploaded file. */
export interface PageResult {
  index: number; // 1-based
  kind: DocumentKind;
  /** Text that was actually read (PDF layer or OCR). Empty string = nothing. */
  text: string;
  method: ExtractionMethod | null;
  /** Mean OCR confidence 0..100 when OCR ran (tesseract). */
  ocrConfidence: number | null;
  /** Preview data URL of the rendered page (for review UI). */
  previewDataUrl: string | null;
  mrz: MrzValidation | null;
  /** Fields parsed from this page only. */
  fields: Partial<Record<CanonicalField, ExtractedValue>>;
  /** Page relevance — only tier 1/2 pages may feed identity fields
   *  (tier 3 = cover/stamp/letter: its text is deliberately ignored). */
  relevance?: { tier: 1 | 2 | 3; strongHits: number };
}

/** Fully merged, reviewed extraction across all pages of one upload. */
export interface ExtractionResult {
  pages: PageResult[];
  fields: Partial<Record<CanonicalField, ExtractedValue>>;
  detectedKinds: DocumentKind[];
  /** Non-fatal processing notes for the operator (Persian). */
  warnings: string[];
  fileName: string;
  fileSize: number;
  processedAt: number;
}

/** Supported sex markers normalized. */
export type Sex = "M" | "F" | "X";

/** A document profile = deterministic rules for one document family. */
export interface LabelRule {
  field: CanonicalField;
  /** Label patterns (against normalized single lines). */
  labels: string[];
  /** Value may sit on the same line after the label, or the next line. */
  sameLine?: boolean;
  /** Date fields get extra parsing. */
  isDate?: boolean;
  /** Validator regexp for the value (charset check). */
  valuePattern?: RegExp;
}

export interface DocumentProfile {
  id: string;
  /** Persian display name. */
  title: string;
  kinds: DocumentKind[];
  /** Text label rules (English + Dari/Persian aliases). */
  labelRules: LabelRule[];
  /** OCR languages to try, in order (tesseract codes). */
  ocrLangs: string[];
  /** Preprocess tweaks. */
  preprocess?: { binarize?: boolean; contrast?: number; rotate?: boolean };
}
