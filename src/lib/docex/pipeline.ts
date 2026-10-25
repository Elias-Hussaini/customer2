/**
 * Extraction pipeline — orchestrates validation, PDF text / OCR, MRZ parsing,
 * label extraction, per-page merging. Deterministic end-to-end; the human
 * confirms the final values in the review UI before anything is saved.
 */
import type {
  CanonicalField,
  DocumentKind,
  ExtractionResult,
  ExtractedValue,
  PageResult,
} from "./types";
import { METHOD_RANK } from "./types";
import { openPdf, hasTextLayer } from "./pdfread";
import { preprocessCanvas, releaseOcr, runOcr } from "./ocr";
import { parseMrzFromText } from "./mrz";
import { detectKind, extractByLabels, PASSPORT_PROFILE, TAZKIRA_PROFILE, VISA_FORM_PROFILE, normalizeUnicodeLine } from "./text";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PAGES = 12;

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
    // ------- PDF: text layer per page, OCR only for scanned pages -------
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
    const totalPages = Math.min(pdf.numPages, MAX_PAGES);
    if (pdf.numPages > MAX_PAGES) {
      warnings.push(`فقط ${MAX_PAGES} صفحهٔ اول پردازش شد (کل: ${pdf.numPages} صفحه).`);
    }
    for (let i = 1; i <= totalPages; i++) {
      const base = 5 + Math.round(((i - 1) / totalPages) * 88);
      report("page_text", i, totalPages, base);
      let text = "";
      try {
        text = await pdf.getPageText(i);
      } catch {
        warnings.push(`متن صفحهٔ ${i} قابل خواندن نبود.`);
      }
      let page: PageResult;
      if (hasTextLayer(text)) {
        page = buildPageResult(i, text, "pdf_text", null, previews ? await safeThumb(pdf, i) : null, warnings);
      } else {
        // Scanned page → OCR. Try eng first (fast, catches MRZ + English
        // labels); if nothing useful is found, retry with fas.
        report("page_ocr", i, totalPages, base + 4);
        const { canvas } = await pdf.renderPage(i, 200);
        const preview = previews ? canvas.toDataURL("image/jpeg", 0.55) : null;
        const eng = await runOcrSafe(preprocessCanvas(canvas, { contrast: 1.15 }), "eng", warnings, i);
        let outcome = eng;
        let method: PageResult["method"] = "ocr_printed";
        const latin = latinRatio(outcome?.text ?? "");
        const foundSomething = outcome ? wordCount(outcome.text) >= 6 || parseMrzFromText(outcome.text) : false;
        if (!foundSomething || latin < 0.35) {
          report("page_ocr", i, totalPages, base + 20);
          const fa = await runOcrSafe(preprocessCanvas(canvas, { binarize: true, contrast: 1.35 }), "fas", warnings, i);
          if (fa && (!outcome || fa.text.length > outcome.text.length * 1.3)) {
            outcome = fa;
          }
        }
        page = buildPageResult(i, outcome?.text ?? "", method, outcome?.confidence ?? null, preview, warnings);
      }
      result.pages.push(page);
    }
    pdf.destroy();
  }

  // ------- Merge across pages -------
  report("merging", 0, result.pages.length, 96);
  for (const page of result.pages) {
    for (const key of Object.keys(page.fields) as CanonicalField[]) {
      result.fields[key] = mergeField(result.fields[key], page.fields[key]);
    }
    if (!result.detectedKinds.includes(page.kind)) result.detectedKinds.push(page.kind);
  }
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
    // Don't OCR-fall back on handwriting profile unless text is non-Latin.
    const labelFields = extractByLabels(text, profile, method ?? "ocr_printed");
    for (const key of Object.keys(labelFields) as CanonicalField[]) {
      fields[key] = mergeField(fields[key], labelFields[key]);
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
    return buildPageResult(1, text, "ocr_printed", confidence, preview, warnings);
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
