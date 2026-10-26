/**
 * Local OCR via tesseract.js — lazy-loaded, executed fully in the browser.
 *
 * No document content ever leaves the device: only the static language
 * model (traineddata) is fetched once from a public CDN and cached by the
 * browser. Persian (fas) + English (eng) are supported.
 *
 * Worker POOL per language: several pages of a scan are recognized in
 * parallel (slot 0, 1, …) instead of one after another. Workers stay warm
 * across uploads; a crashed slot is recreated on the next call.
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

export type OcrLang = "eng" | "fas";

/** Warm slots per language — the pool the pipeline runs pages through. */
const POOL_SIZE: Record<OcrLang, number> = { eng: 2, fas: 1 };

const workers = new Map<string, TesseractWorker>(); // key: `${lang}#${slot}`

async function getWorker(lang: OcrLang, slot: number): Promise<TesseractWorker> {
  const key = `${lang}#${slot}`;
  const cached = workers.get(key);
  if (cached) return cached;
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang, 1, {
    logger: () => {
      /* progress is surfaced via onProgress instead */
    },
  });
  const w = worker as unknown as TesseractWorker;
  workers.set(key, w);
  return w;
}

/** Terminate one slot (index within the language pool). */
export function resetSlot(lang: OcrLang, slot: number): void {
  const key = `${lang}#${slot}`;
  const w = workers.get(key);
  if (w) {
    workers.delete(key);
    void w.terminate().catch(() => undefined);
  }
}

/** Drop broken workers of a language so the next call recreates them. */
export function resetWorker(lang: string): void {
  const dead = [...workers.entries()].filter(([k]) => k.startsWith(`${lang}#`));
  for (const [k, w] of dead) {
    workers.delete(k);
    void w.terminate().catch(() => undefined);
  }
}

/** Preload the OCR engines in the background (first document then fills in
 *  a couple of seconds instead of paying the worker+model load cost).
 *  English slots first — the passport/MRZ pass runs on them. */
export async function warmupOcr(): Promise<void> {
  try {
    await Promise.all([
      getWorker("eng", 0),
      getWorker("eng", 1),
      getWorker("fas", 0),
    ]);
  } catch {
    /* offline / CDN hiccup — surfaced later by the actual run */
  }
}

/** Terminate all cached workers (frees wasm memory). */
export async function releaseOcr(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map((w) => w.terminate().catch(() => undefined)));
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

/** Run OCR on a preprocessed canvas. `slot` picks the pool worker so several
 *  pages can be recognized concurrently. */
export async function runOcr(
  canvas: HTMLCanvasElement,
  lang: string,
  onProgress?: (pct: number, stage: string) => void,
  slot = 0,
): Promise<OcrOutcome> {
  const pool = POOL_SIZE[lang as OcrLang] ?? 1;
  const worker = await getWorker(lang as OcrLang, slot % pool);
  onProgress?.(10, "بارگذاری موتور OCR");
  const result = await worker.recognize(canvas);
  onProgress?.(95, "تحلیل نتیجه");
  return {
    text: result.data.text ?? "",
    confidence: Math.round(result.data.confidence ?? 0),
  };
}
