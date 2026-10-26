/**
 * docex — rule-based document extraction & PDF fill (public surface).
 * No AI services: MRZ (ICAO 9303), pdf.js text layer, local tesseract OCR
 * and configurable label profiles. Everything runs in the browser.
 */
export * from "./types";
export { parseMrzFromText, checkDigit, cleanMrzLine, parseMrzName, findMrzCandidates } from "./mrz";
export { parsePrintedDate, parseMrzDate } from "./dates";
export {
  latinNameToFa,
  latinTokenToFa,
  faNameToLatinKey,
  latinNameToKey,
  namesMatch,
} from "./translit";
export {
  extractByLabels,
  extractByLayout,
  findDateCandidates,
  disambiguateIssueDate,
  detectKind,
  normalizeUnicodeLine,
  foldForLabel,
  levenshtein,
  PASSPORT_PROFILE,
  TAZKIRA_PROFILE,
  VISA_FORM_PROFILE,
  VISA_STAMP_PROFILE,
  PROFILES,
} from "./text";
export { runExtraction, validateFile, MAX_FILE_BYTES, MAX_TEXT_PAGES, MAX_OCR_PAGES } from "./pipeline";
export type { PipelineProgress, PipelineStage, RunOptions } from "./pipeline";
export { scorePageText, isIdentitySource, filterNameTokens, isGarbageNameToken } from "./score";
export type { PageRelevance } from "./score";
export { preprocessCanvas, releaseOcr, resetWorker, warmupOcr } from "./ocr";
export { openPdf, hasTextLayer } from "./pdfread";
export { matchCustomers, diffWithCustomer } from "./match";
export type { CustomerMatch, FieldDiff, MatchLevel } from "./match";
export {
  detectAcroFields,
  fillTemplate,
  formatDateForTemplate,
  suggestSource,
  sourceValue,
  applyCasing,
  persianPreview,
} from "./fill";
export type {
  PdfTemplate,
  AcroMapping,
  CoordMapping,
  DetectedField,
  TemplateSource,
  DateFormat,
  Casing,
  FillContext,
  FillReport,
} from "./fill";
