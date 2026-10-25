/**
 * Extraction pipeline — orchestrates validation, PDF text / OCR, MRZ parsing,
 * label extraction, per-page merging. Deterministic end-to-end; the human
 * confirms the final values before anything is saved.
 *
 * Speed strategy for multi-page PDFs (full passport scans etc.):
 *  1. FAST SCAN — read the text layer of every page in parallel and stop as
 *     soon as all core passport fields are found.
 *  2. OCR FALLBACK — only for scanned pages (blank pages are skipped quickly)
 *     with a hard page budget so huge scans never hang the form.
 *  3. SMART GUESS — when birth+expiry are known (MRZ) but the issue date
 *     label was unreadable, the issue date is inferred deterministically from
 *     the remaining dates on the page (flagged for review, never silent).
 */
import type {
  CanonicalField,
  DocumentKind,
  ExtractionResult,
  ExtractedValue,
  PageResult,
} from "./types";
import { METHOD_RANK } from "./types";
import { openPdf, hasTextLayer, type StructuredRow } from "./pdfread";
import { preprocessCanvas, releaseOcr, runOcr } from "./ocr";
import { parseMrzFromText } from "./mrz";
import {
  detectKind,
  extractByLabels,
  extractByLayout,
  findDateCandidates,
  disambiguateIssueDate,
  PASSPORT_PROFILE,
  TAZKIRA_PROFILE,
  VISA_FORM_PROFILE,
  normalizeUnicodeLine,
} from "./text";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_TEXT_PAGES = 60; // text-layer scan is cheap — go wide
export const MAX_OCR_PAGES = 8; // OCR is slow — hard budget

export type PipelineStage =
  | "validating"
  | "opening"
  | "page_text"
  | "page_ocr"
  | "merging"
  | "done";

export interface PipelineProgress {
  stage: PipelineStage;
  page: number;
  totalPages: number;
  percent: number;
}

export function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const okType =
    name.endsWith(".pdf") ||
    file.type === "application/pdf" ||
    /^image\/(jpeg|png|webp|bmp)$/.test(file.type) ||
    /\.(jpe?g|png|webp|bmp)$/.test(name);
  if (!okType) return "فقط PDF یا تصویر (JPEG / PNG / WebP) پذیرفته می‌شود.";
  if (file.size > MAX_FILE_BYTES) return "حجم فایل باید کمتر از ۲۵ مگابایت باشد.";
  if (file.size < 100) return "فایل خالی به نظر می‌رسد.";
  return null;
}

function statusRank(s: ExtractedValue["status"]): number {
  return s === "confirmed" ? 2 : s === "needs_review" ? 1 : 0;
}

/** Merge two values for the same field — better method wins, ties → better status. */
function mergeField(a: ExtractedValue | undefined, b: ExtractedValue | undefined): ExtractedValue | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  // A confirmed value never loses to a weaker one.
  if (a.value && b.value) {
    if (a.value === b.value) {
      return METHOD_RANK[a.method] >= METHOD_RANK[b.method] ? a : b;
    }
    const aScore = METHOD_RANK[a.method] * 10 + statusRank(a.status);
    const bScore = METHOD_RANK[b.method] * 10 + statusRank(b.status);
    return aScore >= bScore ? a : b;
  }
  return a.value ? a : b;
}

/** Heuristic: does this OCR text look mostly Latin? */
function latinRatio(text: string): number {
  const letters = text.replace(/[^A-Za-z\u0600-\u06FF]/g, "");
  if (!letters.length) return 0;
  const latin = letters.replace(/[^A-Za-z]/g, "").length;
  return latin / letters.length;
}

/** Words count for "is this page even a document?" decisions. */
function wordCount(text: string): number {
  return normalizeUnicodeLine(text).split(/\s+/).filter((w) => w.length > 1).length;
}

/** Passport fields the quick-fill needs — early exit once all are found. */
const CORE_FIELDS: CanonicalField[] = [
  "documentNumber",
  "surname",
  "givenNames",
  "dateOfBirth",
  "dateOfIssue",
  "dateOfExpiry",
];

function haveCore(fields: Partial<Record<CanonicalField, ExtractedValue>>): boolean {
  return CORE_FIELDS.every((k) => {
    const v = fields[k]?.value;
    return v != null && String(v).trim().length > 0;
  });
}

