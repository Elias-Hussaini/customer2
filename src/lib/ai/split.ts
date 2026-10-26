/**
 * Local image tools for the AI document flow.
 *
 * Scans very often combine two document sides on ONE page — e.g. the front
 * and back of a tazkira photographed side by side, or stacked vertically in
 * a PDF. Before anything is sent to the model, every image is analyzed for
 * a uniform "gutter" band (blank scanner background) running through its
 * middle. When a full-length gutter is found, the image is cut into its
 * parts so each side can be classified and filed separately.
 *
 * The band-detection math lives in a pure function (`findGutterBands`) so it
 * is unit-testable without a canvas; the canvas part only feeds it profiles
 * and crops the original image at the proportional positions.
 */

export interface LineProfile {
  /** Average luminance 0-255 along the line. */
  mean: number;
  /** Luminance spread along the line — near 0 for blank background. */
  stddev: number;
}

export interface GutterOptions {
  /** Minimum average luminance for a blank (paper-white) line. */
  minMean: number;
  /** Maximum stddev for a blank line. */
  maxStddev: number;
  /** Band width as a fraction of the dimension (min/max). */
  minBandFrac: number;
  maxBandFrac: number;
  /** The band center must sit inside [centerMin, centerMax] of the dimension. */
  centerMin: number;
  centerMax: number;
}

export const DEFAULT_GUTTER_OPTIONS: GutterOptions = {
  minMean: 168,
  maxStddev: 9,
  minBandFrac: 0.008,
  maxBandFrac: 0.3,
  centerMin: 0.2,
  centerMax: 0.8,
};

/**
 * Find gutter-band centers (as fractions of the dimension) from per-line
 * luminance profiles. Pure — no canvas, no DOM.
 *
 * Returns at most 2 positions (→ at most 3 pieces) in ascending order.
 */
export function findGutterBands(
  profiles: LineProfile[],
  opts: GutterOptions = DEFAULT_GUTTER_OPTIONS,
): number[] {
  const n = profiles.length;
  if (n < 8) return [];
  const minLen = Math.max(2, Math.round(opts.minBandFrac * n));
  const maxLen = Math.round(opts.maxBandFrac * n);

  const blank = profiles.map((p) => p.mean >= opts.minMean && p.stddev <= opts.maxStddev);

  // Contiguous blank runs, merged when separated by a single noisy line.
  const runs: { start: number; end: number }[] = [];
  let i = 0;
  while (i < n) {
    if (!blank[i]) {
      i++;
      continue;
    }
    let j = i;
    let lastBlank = i;
    while (j < n) {
      if (blank[j]) {
        lastBlank = j;
        j++;
      } else if (j + 1 < n && blank[j + 1] && j - lastBlank <= 1) {
        // single noisy line inside the band — keep scanning
        j++;
      } else {
        break;
      }
    }
    runs.push({ start: i, end: lastBlank });
    i = j;
  }

  const centers: number[] = [];
  for (const run of runs) {
    const len = run.end - run.start + 1;
    if (len < minLen || len > maxLen) continue;
    const center = (run.start + run.end) / 2;
    const frac = center / n;
    if (frac < opts.centerMin || frac > opts.centerMax) continue;
    centers.push(frac);
    if (centers.length >= 2) break;
  }
  // Two bands must be separated enough to leave three usable pieces.
  if (centers.length === 2 && centers[1] - centers[0] < 0.15) return centers.slice(0, 1);
  return centers;
}

/* ------------------------------- canvas part ------------------------------ */

const ANALYSIS_EDGE = 420;
const JPEG_QUALITY = 0.85;

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

interface GrayImage {
  data: Uint8ClampedArray; // w*h luminance
  w: number;
  h: number;
}

function drawGray(bitmap: ImageBitmap, maxEdge: number): GrayImage {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) {
    gray[p] = (rgba[p * 4] * 299 + rgba[p * 4 + 1] * 587 + rgba[p * 4 + 2] * 114) / 1000;
  }
  return { data: gray, w, h };
}

