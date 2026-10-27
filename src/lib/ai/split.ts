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

/** One detected blank band, in fractions of the split dimension. */
export interface GutterRun {
  /** Fraction where the cut should go (band center). */
  center: number;
  /** Band start/end fractions (the blank region itself). */
  start: number;
  end: number;
}

/**
 * Find gutter bands (as fractions of the dimension) from per-line luminance
 * profiles. Pure — no canvas, no DOM.
 *
 * Returns at most 2 positions (→ at most 3 pieces) in ascending order.
 */
export function findGutterRuns(
  profiles: LineProfile[],
  opts: GutterOptions = DEFAULT_GUTTER_OPTIONS,
): GutterRun[] {
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

  const out: GutterRun[] = [];
  for (const run of runs) {
    const len = run.end - run.start + 1;
    if (len < minLen || len > maxLen) continue;
    const center = (run.start + run.end) / 2;
    const frac = center / n;
    if (frac < opts.centerMin || frac > opts.centerMax) continue;
    out.push({ center: frac, start: run.start / n, end: (run.end + 1) / n });
    if (out.length >= 2) break;
  }
  // Two bands must be separated enough to leave three usable pieces.
  if (out.length === 2 && out[1].center - out[0].center < 0.15) return out.slice(0, 1);
  return out;
}

/** Backwards-compatible wrapper: just the cut positions. */
export function findGutterBands(
  profiles: LineProfile[],
  opts: GutterOptions = DEFAULT_GUTTER_OPTIONS,
): number[] {
  return findGutterRuns(profiles, opts).map((r) => r.center);
}

/* ------------------------------- canvas part ------------------------------ */