/** Small concurrency pool for the parallel text-layer scan. */
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(runners);
}

export interface RunOptions {
  onProgress?: (p: PipelineProgress) => void;
  /** Render preview data URLs for the review UI (default true). */
  previews?: boolean;
}

/**
 * Process one uploaded file (PDF or image) end-to-end.
 * Never throws for content reasons — problems land in `warnings`.
 */
export async function runExtraction(file: File, opts: RunOptions = {}): Promise<ExtractionResult> {
  const { onProgress, previews = true } = opts;
  const warnings: string[] = [];
  const result: ExtractionResult = {
    pages: [],
    fields: {},
    detectedKinds: [],
    warnings,
    fileName: file.name,
    fileSize: file.size,
    processedAt: Date.now(),
  };
  const report = (stage: PipelineStage, page: number, totalPages: number, percent: number) =>
    onProgress?.({ stage, page, totalPages, percent });

  report("validating", 0, 0, 2);
  const err = validateFile(file);
  if (err) {
    warnings.push(err);
    report("done", 0, 0, 100);
    return result;
  }

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    // ------- Single image -------
    report("page_ocr", 1, 1, 8);
    const page = await processImageFile(file, warnings, previews);
    result.pages.push(page);
  } else {
    // ------- PDF -------
    report("opening", 0, 0, 5);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let pdf;
    try {
      pdf = await openPdf(bytes);
    } catch {
      warnings.push("فایل PDF قابل بازکردن نیست (احتمالاً رمزگذاری یا خراب است).");
      report("done", 0, 0, 100);
      return result;
    }
    try {
      const totalPages = pdf.numPages;
      const textPages = Math.min(totalPages, MAX_TEXT_PAGES);
      if (totalPages > MAX_TEXT_PAGES) {
        warnings.push(`فقط ${MAX_TEXT_PAGES} صفحهٔ اول بررسی شد (کل: ${totalPages} صفحه).`);
      }

      // ---- Phase 1: parallel text-layer scan, early exit when complete ----
      const merged: Partial<Record<CanonicalField, ExtractedValue>> = {};
      const kinds: DocumentKind[] = [];
      const pageTexts = new Map<number, string>();
      let textDone = 0;
      let stop = false;

      await mapPool(
        Array.from({ length: textPages }, (_, i) => i + 1),
        6,
        async (i) => {
          if (stop) return;
          let text = "";
          try {
            text = await pdf.getPageText(i);
          } catch {
            warnings.push(`متن صفحهٔ ${i} قابل خواندن نبود.`);
          }
          pageTexts.set(i, text);
          if (hasTextLayer(text)) {
            const rows = await safeRows(pdf, i);
            const page = buildPageResult(
              i,
              text,
              "pdf_text",
              null,
              previews ? await safeThumb(pdf, i) : null,
              warnings,
              rows,
            );
            result.pages.push(page);
            for (const key of Object.keys(page.fields) as CanonicalField[]) {
              merged[key] = mergeField(merged[key], page.fields[key]);
            }
            if (!kinds.includes(page.kind)) kinds.push(page.kind);
          }
          textDone++;
          report("page_text", i, textPages, 5 + Math.round((textDone / textPages) * 80));
          if (haveCore(merged)) stop = true; // everything found — skip the rest
        },
      );
      result.pages.sort((a, b) => a.index - b.index);

      // ---- Phase 2: OCR the scanned pages (in order) until complete ----
      if (!haveCore(merged)) {
        const scannedPages = [...pageTexts.entries()]
          .filter(([i, t]) => i <= MAX_TEXT_PAGES && !hasTextLayer(t))
          .map(([i]) => i)
          .sort((a, b) => a - b)
          .slice(0, MAX_OCR_PAGES);
        let ocrDone = 0;
        for (const i of scannedPages) {
          if (haveCore(merged)) break;
          report("page_ocr", i, scannedPages.length, 85 + Math.round((ocrDone / scannedPages.length) * 10));
          const { canvas } = await pdf.renderPage(i, 200);
          if (isMostlyBlank(canvas)) {
            ocrDone++;
            continue; // blank back side — skip OCR entirely
          }
          const preview = previews ? canvas.toDataURL("image/jpeg", 0.55) : null;
          // Try eng first (fast, catches MRZ + English labels); if nothing
          // useful is found, retry with fas.
          const eng = await runOcrSafe(preprocessCanvas(canvas, { contrast: 1.15 }), "eng", warnings, i);
          let outcome = eng;
          const latin = latinRatio(outcome?.text ?? "");
          const foundSomething = outcome ? wordCount(outcome.text) >= 6 || parseMrzFromText(outcome.text) : false;
          if (!foundSomething || latin < 0.35) {
            const fa = await runOcrSafe(preprocessCanvas(canvas, { binarize: true, contrast: 1.35 }), "fas", warnings, i);
            if (fa && (!outcome || fa.text.length > outcome.text.length * 1.3)) {
              outcome = fa;
            }
          }
          const page = buildPageResult(
            i,
            outcome?.text ?? "",
            "ocr_printed",
            outcome?.confidence ?? null,
            preview,
            warnings,
            null,
          );
          result.pages.push(page);
          for (const key of Object.keys(page.fields) as CanonicalField[]) {
            merged[key] = mergeField(merged[key], page.fields[key]);
          }
          if (!kinds.includes(page.kind)) kinds.push(page.kind);
          ocrDone++;
        }
        result.pages.sort((a, b) => a.index - b.index);
      }

      result.fields = merged;
      result.detectedKinds = kinds;
    } finally {
      pdf.destroy();
    }
  }

  // ------- Merge across pages (single-image path) -------
  if (result.pages.length === 1 && result.pages[0].method !== "pdf_text") {
    const page = result.pages[0];
    for (const key of Object.keys(page.fields) as CanonicalField[]) {
      result.fields[key] = mergeField(result.fields[key], page.fields[key]);
    }
    if (!result.detectedKinds.includes(page.kind)) result.detectedKinds.push(page.kind);
  }

  // ------- Smart fallback: infer the issue date when birth+expiry are known -------
  if (
    !result.fields.dateOfIssue?.value &&
    result.fields.dateOfBirth?.value &&
    result.fields.dateOfExpiry?.value
  ) {
    const candidates = result.pages
      .filter((p) => p.kind === "passport" || p.kind === "id_card" || p.mrz)
      .flatMap((p) => findDateCandidates(p.text));
    const pick = disambiguateIssueDate(
      candidates,
      String(result.fields.dateOfBirth.value),
      String(result.fields.dateOfExpiry.value),
    );
    if (pick) {
      const fromTextLayer = result.pages.some(
        (p) => (p.kind === "passport" || p.kind === "id_card" || p.mrz) && p.method === "pdf_text",
      );
      result.fields.dateOfIssue = {
        value: pick.iso,
        raw: null,
        status: pick.strong && fromTextLayer ? "confirmed" : "needs_review",
        method: fromTextLayer ? "pdf_text" : "ocr_printed",
        note: pick.strong ? undefined : "تاریخ صدور از بین تاریخ‌های سند حدس زده شد — بازبینی کنید",
      };
    }
  }

  report("merging", 0, result.pages.length, 98);
  const usable = result.pages.filter((p) => p.text.trim().length > 0);
  if (usable.length === 0) {
    warnings.push("هیچ متنی از این فایل خوانده نشد — ورود دستی فیلدها لازم است.");
  } else if (Object.keys(result.fields).length === 0) {
    warnings.push("متنی خوانده شد اما هیچ فیلد شناخته‌شده‌ای پیدا نشد — ورود دستی فیلدها لازم است.");
  }
  report("done", 0, result.pages.length, 100);
  void releaseOcr();
  return result;
}

