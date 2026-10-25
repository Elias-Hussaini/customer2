/**
 * Local OCR via tesseract.js — lazy-loaded, executed fully in the browser.
 *
 * No document content ever leaves the device: only the static language
 * model (traineddata) is fetched once from a public CDN and cached by the
 * browser. Persian (fas) + English (eng) are supported.
 *
 * Preprocessing (grayscale → contrast stretch → optional Otsu binarize)
 * is done on a canvas before recognition — deterministic, no magic.
 */

export interface OcrOutcome {
  text: string;
  confidence: number; // 0..100 mean word confidence
}

type TesseractWorker = {
  recognize(image: unknown): Promise<{
    data: { text: string; confidence: number };
  }>;
  terminate(): Promise<unknown>;
};

let workerCache: { key: string; worker: TesseractWorker } | null = null;

async function getWorker(langs: string): Promise<TesseractWorker> {
  if (workerCache && workerCache.key === langs) return workerCache.worker;
  if (workerCache) {
    void workerCache.worker.terminate();
    workerCache = null;
  }
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(langs, 1, {
    logger: () => {
      /* progress is surfaced via onProgress instead */
    },
  });
  workerCache = { key: langs, worker: worker as unknown as TesseractWorker };
  return workerCache.worker;
}

/** Terminate the cached worker (frees wasm memory). */
export async function releaseOcr(): Promise<void> {
  if (workerCache) {
    void workerCache.worker.terminate();
    workerCache = null;
  }
}

/** Grayscale + contrast stretch + optional Otsu binarization. */
export function preprocessCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  opts: { binarize?: boolean; contrast?: number; maxWidth?: number } = {},
): HTMLCanvasElement {
  const { binarize = false, contrast = 1.2, maxWidth = 2400 } = opts;
  const sw = "width" in source ? source.width : 0;
  const sh = "height" in source ? source.height : 0;
  const scale = Math.min(1, maxWidth / (sw || maxWidth));
  const w = Math.max(1, Math.round((sw || maxWidth) * scale));
  const h = Math.max(1, Math.round((sh || maxWidth) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Pass 1: grayscale + histogram for contrast stretch.
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g | 0]++;
  }
  // Contrast stretch between 5th and 95th percentile.
  const total = (d.length / 4) | 0;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.05) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.05) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);

  // Pass 2: apply contrast (+ optional Otsu threshold).
  let otsu = 128;
  if (binarize) otsu = otsuThreshold(hist, total);
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - lo) / range) * 255 * contrast;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (binarize) g = g > otsu ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function otsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return threshold;
}

/** Run OCR on a preprocessed canvas. */
export async function runOcr(
  canvas: HTMLCanvasElement,
  langs: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<OcrOutcome> {
  const worker = await getWorker(langs);
  onProgress?.(10, "بارگذاری موتور OCR");
  const result = await worker.recognize(canvas);
  onProgress?.(95, "تحلیل نتیجه");
  return {
    text: result.data.text ?? "",
    confidence: Math.round(result.data.confidence ?? 0),
  };
}