const ANALYSIS_EDGE = 420;
const JPEG_QUALITY = 0.85;

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/** Grayscale buffer used by all local image analysis (exported for tests). */
export interface GrayImage {
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

/* -------------------- cut-through-content guard (the halving bug) --------- */

/** Width of the strips checked beside a candidate band (fraction of dim). */
const EDGE_STRIP_FRAC = 0.02;
/** Pixels darker than this count as ink in the strips. */
const INK_DARK = 140;
/** Strip ink fraction above which content is sliced → not a gutter. */
const STRIP_INK_LIMIT = 0.015;
/** One line crossing ≥ this share of the strip = a sliced box border. */
const RULE_LINE_FRAC = 0.85;

export interface StripStats {
  /** Fraction of ink pixels in the strip. */
  ink: number;
  /** True when a solid line (box border) runs through the strip. */
  rule: boolean;
}

/**
 * Measure ink inside one narrow strip [from, to) of the split axis.
 * Pure — works on the gray buffer, no canvas.
 */
export function stripInkStats(
  img: GrayImage,
  from: number,
  to: number,
  vertical: boolean,
): StripStats {
  if (to - from < 1) return { ink: 0, rule: false };
  const inner = vertical ? img.h : img.w;
  const stepInner = Math.max(1, Math.floor(inner / 200));
  let dark = 0;
  let total = 0;
  let rule = false;
  for (let j = 0; j < inner; j += stepInner) {
    let d = 0;
    let n = 0;
    for (let k = from; k < to; k++) {
      const p = vertical ? img.data[j * img.w + k] : img.data[k * img.w + j];
      n++;
      if (p < INK_DARK) d++;
    }
    if (n > 0 && d / n >= RULE_LINE_FRAC) rule = true;
    dark += d;
    total += n;
  }
  return { ink: total > 0 ? dark / total : 0, rule };
}

/**
 * A REAL gutter between two documents is blank paper/bed on BOTH sides of the
 * band — documents never have ink touching the gap. When ink or a box border
 * sits right beside the "blank" band, the band is INSIDE one document (an
 * internal white area, e.g. the middle of a paper تذکره back) and cutting
 * there would slice that document in half. Such bands are rejected here.
 */
export function bandSlicesContent(
  img: GrayImage,
  run: { start: number; end: number },
  vertical: boolean,
): boolean {
  const outer = vertical ? img.w : img.h;
  const strip = Math.max(2, Math.round(outer * EDGE_STRIP_FRAC));
  const a = Math.max(0, Math.round(run.start * outer));
  const b = Math.min(outer, Math.round(run.end * outer));
  const left = stripInkStats(img, Math.max(0, a - strip), a, vertical);
  if (left.ink >= STRIP_INK_LIMIT || left.rule) return true;
  const right = stripInkStats(img, b, Math.min(outer, b + strip), vertical);
  if (right.ink >= STRIP_INK_LIMIT || right.rule) return true;
  return false;
}

/* ------------------- sheet-edge rescue (combined scans) -------------------- */

/** How many levels below the background a paper/shadow column must be. */
const SHEET_EDGE_DROP = 10;
/** A paper run must span at least this share of the width to count. */
const SHEET_EDGE_MIN_RUN = 0.3;
/** The physical gutter between two sheets must be at least this wide. */
const SHEET_EDGE_MIN_GAP = 0.03;

/**
 * When ink touches a band's edges, the band may still be a REAL gutter
 * between two sheets whose blank paper margins merged into the band (light
 * paper on a light bed passes the blank-line test). Inside such a band:
 *
 *   - rows that still show the SHEET (paper tone or its edge shadow, a long
 *     run of pixels darker than the bed) are "covered";
 *   - the physical gutter rows show NOTHING (pure bed) — "uncovered".
 *
 * ONE document with an internal white gap keeps the paper visible through
 * the whole band → a single covered block → never cut. TWO separate sheets
 * produce covered-block / uncovered-gutter / covered-block → cut through the
 * gutter. Returns the cut fraction, or null when this is one document.
 */
export function findSheetEdgeCut(
  img: GrayImage,
  run: { start: number; end: number },
  vertical: boolean,
): number | null {
  const outer = vertical ? img.w : img.h;
  const inner = vertical ? img.h : img.w;
  const a = Math.max(0, Math.round(run.start * outer));
  const b = Math.min(outer, Math.round(run.end * outer));
  if (b - a < 6) return null;

  const stepInner = Math.max(1, Math.floor(inner / 128));

  // Background = the bed/gutter level (bright percentile of the band).
  const samples: number[] = [];
  const stepOuter = Math.max(1, Math.floor((b - a) / 64));
  for (let k = a; k < b; k += stepOuter) {
    for (let j = 0; j < inner; j += stepInner) {
      samples.push(vertical ? img.data[j * img.w + k] : img.data[k * img.w + j]);
    }
  }
  samples.sort((x, y) => x - y);
  const bg = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
  const paperLimit = bg - SHEET_EDGE_DROP;

  // Per line: longest contiguous run of paper/shadow columns.
  const cols = Math.ceil(inner / stepInner);
  const minRun = Math.ceil(SHEET_EDGE_MIN_RUN * cols);
  const covered: boolean[] = [];
  for (let k = a; k < b; k++) {
    let best = 0;
    let cur = 0;
    for (let j = 0; j < inner; j += stepInner) {
      const p = vertical ? img.data[j * img.w + k] : img.data[k * img.w + j];
      if (p <= paperLimit) {
        cur++;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
    }
    covered.push(best >= minRun && best < cols * 0.98);
  }

  // Contiguous covered blocks = sheet extents inside the band.
  const blocks: { start: number; end: number }[] = [];
  let i = 0;
  while (i < covered.length) {
    if (!covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < covered.length && covered[j]) j++;
    blocks.push({ start: a + i, end: a + j - 1 });
    i = j;
  }
  if (blocks.length < 2) return null;

  // Cut through the widest uncovered gap (the physical gutter).
  let bestGap = 0;
  let cut = -1;
  for (let k = 0; k + 1 < blocks.length; k++) {
    const gapStart = blocks[k].end;
    const gapEnd = blocks[k + 1].start;
    const gap = (gapEnd - gapStart) / outer;
    if (gap > bestGap) {
      bestGap = gap;
      cut = (gapStart + gapEnd) / 2 / outer;
    }
  }
  if (bestGap < SHEET_EDGE_MIN_GAP) return null;
  return cut;
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
        const runs = findGutterRuns(profiles);
        if (runs.length === 0) continue;
        // A band whose edges touch ink/box-borders is usually INSIDE one
        // document (e.g. the white middle of a paper تذکره back) — cutting
        // there would halve the document. The only exception: two separate
        // sheets whose blank margins merged into the band leave thin shadow
        // edges inside it (findSheetEdgeCut) — a true combined scan.
        const bands: number[] = [];
        for (const run of runs) {
          if (!bandSlicesContent(gray, run, vertical)) {
            bands.push(run.center); // clean gutter margins — safe to cut
          } else {
            const rescued = findSheetEdgeCut(gray, run, vertical);
            if (rescued !== null) bands.push(rescued);
          }
        }
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

/* ------------------------------ blank pages ------------------------------- */

/** Share of clearly dark pixels below which a page counts as blank. */
const BLANK_DARK_FRACTION = 0.0015;
/** Contrast range below which a page is uniform (paper or closed lid). */
const BLANK_MAX_CONTRAST = 32;

/**
 * Blank-page detector: a PDF page (or any image) with essentially no ink
 * and no contrast. Blank pages are dropped before they ever reach the AI —
 * they must not land in «سایر». Never throws; on failure → not blank.
 */
export async function isBlankImage(dataUrl: string): Promise<boolean> {
  try {
    const bitmap = await dataUrlToBitmap(dataUrl);
    try {
      const gray = drawGray(bitmap, ANALYSIS_EDGE);
      const total = gray.data.length;
      let min = 255;
      let max = 0;
      let dark = 0;
      for (let p = 0; p < total; p++) {
        const v = gray.data[p];
        if (v < min) min = v;
        if (v > max) max = v;
        if (v < 130) dark++;
      }
      if (max - min <= BLANK_MAX_CONTRAST) return true; // uniform page
      return dark / total < BLANK_DARK_FRACTION; // no real ink
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
  }
}