async function safeThumb(pdf: Awaited<ReturnType<typeof openPdf>>, i: number): Promise<string | null> {
  try {
    const { canvas } = await pdf.renderPage(i, 60);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

async function safeRows(pdf: Awaited<ReturnType<typeof openPdf>>, i: number): Promise<StructuredRow[] | null> {
  try {
    return await pdf.getPageRows(i);
  } catch {
    return null;
  }
}

/** A rendered page that is ~all white — typical scan back side. No OCR needed. */
function isMostlyBlank(canvas: HTMLCanvasElement): boolean {
  try {
    const w = 48;
    const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
    const probe = document.createElement("canvas");
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 200) dark++;
    }
    return dark / (d.length / 4) < 0.004;
  } catch {
    return false;
  }
}

async function runOcrSafe(
  canvas: HTMLCanvasElement,
  langs: string,
  warnings: string[],
  pageIndex: number,
): Promise<{ text: string; confidence: number } | null> {
  try {
    return await runOcr(canvas, langs);
  } catch {
    warnings.push(`OCR صفحهٔ ${pageIndex} (زبان ${langs === "fas" ? "فارسی" : "انگلیسی"}) با خطا متوقف شد.`);
    return null;
  }
}

/** Build a PageResult: detect kind, parse MRZ, run label profiles. */
function buildPageResult(
  index: number,
  text: string,
  method: PageResult["method"],
  ocrConfidence: number | null,
  previewDataUrl: string | null,
  warnings: string[],
  rows: StructuredRow[] | null,
): PageResult {
  const mrzHit = parseMrzFromText(text);
  const kind: DocumentKind = detectKind(text, Boolean(mrzHit), mrzHit?.mrz.format ?? null);
  const fields: Partial<Record<CanonicalField, ExtractedValue>> = {};

  if (mrzHit) {
    for (const key of Object.keys(mrzHit.fields) as CanonicalField[]) {
      fields[key] = mrzHit.fields[key];
    }
    if (!mrzHit.mrz.allValid) {
      warnings.push(`صفحهٔ ${index}: بعضی ارقام کنترل MRZ مطابقت نداشت — فیلدها برای بازبینی علامت خوردند.`);
    }
  }

  // Label profiles — only when the page kind matches the profile.
  const profiles = [PASSPORT_PROFILE, TAZKIRA_PROFILE, VISA_FORM_PROFILE];
  for (const profile of profiles) {
    if (!profile.kinds.includes(kind)) continue;
    // Plain line-based extraction (always).
    const labelFields = extractByLabels(text, profile, method ?? "ocr_printed");
    for (const key of Object.keys(labelFields) as CanonicalField[]) {
      fields[key] = mergeField(fields[key], labelFields[key]);
    }
    // Column-aware extraction for PDF text layers — catches two-column data
    // pages ("Date of issue 15 MAR 2022   Date of expiry 15 MAR 2027").
    if (method === "pdf_text" && rows) {
      const layoutFields = extractByLayout(rows, profile, "pdf_text");
      for (const key of Object.keys(layoutFields) as CanonicalField[]) {
        fields[key] = mergeField(fields[key], layoutFields[key]);
      }
    }
  }

  // Photo pages / pages with no recognizable structure stay empty.
  if (kind === "photo") {
    return { index, kind, text: "", method, ocrConfidence, previewDataUrl, mrz: mrzHit?.mrz ?? null, fields: {} };
  }

  return {
    index,
    kind,
    text,
    method,
    ocrConfidence,
    previewDataUrl,
    mrz: mrzHit?.mrz ?? null,
    fields,
  };
}

