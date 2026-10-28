/**
 * Background at-rest optimizer for images already stored in IndexedDB.
 *
 * New uploads are compressed at save time (utils/imageCompress), but images
 * that were registered BEFORE this feature — or restored from an older ZIP
 * backup — are still sitting there at their original size. This pass walks
 * them once, quietly, in the background:
 *
 *   • candidates: images (never PDF/SVG/GIF) larger than MIN_BYTES with no
 *     `opt` marker yet — the marker is set after ANY attempt (success or
 *     "not worth it"), so each image is visited at most once per restore;
 *   • one image at a time with a small pause between → the UI never stutters;
 *   • fully cancelable; a module guard prevents concurrent runs;
 *   • nothing is deleted: ids, kinds, links and timestamps stay untouched —
 *     only blob/mime/size/name shrink, exactly like a fresh upload would.
 *
 * The ZIP backups carry the `opt` marker through, so a backup→restore cycle
 * never re-processes what is already lean.
 */

import { db } from "../db/schema";
import { compressImage, DEFAULT_MIN_BYTES, isCompressibleImage } from "../utils/imageCompress";

export interface OptimizeProgress {
  done: number;
  total: number;
  optimized: number;
  savedBytes: number;
  /** Which table the pass is currently working on. */
  section: "attachments" | "documents";
}

export interface OptimizeSummary {
  scanned: number;
  optimized: number;
  savedBytes: number;
}

const PAUSE_MS = 140;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let running = false;
let cancelled = false;

/** Cancel the in-flight pass (the current image still finishes safely). */
export function cancelImageOptimizer(): void {
  if (running) cancelled = true;
}

function isCandidate(mime: string, size: number, opt: number | undefined): boolean {
  return isCompressibleImage(mime) && size > DEFAULT_MIN_BYTES && !opt;
}

/**
 * Compress everything eligible. Returns when done or cancelled. Safe to call
 * from anywhere; a second call while one is running returns immediately.
 */
export async function optimizeStoredImages(
  onProgress?: (p: OptimizeProgress) => void,
): Promise<OptimizeSummary> {
  if (running) return { scanned: 0, optimized: 0, savedBytes: 0 };
  running = true;
  cancelled = false;
  const summary: OptimizeSummary = { scanned: 0, optimized: 0, savedBytes: 0 };

  try {
    /* ------------------------- main-app attachments ------------------------ */
    const attIds = await db.attachments.filter((a) => isCandidate(a.mime, a.size, a.opt)).primaryKeys();
    let done = 0;
    for (const id of attIds) {
      if (cancelled) break;
      const att = await db.attachments.get(id);
      if (!att || !isCandidate(att.mime, att.size, att.opt)) continue;
      summary.scanned++;
      try {
        const res = await compressImage({ blob: att.blob, name: att.name, mime: att.mime });
        if (res.replaced) {
          await db.attachments.update(id, {
            blob: res.blob,
            mime: res.mime,
            size: res.finalBytes,
            name: res.name || att.name,
            opt: Date.now(),
          });
          summary.optimized++;
          summary.savedBytes += res.savedBytes;
        } else {
          await db.attachments.update(id, { opt: Date.now() });
        }
      } catch (e) {
        console.warn("[image-optimizer] skipping attachment", id, e);
      }
      done++;
      onProgress?.({ done, total: attIds.length, ...summary, section: "attachments" });
      await sleep(PAUSE_MS);
    }

    /* --------------------------- accounting docs --------------------------- */
    if (!cancelled) {
      const docIds = await db.accDocs.filter((d) => isCandidate(d.mime, d.size, d.opt)).primaryKeys();
      done = 0;
      for (const id of docIds) {
        if (cancelled) break;
        const doc = await db.accDocs.get(id);
        if (!doc || !isCandidate(doc.mime, doc.size, doc.opt)) continue;
        summary.scanned++;
        try {
          const res = await compressImage({ blob: doc.blob, name: doc.name, mime: doc.mime });
          if (res.replaced) {
            await db.accDocs.update(id, {
              blob: res.blob,
              mime: res.mime,
              size: res.finalBytes,
              name: res.name || doc.name,
              opt: Date.now(),
            });
            summary.optimized++;
            summary.savedBytes += res.savedBytes;
          } else {
            await db.accDocs.update(id, { opt: Date.now() });
          }
        } catch (e) {
          console.warn("[image-optimizer] skipping doc", id, e);
        }
        done++;
        onProgress?.({ done, total: docIds.length, ...summary, section: "documents" });
        await sleep(PAUSE_MS);
      }
    }
  } finally {
    running = false;
    cancelled = false;
  }

  return summary;
}

/** Is a pass currently running? (used by the manual UI trigger) */
export function isOptimizerRunning(): boolean {
  return running;
}

/**
 * Fire-and-forget startup hook — launched a few seconds after boot so it
 * never competes with app startup, restore operations or the first paint.
 */
export function runStartupImageOptimizer(delayMs = 8000): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    void optimizeStoredImages().then((s) => {
      if (s.optimized > 0) {
        console.info(
          `[image-optimizer] ${s.optimized} عکس فشرده شد — ${(s.savedBytes / 1024).toFixed(0)}KB آزاد شد`,
        );
      }
    }).catch((e) => console.warn("[image-optimizer] failed", e));
  }, delayMs);
}
