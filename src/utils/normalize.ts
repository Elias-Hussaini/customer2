/**
 * Persian/Arabic text normalization for search and duplicate detection.
 * Makes «يوسف» match «یوسف», «كاشان» match «کاشان», and ۱۲۳ match 123.
 */
export function normalizeFa(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/[\u064A\u0649]/g, "\u06CC") // ي ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // آ أ إ → ا
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0624/g, "\u0648") // ؤ → و
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/\u200C|\u200E|\u200F|\uFEFF/g, "") // ZWNJ & marks
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // Persian digits
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic digits
    .replace(/\u060C/g, ",")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Normalize passport-style identifiers: uppercase latin, strip spaces. */
export function normalizePassport(input: string | null | undefined): string {
  if (!input) return "";
  return toComparableLatin(input);
}

function toComparableLatin(input: string): string {
  return normalizeDigitsOnlySpaces(input).toUpperCase().replace(/\s+/g, "");
}

function normalizeDigitsOnlySpaces(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Normalize phone numbers for comparison: latin digits only. */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  return toLatinDigitsStr(input).replace(/[^\d+]/g, "");
}

function toLatinDigitsStr(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Build a stable slug for custom-field keys from a Persian label. */
export function slugify(input: string): string {
  const base = normalizeFa(input)
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "field";
}