/** Process a standalone image file (jpeg/png/webp). */
async function processImageFile(
  file: File,
  warnings: string[],
  previews: boolean,
): Promise<PageResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const preview = previews ? downscaleDataUrl(img, 700) : null;
    // MRZ + English labels first.
    const eng = await runOcrSafe(preprocessCanvas(img, { contrast: 1.15 }), "eng", warnings, 1);
    let text = eng?.text ?? "";
    let confidence = eng?.confidence ?? null;
    const latin = latinRatio(text);
    const foundSomething = wordCount(text) >= 6 || parseMrzFromText(text);
    if (!foundSomething || latin < 0.35) {
      const fa = await runOcrSafe(preprocessCanvas(img, { binarize: true, contrast: 1.35 }), "fas", warnings, 1);
      if (fa && fa.text.length > text.length * 1.3) {
        text = fa.text;
        confidence = fa.confidence;
      }
    }
    return buildPageResult(1, text, "ocr_printed", confidence, preview, warnings, null);
  } catch {
    warnings.push("تصویر قابل پردازش نبود.");
    return {
      index: 1,
      kind: "unknown",
      text: "",
      method: null,
      ocrConfidence: null,
      previewDataUrl: null,
      mrz: null,
      fields: {},
    };
  } finally {
    URL.revokeObjectURL(url); // privacy: release the temp reference
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function downscaleDataUrl(img: HTMLImageElement, maxEdge: number): string | null {
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}
