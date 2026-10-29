/**
 * Robot Companion — global pointer tracking.
 *
 * R3F's built-in `pointer` only updates while the cursor is INSIDE the tiny
 * robot canvas — so on a full page the eyes "lagged behind the mouse" (the
 * exact complaint). This store tracks the pointer across the WHOLE viewport
 * on the document level and normalizes it to R3F's convention:
 *
 *   x: -1 (left edge) … +1 (right edge)
 *   y: -1 (bottom)     … +1 (top)
 *
 * Node-safe: falls back to (0, 0) outside the browser (tests).
 */

export interface GlobalPointerState {
  x: number;
  y: number;
}

let x = 0;
let y = 0;
let armed = false;

function onPointerMove(e: PointerEvent): void {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  x = (e.clientX / w) * 2 - 1;
  y = -((e.clientY / h) * 2 - 1);
}

/** Idempotent — the first robot on the page arms the single listener. */
export function ensureGlobalPointerTracking(): void {
  if (armed || typeof document === "undefined") return;
  armed = true;
  document.addEventListener("pointermove", onPointerMove, { passive: true });
}

/** Current normalized pointer (never throws; (0,0) before any move). */
export function getGlobalPointer(): GlobalPointerState {
  return { x, y };
}

/** Tests only. */
export function __resetGlobalPointerForTests(): void {
  x = 0;
  y = 0;
  armed = false;
  if (typeof document !== "undefined") {
    document.removeEventListener("pointermove", onPointerMove);
  }
}
