/**
 * ابزار عکس — PDF → image conversion engine for the studio.
 *
 * Reuses the app's bundled pdf.js (LEGACY build — polyfilled for older
 * engines) with tool-grade limits: up to 50 pages per file and a 2400px long
 * edge, so exported pages stay sharp enough for editing and printing.
 * Everything runs locally in the browser — no upload ever happens.
 */

const MAX_PAGES = 50;
const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.92;

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // LEGACY build: transpiled for older engines (polyfills Map.getOrInsertComputed
  // etc.) — renders on old Android WebViews where the modern build crashes.
  const lib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = lib;
  return lib;
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** `report.pdf` + page 3 → `report - صفحه 3.jpg` */
export function pageFileName(pdfName: string, page: number, ext = "jpg"): string {
  const base = pdfName.replace(/\.pdf$/i, "").trim() || "pdf";
  return `${base} - صفحه ${page}.${ext}`;
}

export interface PdfConvertProgress {
  page: number;
  totalPages: number;
}

export interface PdfPageImage {
  name: string;
  blob: Blob;
  width: number;
  height: number;
  page: number;
}

/** Render one PDF into a list of JPEG image files, page by page. */
export async function pdfToImages(
  file: File,
  onProgress?: (p: PdfConvertProgress) => void,
): Promise<PdfPageImage[]> {
  const lib = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const total = Math.min(doc.numPages, MAX_PAGES);
    const images: PdfPageImage[] = [];
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
      const blob = await canvasToJpegBlob(canvas);
      images.push({
        name: pageFileName(file.name, i),
        blob,
        width: canvas.width,
        height: canvas.height,
        page: i,
      });
    }
    return images;
  } finally {
    void doc.destroy();
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** Normalize any picked file into images: PDFs are split into pages, image
 *  files pass straight through. Persian errors come back for rejects. */
export async function filesToImages(
  files: File[],
  onProgress?: (label: string, percent: number) => void,
): Promise<{ images: PdfPageImage[]; errors: string[] }> {
  const images: PdfPageImage[] = [];
  const errors: string[] = [];
  const pdfs = files.filter(isPdfFile);
  const imgs = files.filter((f) => !isPdfFile(f) && f.type.startsWith("image/"));
  const rejected = files.filter((f) => !isPdfFile(f) && !f.type.startsWith("image/"));

  for (const f of rejected) {
    errors.push(`«${f.name}»: فقط PDF و عکس پذیرفته می‌شود.`);
  }

  const totalUnits = pdfs.length + imgs.length;
  let done = 0;
  const tick = (label: string) => {
    done++;
    onProgress?.(label, Math.round((done / Math.max(1, totalUnits)) * 100));
  };

  for (const pdf of pdfs) {
    const pages = await pdfToImages(pdf, (p) =>
      onProgress?.(`${pdf.name} — صفحه ${p.page} از ${p.totalPages}`, 0),
    );
    if (pages.length === 0) errors.push(`«${pdf.name}»: صفحه‌ای برای تبدیل پیدا نشد.`);
    images.push(...pages);
    tick(pdf.name);
  }
  for (const img of imgs) {
    try {
      const bitmap = await createImageBitmap(img);
      images.push({
        name: img.name,
        blob: img,
        width: bitmap.width,
        height: bitmap.height,
        page: 1,
      });
      bitmap.close();
    } catch {
      errors.push(`«${img.name}»: خواندن فایل ناموفق بود.`);
    }
    tick(img.name);
  }
  return { images, errors };
}
