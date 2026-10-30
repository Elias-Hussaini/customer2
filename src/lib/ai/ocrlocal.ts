/** Local OCR via tesseract.js — lazy-loaded, runs 100% in the browser.
 *
 * Language data comes from tesseract's DEFAULT CDN (jsdelivr), which is
 * downloaded once and then kept in the browser's Cache Storage — subsequent
 * runs work offline. Document pixels never leave the device.
 */

/** Hard ceiling per OCR step — a wedged worker must never freeze the flow. */
const OCR_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`OCR timeout: ${what} (${OCR_TIMEOUT_MS / 1000}s)`)), OCR_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export interface OcrOutcome {
  text: string;
  confidence: number; // 0..100
}

type TesseractWorker = {
  recognize(image: unknown): Promise<{
    data: { text: string; confidence: number };
  }>;
  terminate(): Promise<unknown>;
};

/** Two warm English workers + one Persian — pieces are recognized in parallel. */
const ENG_POOL = 2;
const workers = new Map<string, TesseractWorker>(); // key: `eng#n` | `fas#0`

async function getWorker(slot: number, lang: "eng" | "fas" = "eng"): Promise<TesseractWorker> {
  const key = lang === "eng" ? `eng#${slot % ENG_POOL}` : `fas#0`;
  const cached = workers.get(key);
  if (cached) return cached;
  const { createWorker } = await import("tesseract.js");
  // Default langPath = tesseract's own CDN (jsdelivr) — downloaded once,
  // then served from the browser's Cache Storage on later runs.
  const worker = await withTimeout(createWorker(lang, 1, { logger: () => undefined }), `createWorker(${lang})`);
  const w = worker as unknown as TesseractWorker;
  workers.set(key, w);
  return w;
}

/** Drop broken workers so the next call recreates them. */
export function resetOcrWorkers(): void {
  for (const w of workers.values()) {
    void w.terminate().catch(() => undefined);
  }
  workers.clear();
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

/**
 * Grayscale + contrast stretch + Otsu binarize on a canvas region.
 * MRZ zones are printed dark-on-light: binarizing them removes photo
 * noise and shadows that confuse OCR.
 */
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

  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g | 0]++;
  }
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

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/**
 * OCR the region where an MRZ lives. TD3/TD1 zones sit at the BOTTOM of
 * the page, so only the bottom `fraction` of the image is recognized —
 * faster and far more accurate than reading the whole photo.
 */
export async function ocrMrzZone(
  dataUrl: string,
  opts: { fromFraction?: number; binarize?: boolean } = {},
): Promise<OcrOutcome> {
  const { fromFraction = 0.62, binarize = true } = opts;
  const img = await dataUrlToImage(dataUrl);
  const y0 = Math.floor(img.height * fromFraction);
  const band = document.createElement("canvas");
  band.width = img.width;
  band.height = Math.max(1, img.height - y0);
  const bctx = band.getContext("2d", { willReadFrequently: true })!;
  bctx.fillStyle = "#ffffff";
  bctx.fillRect(0, 0, band.width, band.height);
  bctx.drawImage(img, 0, -y0);
  const pre = preprocessCanvas(band, { binarize, maxWidth: 2200 });
  const worker = await getWorker(0);
  const result = await withTimeout(worker.recognize(pre), "ocrMrzZone");
  return {
    text: result.data.text ?? "",
    confidence: Math.round(result.data.confidence ?? 0),
  };
}

/** Full-image English OCR (used when the bottom band finds nothing). */
export async function ocrFullImage(dataUrl: string): Promise<OcrOutcome> {
  const img = await dataUrlToImage(dataUrl);
  const pre = preprocessCanvas(img, { binarize: false, maxWidth: 2000 });
  const worker = await getWorker(1);
  const result = await withTimeout(worker.recognize(pre), "ocrFullImage");
  return {
    text: result.data.text ?? "",
    confidence: Math.round(result.data.confidence ?? 0),
  };
}

/** Full-image PERSIAN (fas) OCR — reads تذکره labels the English passes cannot. */
export async function ocrFullImageFas(dataUrl: string): Promise<OcrOutcome> {
  const img = await dataUrlToImage(dataUrl);
  const pre = preprocessCanvas(img, { binarize: false, maxWidth: 2000 });
  const worker = await getWorker(0, "fas");
  const result = await withTimeout(worker.recognize(pre), "ocrFullImageFas");
  return {
    text: result.data.text ?? "",
    confidence: Math.round(result.data.confidence ?? 0),
  };
}
