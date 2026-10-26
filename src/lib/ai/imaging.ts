/**
 * File → JPEG data-URL pipeline for AI vision requests.
 *
 * PDFs are rendered page-by-page with pdf.js (the browser does the work —
 * no upload of the PDF itself), photos are downscaled and re-encoded, and
 * everything comes out as compact JPEG data URLs ready for `image_url`.
 */

import { isBlankImage } from "./split";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = lib;
  return lib;
}

export const ACCEPTED_MIME =
  "application/pdf,image/jpeg,image/png,image/webp,image/bmp";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Hard cap on images sent in ONE AI request (context/cost safety). */
export const MAX_IMAGES_PER_REQUEST = 6;
/** Pages rendered per PDF at most. */
export const MAX_PDF_PAGES = 12;
/** Long-edge pixel cap for every image sent to the model. */
const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.85;

/** Validate one picked file; returns a Persian error or null when OK. */
export function validateAiFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const okType =
    file.type === "application/pdf" ||
    /^image\/(jpeg|png|webp|bmp)$/.test(file.type) ||
    /\.(pdf|jpe?g|png|webp|bmp)$/.test(name);
  if (!okType) return `«${file.name}»: فقط PDF و عکس (JPG/PNG/WebP/BMP) پذیرفته می‌شود.`;
  if (file.size > MAX_FILE_BYTES)
    return `«${file.name}»: حجم فایل بیشتر از ۲۵ مگابایت است.`;
  return null;
}

function canvasToJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Draw a bitmap on a white canvas, capped to MAX_EDGE on the long side. */
function bitmapToJpeg(bitmap: ImageBitmap): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvasToJpeg(canvas);
}

/** A single image file → one normalized JPEG data URL. */
export async function imageFileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return bitmapToJpeg(bitmap);
  } finally {
    bitmap.close();
  }
}

export interface PdfRenderProgress {
  page: number;
  totalPages: number;
}

/** A PDF file → JPEG data URLs, one per page (up to MAX_PDF_PAGES). */
export async function pdfToJpegs(
  file: File,
  onProgress?: (p: PdfRenderProgress) => void,
): Promise<string[]> {
  const lib = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const total = Math.min(doc.numPages, MAX_PDF_PAGES);
    const images: string[] = [];
    for (let i = 1; i <= total; i++) {
      onProgress?.({ page: i, totalPages: total });
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(200 / 72, MAX_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      images.push(canvasToJpeg(canvas));
    }
    return images;
  } finally {
    void doc.destroy();
  }
}

export interface PrepareFilesResult {
  images: string[];
  /** Human-readable summary, e.g. «2 فایل — 3 تصویر». */
  summary: string;
  /** Set when some pages/images were dropped because of the cap. */
  truncated: boolean;
}

/**
 * Turn a mixed list of PDFs and photos into the JPEG data-URL batch for
 * one AI request. PDFs are converted to page images first (the document
 * itself never leaves the browser — only rendered images are sent).
 */
export async function prepareFilesForAi(
  files: File[],
  onStage?: (s: { label: string; percent: number }) => void,
): Promise<PrepareFilesResult> {
  const images: string[] = [];
  let truncated = false;
  const names: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const pages = await pdfToJpegs(file, (p) =>
        onStage?.({
          label: `تبدیل PDF به عکس — صفحهٔ ${p.page.toLocaleString("fa-IR")} از ${p.totalPages.toLocaleString("fa-IR")}`,
          percent: Math.round(((i + p.page / p.totalPages) / files.length) * 55) + 5,
        }),
      );
      for (const img of pages) {
        if (images.length >= MAX_IMAGES_PER_REQUEST) {
          truncated = true;
          break;
        }
        // Blank pages (scanner leftovers) never reach the AI.
        if (await isBlankImage(img)) continue;
        images.push(img);
      }
    } else {
      onStage?.({
        label: `آماده‌سازی تصویر ${(i + 1).toLocaleString("fa-IR")} از ${files.length.toLocaleString("fa-IR")}`,
        percent: Math.round(((i + 1) / files.length) * 55) + 5,
      });
      const img = await imageFileToJpeg(file);
      if (images.length >= MAX_IMAGES_PER_REQUEST) truncated = true;
      else images.push(img);
    }
    names.push(file.name);
  }

  return {
    images,
    summary: `${names.length.toLocaleString("fa-IR")} فایل — ${images.length.toLocaleString("fa-IR")} تصویر`,
    truncated,
  };
}