/** Mean/stddev of one column (or row when transposed) of the gray image. */
function lineProfile(
  img: GrayImage,
  index: number,
  vertical: boolean,
  step: number,
): LineProfile {
  const outer = vertical ? img.h : img.w; // lines along the long direction
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let k = 0; k < outer; k += step) {
    const p = vertical ? img.data[k * img.w + index] : img.data[index * img.w + k];
    sum += p;
    sumSq += p * p;
    count++;
  }
  const mean = sum / count;
  return { mean, stddev: Math.sqrt(Math.max(0, sumSq / count - mean * mean)) };
}

/**
 * Does the region between two fractions of the split axis contain real
 * content (text/photo) — i.e. is it NOT blank paper?
 */
function regionHasContent(img: GrayImage, from: number, to: number, vertical: boolean): boolean {
  // The split axis: x (width) for a vertical gutter, y (height) for horizontal.
  const outer = vertical ? img.w : img.h;
  const inner = vertical ? img.h : img.w;
  const a = Math.round(from * outer);
  const b = Math.round(to * outer);
  if (b - a < 4) return false;
  let min = 255;
  let max = 0;
  let dark = 0;
  let total = 0;
  const stepOuter = Math.max(1, Math.floor((b - a) / 60));
  const stepInner = Math.max(1, Math.floor(inner / 60));
  for (let k = a; k < b; k += stepOuter) {
    for (let j = 0; j < inner; j += stepInner) {
      const p = vertical ? img.data[j * img.w + k] : img.data[k * img.w + j];
      if (p < min) min = p;
      if (p > max) max = p;
      if (p < 130) dark++;
      total++;
    }
  }
  // Needs both contrast (dark ink vs background) and enough inked pixels.
  return max - min > 45 && dark / Math.max(1, total) > 0.01;
}

function cropToJpeg(
  bitmap: ImageBitmap,
  vertical: boolean,
  from: number,
  to: number,
): string {
  const outer = vertical ? bitmap.width : bitmap.height;
  const inner = vertical ? bitmap.height : bitmap.width;
  const a = Math.round(from * outer);
  const b = Math.round(to * outer);
  const canvas = document.createElement("canvas");
  const w = Math.max(1, b - a);
  canvas.width = vertical ? w : inner;
  canvas.height = vertical ? inner : w;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (vertical) {
    ctx.drawImage(bitmap, a, 0, w, inner, 0, 0, w, inner);
  } else {
    ctx.drawImage(bitmap, 0, a, inner, w, 0, 0, inner, w);
  }
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export interface SplitReport {
  /** The pieces (a single entry = nothing was split). */
  images: string[];
  /** How many cuts were made (0, 1 or 2). */
  cuts: number;
}

/**
 * Analyze one image and, when it looks like a combined scan (two or three
 * document parts separated by blank background), cut it into its parts.
 * Never throws — on any failure the original image is returned untouched.
 */
export async function splitCombinedImage(dataUrl: string): Promise<SplitReport> {
  try {
    const bitmap = await dataUrlToBitmap(dataUrl);
    try {
      if (Math.min(bitmap.width, bitmap.height) < 220) {
        return { images: [dataUrl], cuts: 0 };
      }
      const gray = drawGray(bitmap, ANALYSIS_EDGE);
      for (const vertical of [true, false]) {
        const lines = vertical ? gray.w : gray.h;
        const step = Math.max(1, Math.floor(lines / 300));
        const profiles: LineProfile[] = [];
        for (let x = 0; x < lines; x += step) {
          profiles.push(lineProfile(gray, x, vertical, 1));
        }
        const bands = findGutterBands(profiles);
        if (bands.length === 0) continue;
        // Validate that every resulting piece actually has content.
        const cuts = [0, ...bands, 1];
        const piecesOk: number[] = [];
        for (let i = 0; i < cuts.length - 1; i++) {
          if (regionHasContent(gray, cuts[i], cuts[i + 1], vertical)) {
            piecesOk.push(i);
          }
        }
        if (piecesOk.length !== cuts.length - 1) continue;
        const images: string[] = [];
        for (let i = 0; i < cuts.length - 1; i++) {
          images.push(cropToJpeg(bitmap, vertical, cuts[i], cuts[i + 1]));
        }
        return { images, cuts: cuts.length - 2 };
      }
      return { images: [dataUrl], cuts: 0 };
    } finally {
      bitmap.close();
    }
  } catch {
    return { images: [dataUrl], cuts: 0 };
  }
}
