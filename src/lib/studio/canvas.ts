/**
 * Pure canvas toolbox for «ابزار عکس» — every operation is a function that
 * takes a canvas and returns a NEW canvas (the old one becomes history).
 *
 * The working state lives in an offscreen HTMLCanvasElement at natural
 * resolution; the UI shows a blob-URL <img> and stages live previews with
 * CSS filters, so nothing is re-encoded until the user saves/downloads.
 *
 * Only usable in the browser (document/canvas). Unit tests cover the pure
 * helpers at the bottom (filename/extension/size math).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Adjustments {
  brightness: number; // 100 = unchanged (percent)
  contrast: number;
  saturation: number;
  grayscale: boolean;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: false,
};

export type OutputFormat = "image/webp" | "image/jpeg" | "image/png";

export const OUTPUT_FORMATS: { value: OutputFormat; label: string; ext: string }[] = [
  { value: "image/webp", label: "WebP", ext: "webp" },
  { value: "image/jpeg", label: "JPEG", ext: "jpg" },
  { value: "image/png", label: "PNG", ext: "png" },
];

export function extForFormat(fmt: OutputFormat): string {
  return OUTPUT_FORMATS.find((f) => f.value === fmt)?.ext ?? "img";
}

/** Retarget a filename's extension to the chosen output format. */
export function retargetExt(name: string, fmt: OutputFormat): string {
  const base = name.replace(/\.[a-z0-9]{1,6}$/i, "") || "image";
  return `${base}.${extForFormat(fmt)}`;
}

/* ------------------------------ core helpers ------------------------------ */

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  return ctx;
}

/** Draw a source canvas onto a fresh white-backed canvas. */
function fromCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const c = newCanvas(bitmap.width, bitmap.height);
  ctx2d(c).drawImage(bitmap, 0, 0);
  return c;
}

export async function loadImageCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  try {
    return canvasFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

/* ------------------------------- operations ------------------------------- */

export function applyCrop(src: HTMLCanvasElement, rect: Rect): HTMLCanvasElement {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.min(src.width - x, Math.round(rect.w));
  const h = Math.min(src.height - y, Math.round(rect.h));
  if (w < 1 || h < 1) throw new Error("ناحیه برش خیلی کوچک است.");
  const c = newCanvas(w, h);
  ctx2d(c).drawImage(src, -x, -y);
  return c;
}

/**
 * Resize with high quality: when shrinking more than 2×, downscale in
 * repeated halving steps (much better detail than a single drawImage).
 */
export function applyResize(src: HTMLCanvasElement, targetW: number, targetH: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(targetH));
  if (w === src.width && h === src.height) return fromCanvas(src);

  let current: HTMLCanvasElement = src;
  // Stepwise halving while at least one dimension is >2× the target.
  while (current.width >= w * 2 && current.height >= h * 2) {
    const half = newCanvas(current.width / 2, current.height / 2);
    const hctx = ctx2d(half);
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  const out = newCanvas(w, h);
  const octx = ctx2d(out);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(current, 0, 0, w, h);
  return out;
}

/** Exact 90° rotation (swap dimensions) — dir: 1 = clockwise, -1 = counter. */
export function applyRotate90(src: HTMLCanvasElement, dir: 1 | -1): HTMLCanvasElement {
  const c = newCanvas(src.height, src.width);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Arbitrary fine rotation (degrees, can be fractional) with white fill. */
export function applyFineRotate(src: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = src.width * cos + src.height * sin;
  const h = src.width * sin + src.height * cos;
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function applyFlip(src: HTMLCanvasElement, axis: "h" | "v"): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(axis === "h" ? -1 : 1, axis === "v" ? -1 : 1);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Bake brightness/contrast/saturation/grayscale into the pixels. */
export function applyAdjustments(src: HTMLCanvasElement, adj: Adjustments): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.filter = adjustmentsToFilter(adj);
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  return c;
}

export function isDefaultAdjustments(adj: Adjustments): boolean {
  return (
    adj.brightness === 100 && adj.contrast === 100 && adj.saturation === 100 && !adj.grayscale
  );
}

/** CSS filter string — identical semantics for ctx.filter and CSS. */
export function adjustmentsToFilter(adj: Adjustments): string {
  if (isDefaultAdjustments(adj)) return "none";
  const parts = [
    `brightness(${adj.brightness}%)`,
    `contrast(${adj.contrast}%)`,
    `saturate(${adj.saturation}%)`,
  ];
  if (adj.grayscale) parts.push("grayscale(1)");
  return parts.join(" ");
}

/* -------------------------------- encoding -------------------------------- */

export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  mime: OutputFormat,
  quality: number,
): Promise<Blob> {
  if (mime === "image/png") {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    return blob;
  }
  // JPEG has no alpha channel — a naive toBlob("image/jpeg") composites onto
  // BLACK. Flatten onto white so transparent PNG logos/scans stay printable
  // (JPEG is the default output format now).
  let src = canvas;
  if (mime === "image/jpeg") {
    const flat = newCanvas(canvas.width, canvas.height);
    const ctx = ctx2d(flat);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    src = flat;
  }
  const q = Math.min(1, Math.max(0.3, quality));
  const blob = await new Promise<Blob | null>((r) => src.toBlob(r, mime, q));
  if (!blob) throw new Error("encoding failed");
  return blob;
}

/** Quick JPEG preview URL for the on-screen <img> (synchronous data URL). */
export function canvasToPreviewUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ------------------------- pure helpers (tested) -------------------------- */

/** Human-readable byte size in Persian digits: «۴۲۰ کیلوبایت». */
export function humanBytes(bytes: number): string {
  const fa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${fa(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${fa((bytes / 1024).toFixed(bytes < 10240 ? 1 : 0))} کیلوبایت`;
  return `${fa((bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 * 10 ? 1 : 0))} مگابایت`;
}

/** Percentage saved vs the original size (>=0 shown as −, growth as +). */
export function savingsPct(original: number, next: number): number | null {
  if (original <= 0 || next < 0) return null;
  return Math.round(((original - next) / original) * 100);
}

/** Fit a selection rectangle inside [0,1] fractions and enforce min size. */
export function clampSel(
  sel: { x: number; y: number; w: number; h: number },
  min = 0.05,
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(sel.x, 0), 1 - min);
  const y = Math.min(Math.max(sel.y, 0), 1 - min);
  let w = Math.min(Math.max(sel.w, min), 1 - x);
  let h = Math.min(Math.max(sel.h, min), 1 - y);
  return { x, y, w, h };
}

/** Map a normalized selection to pixel rect on a canvas of given size. */
export function selToRect(
  sel: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): Rect {
  return {
    x: Math.round(sel.x * width),
    y: Math.round(sel.y * height),
    w: Math.round(sel.w * width),
    h: Math.round(sel.h * height),
  };
}

/** Suggest resized dimensions keeping the ratio (one of w/h may be null). */
export function fitRatio(
  w: number | null,
  h: number | null,
  ratio: number,
): { w: number; h: number } {
  if (w && w > 0) return { w: Math.round(w), h: Math.round(w / ratio) };
  if (h && h > 0) return { w: Math.round(h * ratio), h: Math.round(h) };
  return { w: 0, h: 0 };
}
