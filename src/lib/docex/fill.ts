/**
 * Visa-application PDF filling via pdf-lib.
 *
 * Two modes:
 *  - AcroForm templates: field names are auto-mapped by alias heuristics,
 *    then manually adjustable; values are written into real form fields.
 *  - Coordinate templates: for scanned/flat PDFs, values are drawn at
 *    operator-defined positions (Latin text only — a documented limitation).
 *
 * The source file is never modified; a new PDF is always generated.
 */
import type { Customer } from "../../types";
import { toJalaali } from "jalaali-js";
import { faNameToLatin } from "./translit";

/* ------------------------------------------------------------------ */
/* Template model                                                      */
/* ------------------------------------------------------------------ */

/** Customer-side source for a PDF field. */
export type TemplateSource =
  | "firstName" | "lastName" | "fullName" | "passportNo" | "birthDate"
  | "passportIssueDate" | "passportExpiryDate" | "referrer" | "notes"
  | "listName" | "representativeName" | "nationalId" | "fatherName"
  | "sex" | "nationality" | "static";

export type DateFormat = "iso" | "ddmmyyyy" | "ddmmyy" | "yyyymmdd" | "jalali" | "dmonyyyy";
export type Casing = "raw" | "upper" | "title";

export interface AcroMapping {
  /** PDF field name (as in the AcroForm). */
  pdfField: string;
  source: TemplateSource | null;
  dateFormat: DateFormat;
  casing: Casing;
  /** Static text used when source === "static". */
  staticText?: string;
  required: boolean;
}

export interface CoordMapping extends AcroMapping {
  page: number; // 1-based
  /** PDF user-space coordinates (origin bottom-left). */
  x: number;
  y: number;
  fontSize: number;
}

