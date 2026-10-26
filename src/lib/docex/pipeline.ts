/**
 * Extraction pipeline — orchestrates validation, PDF text / OCR, MRZ parsing,
 * label extraction, per-page merging. Deterministic end-to-end; the human
 * confirms the final values before anything is saved.
 *
 * Speed strategy for multi-page scanned PDFs (real passport booklets):
 *  1. FAST SCAN — read the text layer of every page in parallel and stop as
 *     soon as all core passport fields are found (digital PDFs fill instantly).
 *  2. ENGLISH-FIRST OCR — scanned pages are OCR'd TWO AT A TIME on a warm
 *     worker pool (MRZ + Latin labels are what fill the form). The moment
 *     every core field has a value — including the issue date, recovered by
 *     the smart birth↔expiry inference when its label is unreadable — the
 *     remaining pages are ABORTED mid-recognition. A 5-page scan fills in
 *     about the time its bio page takes to OCR.
 *  3. PERSIAN REFINE — only when core fields are still missing (tazkira
 *     scans, stamp pages): a Persian pass over the already-scanned pages.
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
import { preprocessCanvas, resetSlot, resetWorker, runOcr, warmupOcr, type OcrLang } from "./ocr";
import { parseMrzFromText } from "./mrz";
import {
  detectKind,
  extractByLabels,
  extractByLayout,
  findDateCandidates,
  disambiguateIssueDate,
  inferIssueDateFromYears,
  PASSPORT_PROFILE,
  TAZKIRA_PROFILE,
  VISA_FORM_PROFILE,
  VISA_STAMP_PROFILE,
} from "./text";
import { shiftIsoYears } from "./dates";
import { isIdentitySource, scorePageText } from "./score";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_TEXT_PAGES = 120; // text-layer scan is cheap — go wide
export const MAX_OCR_PAGES = 10; // English OCR budget
export const MAX_FA_PAGES = 4; // Persian refinement budget
/** Pages recognized in parallel during the English pass. */
const OCR_PAGE_POOL = 2;
/** Render DPI for OCR pages — 150 is the sweet spot for passport print. */
const OCR_DPI = 150;

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
  /** Live snapshot of merged fields — fires whenever new values appear, so
   *  the form can fill progressively while later pages are still scanning. */
  onFields?: (fields: Partial<Record<CanonicalField, ExtractedValue>>) => void;
}

/** OCR outcome per language slot on one page. */
interface PageOcrState {
  eng?: string;
  engConf?: number;
  fa?: string;
  faConf?: number;
}

/**
 * Process one uploaded file (PDF or image) end-to-end.
 * Never throws for content reasons — problems land in `warnings`.
 */
