import type { Attachment } from "../../types";
import type { StudioImage } from "../../db/studio";

/**
 * Tiny session bridge for «ابزار عکس».
 *
 * Profile pages (مشتری / کارفرما) open a stored document straight into the
 * studio editor via openStudioFor(...); the studio page consumes the pending
 * source on mount and clears it. The editor then offers «ذخیره در پرونده»
 * which REPLACES the original attachment/library bytes in place — edit
 * passports right on the profile, exactly like the user asked.
 */

export type StudioSource =
  | { kind: "attachment"; attachment: Attachment }
  | { kind: "library"; image: StudioImage }
  | { kind: "files"; files: File[] }
  /** A profile photo (عکس پروفایل) — customer / rep / employer avatar. */
  | { kind: "photo"; entity: "customer" | "rep" | "employer"; id: string; name: string; photo: string };

let pending: { source: StudioSource; stamp: number } | null = null;

/** Open the studio with a specific source. Older requests are overwritten. */
export function openStudioFor(source: StudioSource): void {
  pending = { source, stamp: Date.now() };
}

/** Consume the pending source (studio page calls this once on mount). */
export function takePendingSource(): { source: StudioSource; stamp: number } | null {
  if (!pending) return null;
  const out = pending;
  pending = null;
  return out;
}

/** Peek without consuming (used to decide whether to show a "continue" hint). */
export function peekPendingSource(): { source: StudioSource; stamp: number } | null {
  return pending;
}