export interface PdfTemplate {
  id: string;
  name: string;
  kind: "acroform" | "coords";
  /** The template PDF itself, stored in IndexedDB. */
  file: Uint8Array;
  fileName: string;
  pageCount: number;
  mappings: AcroMapping[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Field auto-detection                                                */
/* ------------------------------------------------------------------ */

export interface DetectedField {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown" | "button" | "unknown";
  /** Heuristic source suggestion (null = no guess). */
  suggested: TemplateSource | null;
  options?: string[];
}

const ALIASES: Array<[RegExp, TemplateSource]> = [
  [/^(sur ?name|family ?name|last ?name|nom)/i, "lastName"],
  [/^(given ?names?|first ?name|forename|prenom)/i, "firstName"],
  [/^(full ?name|name(?!.*(father|mother))$|nom et prenom)/i, "fullName"],
  [/(passport|travel ?document).*(no|num|number|#)|^p\.?p\.? ?no/i, "passportNo"],
  [/(date)?.*of ?birth|^dob$|birth.*date|تاریخ تولد/i, "birthDate"],
  [/(date)?.*(issue|deliv)/i, "passportIssueDate"],
  [/(date)?.*(expir|valid)/i, "passportExpiryDate"],
  [/^(sex|gender)/i, "sex"],
  [/national ?id|tazkira|تذکره/i, "nationalId"],
  [/nationality|ملیت|تبعه/i, "nationality"],
  [/father|پدر/i, "fatherName"],
  [/referrer|معرف/i, "referrer"],
  [/representative|نماینده/i, "representativeName"],
  [/^list$|لیست/i, "listName"],
];

export function suggestSource(fieldName: string): TemplateSource | null {
  const clean = fieldName.replace(/[^A-Za-z\u0600-\u06FF0-9 ]/g, " ").trim();
  for (const [re, src] of ALIASES) {
    if (re.test(clean)) return src;
  }
  return null;
}

/** Inspect a template PDF's AcroForm fields (pdf-lib, lazy-loaded). */
export async function detectAcroFields(bytes: Uint8Array): Promise<DetectedField[]> {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFButton } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const fields = form.getFields();
  return fields
    .map((f): DetectedField => {
      const name = f.getName();
      // instanceof — safe under production minification (constructor.name is not).
      const type: DetectedField["type"] =
        f instanceof PDFTextField ? "text" :
        f instanceof PDFCheckBox ? "checkbox" :
        f instanceof PDFRadioGroup ? "radio" :
        f instanceof PDFDropdown ? "dropdown" :
        f instanceof PDFButton ? "button" : "unknown";
      let options: string[] | undefined;
      if (f instanceof PDFDropdown) {
        try { options = f.getOptions(); } catch { options = undefined; }
      } else if (f instanceof PDFRadioGroup) {
        try { options = f.getOptions(); } catch { options = undefined; }
      }
      return { name, type, suggested: suggestSource(name), options };
    })
    .filter((f) => f.type !== "button" && f.type !== "unknown");
}

/* ------------------------------------------------------------------ */
/* Value formatting                                                    */
/* ------------------------------------------------------------------ */

const EN_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatDateForTemplate(iso: string, fmt: DateFormat): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = +m[1], mo = +m[2], d = +m[3];
  switch (fmt) {
    case "iso": return iso;
    case "ddmmyyyy": return `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`;
    case "ddmmyy": return `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${String(y).slice(2)}`;
    case "yyyymmdd": return `${y}${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    case "dmonyyyy": return `${String(d).padStart(2, "0")} ${EN_MONTHS[mo - 1]} ${y}`;
    case "jalali": {
      try {
        const j = toJalaali(y, mo, d);
        return `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`;
      } catch {
        return iso;
      }
    }
  }
}

const SEX_FA: Record<string, string> = { M: "مرد", F: "زن", X: "" };

export interface FillContext {
  customer: Customer;
  listName?: string | null;
  representativeName?: string | null;
  /** Extra values (from extraction) that override customer data. */
  overrides?: Partial<Record<TemplateSource, string>>;
}

export function sourceValue(ctx: FillContext, src: TemplateSource | null, staticText?: string): string | null {
  if (!src) return null;
  if (src === "static") return staticText ?? "";
  const o = ctx.overrides?.[src];
  if (o != null && o !== "") return o;
  const c = ctx.customer;
  switch (src) {
    case "firstName": return c.firstName ?? null;
    case "lastName": return c.lastName ?? null;
    case "fullName": return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || null;
    case "passportNo": return c.passportNo ?? null;
    case "birthDate": return c.birthDate ?? null;
    case "passportIssueDate": return c.passportIssueDate ?? null;
    case "passportExpiryDate": return c.passportExpiryDate ?? null;
    case "referrer": return c.referrer ?? null;
    case "notes": return c.notes ?? null;
    case "listName": return ctx.listName ?? null;
    case "representativeName": return ctx.representativeName ?? null;
    case "nationalId": {
      const v = c.customValues?.["nationalId"] ?? c.customValues?.["شماره تذکره"];
      return v != null ? String(v) : null;
    }
    case "fatherName": {
      const v = c.customValues?.["fatherName"] ?? c.customValues?.["نام پدر"];
      return v != null ? String(v) : null;
    }
    case "nationality": {
      const v = c.customValues?.["nationality"] ?? c.customValues?.["ملیت"];
      return v != null ? String(v) : null;
    }
    case "sex": {
      const v = c.customValues?.["sex"] ?? c.customValues?.["جنس"];
      if (v != null) return SEX_FA[String(v)] ?? String(v);
      return null;
    }
  }
}

export function applyCasing(text: string, casing: Casing): string {
  if (casing === "upper") return text.toUpperCase();
  if (casing === "title") return text.replace(/\S+/g, (w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase());
  return text;
}

/* ------------------------------------------------------------------ */
/* Font-safety: standard PDF fonts (Helvetica…) are WinAnsi-only        */
/* ------------------------------------------------------------------ */

/** Chars representable in WinAnsi (Latin-1 + a fixed extras set). */
const WINANSI_EXTRA = new Set(
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178".split(""),
);

export function isWinAnsiSafe(text: string): boolean {
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code <= 0xff) continue;
    if (WINANSI_EXTRA.has(c)) continue;
    return false;
  }
  return true;
}

/**
 * Resolve a value the AcroForm font can actually encode. Persian text →
 * deterministic Latin transliteration (visa forms are Latin anyway).
 * Returns null when no safe representation exists — never silently dropped.
 */
function winAnsiValue(
  text: string,
): { value: string; transliterated: boolean } | null {
  if (isWinAnsiSafe(text)) return { value: text, transliterated: false };
  const latin = faNameToLatin(text);
  if (latin && isWinAnsiSafe(latin)) return { value: latin, transliterated: true };
  return null;
}

/* ------------------------------------------------------------------ */
/* Filling                                                             */
/* ------------------------------------------------------------------ */

export interface FillReport {
  filled: Array<{ pdfField: string; value: string }>;
  missing: Array<{ pdfField: string; source: string }>;
  /** Fields written as Latin transliteration because the form font cannot
   *  encode the original (e.g. Persian) text — surfaced to the operator. */
  transliterated: Array<{ pdfField: string; from: string; to: string }>;
  errors: string[];
}

export async function fillTemplate(
  template: PdfTemplate,
  ctx: FillContext,
): Promise<{ bytes: Uint8Array; report: FillReport }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const report: FillReport = { filled: [], missing: [], transliterated: [], errors: [] };
  const copy = new Uint8Array(template.file.byteLength);
  copy.set(template.file);
  let doc: import("pdf-lib").PDFDocument;
  try {
    doc = await PDFDocument.load(copy, { ignoreEncryption: true });
  } catch {
    report.errors.push("قالب PDF قابل بازکردن نیست (رمزگذاری‌شده یا خراب).");
    throw new Error("template-load-failed");
  }

  if (template.kind === "acroform") {
    const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } = await import("pdf-lib");
    const form = doc.getForm();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const m of template.mappings) {
      const raw = sourceValue(ctx, m.source, m.staticText);
      const isDateSource =
        m.source === "birthDate" || m.source === "passportIssueDate" || m.source === "passportExpiryDate";
      const text = raw && isDateSource ? formatDateForTemplate(raw, m.dateFormat) : raw;
      if (text == null || text === "") {
        if (m.required) report.missing.push({ pdfField: m.pdfField, source: m.source ?? "—" });
        continue;
      }
      const final = applyCasing(text, m.casing);
      // Standard PDF fonts cannot encode Persian — fall back to a
      // deterministic Latin transliteration and report it honestly.
      const safe = winAnsiValue(final);
      if (!safe) {
        report.errors.push(
          `فیلد «${m.pdfField}»: متن «${final.slice(0, 20)}» با فونت این فرم قابل نوشتن نیست (فارسی/یونیکد) و معادل لاتینی هم ندارد.`,
        );
        continue;
      }
      if (safe.transliterated) {
        report.transliterated.push({ pdfField: m.pdfField, from: final, to: safe.value });
      }
      try {
        const field = form.getFieldMaybe(m.pdfField);
        if (!field) {
          report.errors.push(`فیلد «${m.pdfField}» در PDF پیدا نشد.`);
          continue;
        }
        if (field instanceof PDFTextField) {
          const tf = form.getTextField(m.pdfField);
          tf.setText(safe.value);
          try { tf.setFontSize(10); } catch { /* appearance quirks are non-fatal */ }
        } else if (field instanceof PDFCheckBox) {
          const truthy = ["true", "1", "yes", "بله", "x", "مرد", "m"].includes(final.toLowerCase());
          const box = form.getCheckBox(m.pdfField);
          truthy ? box.check() : box.uncheck();
        } else if (field instanceof PDFRadioGroup) {
          const group = form.getRadioGroup(m.pdfField);
          const match = group
            .getOptions()
            .find((o) => o.toLowerCase() === safe.value.toLowerCase());
          if (match) group.select(match);
          else if (m.required) report.missing.push({ pdfField: m.pdfField, source: m.source ?? "—" });
        } else if (field instanceof PDFDropdown) {
          const dd = form.getDropdown(m.pdfField);
          const match = dd
            .getOptions()
            .find((o) => o.toLowerCase() === safe.value.toLowerCase());
          if (match) {
            dd.select(match);
          } else {
            dd.setOptions([...dd.getOptions(), safe.value]);
            dd.select(safe.value);
          }
        } else {
          report.errors.push(`نوع فیلد «${m.pdfField}» پشتیبانی نمی‌شود.`);
          continue;
        }
        report.filled.push({ pdfField: m.pdfField, value: safe.value });
      } catch {
        report.errors.push(`نوشتن در «${m.pdfField}» ناموفق بود.`);
      }
    }
    try { form.updateFieldAppearances(font); } catch { /* fall back to widget defaults */ }
    try { form.flatten(); } catch { /* keep interactive — still downloadable */ }
  } else {
    // Coordinate mode — Latin text overlay (documented limitation).
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    for (const m of template.mappings as CoordMapping[]) {
      const raw = sourceValue(ctx, m.source, m.staticText);
      const isDateSource =
        m.source === "birthDate" || m.source === "passportIssueDate" || m.source === "passportExpiryDate";
      const text = raw && isDateSource ? formatDateForTemplate(raw, m.dateFormat) : raw;
      if (text == null || text === "") {
        if (m.required) report.missing.push({ pdfField: m.pdfField, source: m.source ?? "—" });
        continue;
      }
      const final = applyCasing(text, m.casing);
      const safe = winAnsiValue(final);
      if (!safe) {
        report.errors.push(
          `فیلد «${m.pdfField}»: متن «${final.slice(0, 20)}» با فونت این فرم قابل نوشتن نیست (فارسی/یونیکد) و معادل لاتینی هم ندارد.`,
        );
        continue;
      }
      if (safe.transliterated) {
        report.transliterated.push({ pdfField: m.pdfField, from: final, to: safe.value });
      }
      const page = pages[m.page - 1];
      if (!page) {
        report.errors.push(`صفحهٔ ${m.page} برای «${m.pdfField}» وجود ندارد.`);
        continue;
      }
      page.drawText(safe.value, {
        x: m.x,
        y: m.y,
        size: m.fontSize || 11,
        font,
        color: rgb(0.05, 0.09, 0.16),
      });
      report.filled.push({ pdfField: m.pdfField, value: text });
    }
  }

  const bytes = await doc.save();
  return { bytes, report };
}

/** Persian text preview helper for the mapping UI. */
export function persianPreview(ctx: FillContext, src: TemplateSource | null, staticText?: string): string {
  return sourceValue(ctx, src, staticText) ?? "";
}