export async function runExtraction(file: File, opts: RunOptions = {}): Promise<ExtractionResult> {
  const { onFields, onProgress, previews = true } = opts;
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

  // Progressive snapshot emitter — fires only when the value set actually
  // changes, so the UI can fill the form live while later pages still scan.
  const emit = (() => {
    let lastSig = "";
    return (fields: Partial<Record<CanonicalField, ExtractedValue>>) => {
      if (!onFields) return;
      const sig = Object.entries(fields)
        .filter(([, v]) => v?.value != null && String(v.value).trim().length > 0)
        .map(([k, v]) => `${k}:${String(v.value)}`)
        .sort()
        .join("|");
      if (sig === lastSig) return;
      lastSig = sig;
      onFields(fields);
    };
  })();

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

      // All page results (text layer + OCR) keyed by page index; the merged
      // field set is always recomputed from these, so a Persian pass can
      // refine a page an English pass already read.
      const allPages = new Map<number, PageResult>();
      const pageTexts = new Map<number, string>();
      const kinds: DocumentKind[] = [];
      let merged: Partial<Record<CanonicalField, ExtractedValue>> = {};

      const recomputeMerge = () => {
        const next: Partial<Record<CanonicalField, ExtractedValue>> = {};
        const pages = [...allPages.values()].sort((a, b) => a.index - b.index);
        for (const p of pages) {
          // ONLY proven data pages (MRZ or label-dense) may feed identity
          // fields. Covers, stamps, letters and other noise pages are read
          // but deliberately ignored — their text can never reach the form.
          // Exception: entryDate lives on visa STAMPS, which are noise-tier
          // by design, so it stays mergable from every page.
          const source = !p.relevance || isIdentitySource(p.relevance);
          for (const key of Object.keys(p.fields) as CanonicalField[]) {
            if (!source && key !== "entryDate") continue;
            next[key] = mergeField(next[key], p.fields[key]);
          }
        }
        merged = next;
      };
      const refreshKinds = () => {
        for (const p of allPages.values()) if (!kinds.includes(p.kind)) kinds.push(p.kind);
      };

      // ---- Phase 1: parallel text-layer scan, early exit when complete ----
      let textDone = 0;
      let stopText = false;
      await mapPool(
        Array.from({ length: textPages }, (_, i) => i + 1),
        8,
        async (i) => {
          if (stopText) return;
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
            allPages.set(i, page);
            recomputeMerge();
            refreshKinds();
            emit(merged);
          }
          textDone++;
          report("page_text", i, textPages, 5 + Math.round((textDone / textPages) * 70));
          if (haveCore(merged)) stopText = true; // everything found — skip the rest
        },
      );

      // ---- Phase 2: OCR the scanned pages ----
      if (!haveCore(merged)) {
        const scannedPages = [...pageTexts.entries()]
          .filter(([i, t]) => i <= MAX_TEXT_PAGES && !hasTextLayer(t))
          .map(([i]) => i)
          .sort((a, b) => a - b);
        const engBudget = scannedPages.slice(0, MAX_OCR_PAGES);
        const ocrState = new Map<number, PageOcrState>();
        const previewsByPage = new Map<number, string | null>();

        const rebuildPage = (i: number) => {
          const st = ocrState.get(i);
          if (!st) return;
          const text = [st.eng, st.fa].filter((t) => !!t && t.trim().length > 0).join("\n");
          if (!text.trim()) return;
          const page = buildPageResult(
            i,
            text,
            "ocr_printed",
            Math.max(st.engConf ?? 0, st.faConf ?? 0) || null,
            previewsByPage.get(i) ?? null,
            warnings,
            null,
          );
          allPages.set(i, page);
          recomputeMerge();
          refreshKinds();
        };

        /** Issue-date recovery chain, applied the moment birth+expiry are
         *  known — this is what lets the scan stop right after the bio page
         *  instead of grinding through every stamp page hunting the label.
         *  1. a readable date between birth and expiry (5/10-year preference)
         *  2. the printed YEAR on the issue line + booklet arithmetic
         *  3. the standard 5-year booklet default — always flagged. */
        const applyIssueFallback = () => {
          if (merged.dateOfIssue?.value || !merged.dateOfBirth?.value || !merged.dateOfExpiry?.value) return;
          const expIso = String(merged.dateOfExpiry.value);
          const docPages = [...allPages.values()].filter(
            (p) =>
              (p.kind === "passport" || p.kind === "id_card" || p.mrz) &&
              (!p.relevance || isIdentitySource(p.relevance)),
          );
          const fromTextLayer = docPages.some((p) => p.method === "pdf_text");
          const candidates = docPages.flatMap((p) => findDateCandidates(p.text));
          const pick = disambiguateIssueDate(candidates, String(merged.dateOfBirth.value), expIso);
          if (pick) {
            merged.dateOfIssue = {
              value: pick.iso,
              raw: null,
              status: pick.strong && fromTextLayer ? "confirmed" : "needs_review",
              method: fromTextLayer ? "pdf_text" : "ocr_printed",
              note: pick.strong ? undefined : "تاریخ صدور از بین تاریخ‌های سند حدس زده شد — بازبینی کنید",
            };
            return;
          }
          for (const p of docPages) {
            const inf = inferIssueDateFromYears(p.text, expIso);
            if (inf) {
              merged.dateOfIssue = {
                value: inf.iso,
                raw: null,
                status: "needs_review",
                method: fromTextLayer ? "pdf_text" : "ocr_printed",
                note: inf.strong
                  ? "تاریخ صدور از سال چاپ‌شده و مدت اعتبار محاسبه شد"
                  : "تاریخ صدور از سال‌های چاپ‌شده محاسبه شد — بازبینی کنید",
              };
              return;
            }
          }
          const guess = shiftIsoYears(expIso, -5);
          if (guess) {
            merged.dateOfIssue = {
              value: guess,
              raw: null,
              status: "needs_review",
              method: "ocr_printed",
              note: "تاریخ صدور خوانده نشد — از مدت اعتبار ۵ ساله پاسپورت حدس زده شد",
            };
          }
        };

        /** One OCR pass over `pageList`, `slots` pages in parallel. Resolves
         *  early (aborting in-flight recognitions) once every core field has
         *  a value — the form is already filled at that point. */
        const runPass = async (lang: OcrLang, pageList: number[], slots: number, basePct: number) => {
          if (!pageList.length) return;
          let stop = false;
          let cursor = 0;
          let done = 0;
          let abortNow: (() => void) | null = null;
          const abortSignal = new Promise<void>((resolve) => {
            abortNow = resolve;
          });
          report("page_ocr", 0, pageList.length, basePct);

          const runSlot = async (slot: number) => {
            for (;;) {
              if (stop) return;
              const k = cursor++;
              if (k >= pageList.length) return;
              const i = pageList[k];
              let canvas: HTMLCanvasElement;
              try {
                ({ canvas } = await pdf.renderPage(i, OCR_DPI));
              } catch {
                continue;
              }
              if (isMostlyBlank(canvas)) continue; // blank back side — no OCR
              if (stop) return;
              if (previews && !previewsByPage.has(i)) {
                previewsByPage.set(i, canvas.toDataURL("image/jpeg", 0.55));
              }
              const pre = preprocessCanvas(
                canvas,
                lang === "eng" ? { contrast: 1.15 } : { binarize: true, contrast: 1.35 },
              );
              const outcome = await runOcrAborted(pre, lang, slot, abortSignal, warnings, i, () => stop);
              if (stop) return; // scan aborted — form is already filled
              if (!outcome) continue; // this page failed OCR — try the next one
              const st = ocrState.get(i) ?? {};
              if (lang === "eng") {
                st.eng = outcome.text;
                st.engConf = outcome.confidence;
              } else {
                st.fa = outcome.text;
                st.faConf = outcome.confidence;
              }
              ocrState.set(i, st);
              rebuildPage(i);
              applyIssueFallback();
              emit(merged);
              done++;
              report("page_ocr", i, pageList.length, basePct + Math.round((done / pageList.length) * 15));
              if (haveCore(merged)) {
                // Everything the form needs is on screen — abort the rest of
                // the scan so no time is wasted on stamp/observation pages.
                stop = true;
                abortNow?.();
                resetWorker(lang); // kill in-flight recognitions
                void warmupOcr(); // pool rebuilds quietly for the next upload
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(slots, pageList.length) }, (_, s) => runSlot(s)));
        };

        // Phase 2a — English pass (MRZ + Latin labels), two pages at a time.
        await runPass("eng", engBudget, OCR_PAGE_POOL, 75);

        // Phase 2b — Persian pass, only when core fields are still missing
        // (tazkira scans, Persian-only labels, visa stamps).
        if (!haveCore(merged)) {
          const faPages = engBudget.slice(0, MAX_FA_PAGES);
          await runPass("fas", faPages, 1, 90);
        }
      }

      result.pages = [...allPages.values()].sort((a, b) => a.index - b.index);
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
    emit(result.fields);
  }

  // ------- Smart fallback: recover the issue date when birth+expiry are known -------
  if (
    !result.fields.dateOfIssue?.value &&
    result.fields.dateOfBirth?.value &&
    result.fields.dateOfExpiry?.value
  ) {
    const expIso = String(result.fields.dateOfExpiry.value);
    const docPages = result.pages.filter(
      (p) =>
        (p.kind === "passport" || p.kind === "id_card" || p.mrz) &&
        (!p.relevance || isIdentitySource(p.relevance)),
    );
    const fromTextLayer = docPages.some((p) => p.method === "pdf_text");
    const candidates = docPages.flatMap((p) => findDateCandidates(p.text));
    const pick = disambiguateIssueDate(candidates, String(result.fields.dateOfBirth.value), expIso);
    if (pick) {
      result.fields.dateOfIssue = {
        value: pick.iso,
        raw: null,
        status: pick.strong && fromTextLayer ? "confirmed" : "needs_review",
        method: fromTextLayer ? "pdf_text" : "ocr_printed",
        note: pick.strong ? undefined : "تاریخ صدور از بین تاریخ‌های سند حدس زده شد — بازبینی کنید",
      };
      emit(result.fields);
    } else {
      const inf = docPages
        .map((p) => inferIssueDateFromYears(p.text, expIso))
        .find((x): x is { iso: string; strong: boolean } => x != null);
      const value = inf?.iso ?? shiftIsoYears(expIso, -5);
      if (value) {
        result.fields.dateOfIssue = {
          value,
          raw: null,
          status: "needs_review",
          method: fromTextLayer ? "pdf_text" : "ocr_printed",
          note: inf
            ? inf.strong
              ? "تاریخ صدور از سال چاپ‌شده و مدت اعتبار محاسبه شد"
              : "تاریخ صدور از سال‌های چاپ‌شده محاسبه شد — بازبینی کنید"
            : "تاریخ صدور خوانده نشد — از مدت اعتبار ۵ ساله پاسپورت حدس زده شد",
        };
        emit(result.fields);
      }
    }
  }

  report("merging", 0, result.pages.length, 98);
  const usable = result.pages.filter((p) => p.text.trim().length > 0);
  if (usable.length === 0) {
    warnings.push("هیچ متنی از این فایل خوانده نشد — ورود دستی فیلدها لازم است.");
  } else if (Object.keys(result.fields).length === 0) {
    warnings.push("متنی خوانده شد اما هیچ فیلد شناخته‌شده‌ای پیدا نشد — ورود دستی فیلدها لازم است.");
  } else {
    // Transparency: say when non-document pages were read and deliberately
    // ignored, so the operator knows why their text never reached the form.
    const ignored = usable.filter((p) => p.relevance && !isIdentitySource(p.relevance)).length;
    if (ignored > 0) {
      warnings.push(
        `فقط صفحهٔ مشخصات سند خوانده شد — متن ${ignored} صفحهٔ دیگر (جلد/مهر/سند جانبی) نادیده گرفته شد.`,
      );
    }
  }
  report("done", 0, result.pages.length, 100);
  // OCR workers stay warm — the next document then fills in a blink.
  return result;
}

