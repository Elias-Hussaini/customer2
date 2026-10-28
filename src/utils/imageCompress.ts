/**
 * Smart at-rest image compression — "visually lossless, always in the
 * background, and only when it actually helps".
 *
 * Every image saved into the app (customer documents, receipts, AI results,
 * accounting documents) passes through here. The engine:
 *
 *   1. skips tiny images (below MIN_BYTES) — they are already lean;
 *   2. decodes with createImageBitmap (hardware accelerated, off the hot path)
 *      and caps the long edge to maxDim;
 *   3. encodes BOTH WebP and JPEG candidates (WebP keeps alpha; JPEG gets a
 *      white matte) and keeps whichever is smallest;
 *   4. replaces the original ONLY when the saving is meaningful — otherwise
 *      the untouched original is stored ("اگر که کم می‌شود که دیگر اوکی است").
 *
 * Animated GIFs and SVGs are never re-encoded (they would be destroyed);
 * PDFs are never touched (legal documents stay byte-identical).
 *
 * Everything is defensive: no canvas/OffscreenCanvas (SSR, tests, old
 * browsers) → the original comes back untouched. The AI pipeline is unaffected
 * because it always re-encodes to JPEG before sending anything to the worker.
 */

export interface CompressImageInput {
  blob: Blob;
  /** Stored file name — the extension is retargeted when the format changes. */
  name?: string;
  /** Override mime (e.g. sniffed) when it must win over blob.type. */
  mime?: string;
}

export interface CompressOptions {
  /** Long-edge pixel cap. Default 2000 — comfortably above the AI 1800 cap. */
  maxDim?: number;
  /** Images below this size are stored untouched. Default 200 KB. */
  minBytes?: number;
  /** WebP encoder quality. Default 0.86. */
  webpQuality?: number;
  /** JPEG encoder quality. Default 0.88. */
  jpegQuality?: number;
}

export interface CompressImageResult {
  blob: Blob;
  mime: string;
  name: string;
  /** The engine actually decoded + encoded (vs. a fast-path passthrough). */
  attempted: boolean;
  /** A different, smaller encoding replaced the original bytes. */
  replaced: boolean;
  originalBytes: number;
  finalBytes: number;
  /** originalBytes - finalBytes (never negative). */
  savedBytes: number;
}

export const DEFAULT_MAX_DIM = 2000;
export const DEFAULT_MIN_BYTES = 200 * 1024;
const DEFAULT_WEBP_QUALITY = 0.86;
const DEFAULT_JPEG_QUALITY = 0.88;
/** A re-encode must save at least this fraction to be worth it. */
const MIN_GAIN_RATIO = 0.08;

/** Mimes we are willing to re-encode. SVG (code) and GIF (animation) never. */
export function isCompressibleImage(mime: string): boolean {
  if (!mime.startsWith("image/")) return false;
  return !/image\/(svg\+xml|gif)/i.test(mime);
}

/** Formats that may carry an alpha channel — only WebP may replace them. */
function mayHaveAlpha(mime: string): boolean {
  return /^image\/(png|webp|avif|bmp)$/i.test(mime);
}

/** Map a stored file name onto a new mime's canonical extension. */
export function retargetName(name: string | undefined, mime: string): string {
  const ext =
    mime === "image/webp"
      ? ".webp"
      : mime === "image/png"
        ? ".png"
        : mime === "image/jpeg"
          ? ".jpg"
          : mime === "image/bmp"
            ? ".bmp"
            : mime === "image/avif"
              ? ".avif"
              : "";
  if (!name) return ext ? `عکس${ext}` : "عکس";
  if (!ext) return name;
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/\.+$/, "");
  return `${base || "عکس"}${ext}`;
}

/**
 * Decide whether a re-encoded candidate should replace the original.
 * When the image was also downscaled the dimensions changed, so ANY size
 * win is accepted; otherwise the saving must clear MIN_GAIN_RATIO.
 */