/** Recognize with abort support: when `abortSignal` fires (early exit), the
 *  await resolves null and the slot's worker is terminated so the stale job
 *  can never delay the next upload. */
async function runOcrAborted(
  canvas: HTMLCanvasElement,
  lang: OcrLang,
  slot: number,
  abortSignal: Promise<void>,
  warnings: string[],
  pageIndex: number,
  isStopped: () => boolean,
): Promise<{ text: string; confidence: number } | null> {
  const job = runOcr(canvas, lang, undefined, slot).catch(() => null);
  const outcome = await Promise.race([job, abortSignal.then(() => null)]);
  if (outcome === null) {
    if (!isStopped()) {
      resetSlot(lang, slot);
      warnings.push(`OCR صفحهٔ ${pageIndex} با خطا متوقف شد.`);
    }
    return null;
  }
  return outcome;
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

/** Fraction of dark pixels in a tiny probe render (page-shape detector). */
function darkRatio(canvas: HTMLCanvasElement): number {
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
    return dark / (d.length / 4);
  } catch {
    return 0;
  }
}

/** A rendered page that is ~all white — typical scan back side. No OCR needed. */
function isMostlyBlank(canvas: HTMLCanvasElement): boolean {
  return darkRatio(canvas) < 0.004;
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
  const rel = scorePageText(text, Boolean(mrzHit));
  const relevance = { tier: rel.tier, strongHits: rel.strongHits };
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
  const profiles = [PASSPORT_PROFILE, TAZKIRA_PROFILE, VISA_FORM_PROFILE, VISA_STAMP_PROFILE];
  for (const profile of profiles) {
    if (!profile.kinds.includes(kind)) continue;
    // Span-aware line extraction (always).
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
    return { index, kind, text: "", method, ocrConfidence, previewDataUrl, mrz: mrzHit?.mrz ?? null, fields: {}, relevance };
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
    relevance,
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
    // Both languages in parallel — 1800 px cap keeps phone photos fast.
    const [eng, fa] = await Promise.all([
      runOcrSafe(preprocessCanvas(img, { contrast: 1.15, maxWidth: 1800 }), "eng", warnings, 1, 0),
      runOcrSafe(preprocessCanvas(img, { binarize: true, contrast: 1.35, maxWidth: 1800 }), "fas", warnings, 1, 0),
    ]);
    const text = [eng?.text, fa?.text]
      .filter((t): t is string => !!t && t.trim().length > 0)
      .join("\n");
    const confidence = Math.max(eng?.confidence ?? 0, fa?.confidence ?? 0) || null;
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

async function runOcrSafe(
  canvas: HTMLCanvasElement,
  lang: "eng" | "fas",
  warnings: string[],
  pageIndex: number,
  slot: number,
): Promise<{ text: string; confidence: number } | null> {
  try {
    return await runOcr(canvas, lang, undefined, slot);
  } catch {
    resetWorker(lang); // recreate cleanly on the next attempt
    warnings.push(`OCR صفحهٔ ${pageIndex} (زبان ${lang === "fas" ? "فارسی" : "انگلیسی"}) با خطا متوقف شد.`);
    return null;
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