export function shouldReplace(
  originalBytes: number,
  candidateBytes: number,
  downscaled: boolean,
  minGainRatio = MIN_GAIN_RATIO,
): boolean {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(candidateBytes)) return false;
  if (candidateBytes <= 0 || candidateBytes >= originalBytes) return false;
  return downscaled || candidateBytes <= originalBytes * (1 - minGainRatio);
}

/* --------------------------- encoder plumbing ----------------------------- */

let webpSupport: boolean | null = null;

/** One-time probe: can this browser encode WebP? */
function supportsWebpEncode(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    try {
      return await canvas.convertToBlob({ type, quality });
    } catch {
      return null;
    }
  }
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  }
  return null;
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap | null> {
  try {
    // "from-image" bakes the EXIF orientation in — stored bytes come out upright.
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
}

/* -------------------------------- the engine ------------------------------- */

const UNTOUCHED = (input: CompressImageInput, mime: string, attempted = false): CompressImageResult => ({
  blob: input.blob,
  mime,
  name: input.name ?? "",
  attempted,
  replaced: false,
  originalBytes: input.blob.size,
  finalBytes: input.blob.size,
  savedBytes: 0,
});

export async function compressImage(
  input: CompressImageInput,
  opts: CompressOptions = {},
): Promise<CompressImageResult> {
  const {
    maxDim = DEFAULT_MAX_DIM,
    minBytes = DEFAULT_MIN_BYTES,
    webpQuality = DEFAULT_WEBP_QUALITY,
    jpegQuality = DEFAULT_JPEG_QUALITY,
  } = opts;

  const mime = (input.mime || input.blob.type || "").toLowerCase();
  if (!isCompressibleImage(mime)) return UNTOUCHED(input, mime);
  if (input.blob.size < minBytes) return UNTOUCHED(input, mime);

  const bitmap = await decodeBitmap(input.blob);
  if (!bitmap) return UNTOUCHED(input, mime);

  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const downscaled = scale < 1;

    const makeCanvas = (matte: boolean): HTMLCanvasElement | OffscreenCanvas => {
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement("canvas"), { width: w, height: h });
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: !matte }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error("canvas unavailable");
      if (matte) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
      return canvas;
    };

    let plain: HTMLCanvasElement | OffscreenCanvas;
    try {
      plain = makeCanvas(false);
    } catch {
      return UNTOUCHED(input, mime, true);
    }

    // Candidate encodings — smallest wins.
    const candidates: Array<{ blob: Blob; mime: string }> = [];
    const webpOk = supportsWebpEncode();
    if (webpOk) {
      const webp = await encodeCanvas(plain, "image/webp", webpQuality);
      if (webp && webp.size > 0) candidates.push({ blob: webp, mime: "image/webp" });
    }
    // Alpha images are never flattened onto white — JPEG only when opaque-safe.
    if (!mayHaveAlpha(mime)) {
      let matted: HTMLCanvasElement | OffscreenCanvas;
      try {
        matted = makeCanvas(true);
      } catch {
        matted = plain;
      }
      const jpeg = await encodeCanvas(matted, "image/jpeg", jpegQuality);
      if (jpeg && jpeg.size > 0) candidates.push({ blob: jpeg, mime: "image/jpeg" });
    }

    if (candidates.length === 0) return UNTOUCHED(input, mime, true);
    const best = candidates.reduce((a, b) => (a.blob.size <= b.blob.size ? a : b));

    if (!shouldReplace(input.blob.size, best.blob.size, downscaled)) {
      return UNTOUCHED(input, mime, true);
    }

    return {
      blob: best.blob,
      mime: best.mime,
      name: retargetName(input.name, best.mime),
      attempted: true,
      replaced: true,
      originalBytes: input.blob.size,
      finalBytes: best.blob.size,
      savedBytes: input.blob.size - best.blob.size,
    };
  } finally {
    bitmap.close();
  }
}
