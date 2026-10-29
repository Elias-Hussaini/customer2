/**
 * Launcher — persisted, user-personalizable button layout.
 *
 * The dock items (dashboard, lists, customers…) AND the floating round
 * buttons (accounting…) are all the same thing here: a LauncherItem with a
 * `place`. The user can:
 *   - reorder items inside the dock,
 *   - pull an item OUT of the dock (it becomes a round floating button,
 *     like the accounting one) and drop it ANYWHERE on the screen,
 *   - drag a floating button back into the dock.
 *
 * Device-level preference (localStorage) — deliberately NOT part of the
 * Dexie backup, exactly like the robot settings: it shapes THIS device's
 * shell, not the user's data.
 */

import { robotBus } from "../robot/eventBus";

export type LauncherPlace = "dock" | "free";

export interface LauncherItem {
  id: string;
  to: string;
  label: string;
  /** Icon registry key (resolved to a Lucide component in Launcher.tsx). */
  icon: string;
  /** Exact-match routes (dashboard "/") for the active state. */
  end?: boolean;
  place: LauncherPlace;
  /** Dock order (dock items only). */
  order: number;
  /** Free position — fractions of the viewport (center of the button). */
  fx?: number;
  fy?: number;
}

/* ------------------------------- storage ---------------------------------- */

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "launcher.layout.v1";

/** In-memory shim so the store also works in node (tests) without a DOM. */
const memory = new Map<string, string>();
const memoryShim: StorageLike = {
  getItem: (k) => (memory.has(k) ? (memory.get(k) as string) : null),
  setItem: (k, v) => void memory.set(k, v),
};

function storage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode — fall through to the shim */
  }
  return memoryShim;
}

/* -------------------------------- defaults -------------------------------- */

export function defaultLayout(): LauncherItem[] {
  return [
    { id: "nav-dashboard", to: "/", label: "داشبورد", icon: "dashboard", end: true, place: "dock", order: 0 },
    { id: "nav-lists", to: "/lists", label: "لیست‌ها", icon: "lists", place: "dock", order: 1 },
    { id: "nav-customers", to: "/customers", label: "مشتریان", icon: "customers", place: "dock", order: 2 },
    { id: "nav-reps", to: "/representatives", label: "نمایندگان", icon: "reps", place: "dock", order: 3 },
    { id: "nav-archive", to: "/smart-archive", label: "بایگانی هوشمند", icon: "archive", place: "dock", order: 4 },
    // The accounting button starts as a round floating button on the left
    // edge — its old home — and can be dragged anywhere (or into the dock).
    { id: "acc-accounting", to: "/accounting", label: "حسابداری", icon: "accounting", place: "free", order: 0, fx: 0.1, fy: 0.68 },
  ];
}

/* --------------------------------- state ---------------------------------- */

let cached: LauncherItem[] | null = null;
const listeners = new Set<() => void>();

function cloneItem(it: LauncherItem): LauncherItem {
  return { ...it };
}

function read(): LauncherItem[] {
  if (cached) return cached;
  try {
    const raw = storage().getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as LauncherItem[]) : null;
    cached =
      Array.isArray(parsed) && parsed.length > 0
        ? parsed.map(cloneItem)
        : defaultLayout();
  } catch {
    cached = defaultLayout();
  }
  return cached;
}

function normalize(items: LauncherItem[]): LauncherItem[] {
  // Sort dock items by order; keep free items as-is.
  const dock = items
    .filter((i) => i.place === "dock")
    .sort((a, b) => a.order - b.order)
    .map((i, idx) => ({ ...i, order: idx }));
  const free = items.filter((i) => i.place === "free");
  return [...dock, ...free];
}

export function getLauncherLayout(): LauncherItem[] {
  return read();
}

export function subscribeLauncherLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Persist + notify. Normalizes dock order before saving. */
export function saveLauncherLayout(items: LauncherItem[]): LauncherItem[] {
  const next = normalize(items.map(cloneItem));
  cached = next;
  try {
    storage().setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — layout stays for this session only */
  }
  listeners.forEach((l) => l());
  return next;
}

/** Back to the factory defaults (Settings › چیدمان). */
export function resetLauncherLayout(): LauncherItem[] {
  return saveLauncherLayout(defaultLayout());
}

/* ------------------------- pure drag-geometry helpers --------------------- */

/**
 * Floating buttons may be dropped ANYWHERE on the screen — corners and all.
 * The only rule: the button must stay fully visible (and therefore
 * grabbable). The old fixed fractions (7%–90% × 14%–78%) fenced off big
 * bands of the screen, which is exactly why drags felt "limited".
 *
 * .launcher-fab is 3.4rem ≈ 54px (+ focus ring) — we clamp the button CENTER
 * to keep the whole circle on-screen with a small breathing margin.
 */
const FAB_SIZE_PX = 56;
const EDGE_PX = 6;

/** Clamp a free position (fractions of the viewport, button-center) so the
 *  whole button stays on screen — any corner reachable. */
export function clampFree(
  fx: number,
  fy: number,
  vw = 390,
  vh = 844,
): { fx: number; fy: number } {
  const half = FAB_SIZE_PX / 2 + EDGE_PX;
  const padX = Math.min(0.45, half / Math.max(1, vw));
  const padY = Math.min(0.45, half / Math.max(1, vh));
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  return {
    fx: clamp(fx, padX, 1 - padX),
    fy: clamp(fy, padY, 1 - padY),
  };
}

/** Index of the dock slot whose center is nearest to x. -1 when no centers. */
export function nearestSlotIndex(centers: number[], x: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i] - x);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Build the PREVIEW layout for a pointer position during a drag:
 *  - pointer over the dock → the item is inserted at `dockIndex`
 *  - pointer elsewhere     → the item becomes a floating button at the
 *    pointer position (clamped) — "when it comes out, it turns round".
 */
export function previewDrop(
  items: LauncherItem[],
  dragId: string,
  opts: { overDock: boolean; dockIndex: number; px: number; py: number; vw: number; vh: number },
): LauncherItem[] {
  const { overDock, dockIndex, px, py, vw, vh } = opts;
  const dragged = items.find((i) => i.id === dragId);
  if (!dragged) return items.map(cloneItem);

  const base = items
    .filter((i) => i.place === "dock" && i.id !== dragId)
    .sort((a, b) => a.order - b.order);

  const dockItems: LauncherItem[] = [];
  const freeItems: LauncherItem[] = [];

  if (overDock) {
    const idx = Math.max(0, Math.min(dockIndex, base.length));
    base.splice(idx, 0, { ...dragged, place: "dock" });
  } else {
    const c = clampFree(px / Math.max(1, vw), py / Math.max(1, vh), vw, vh);
    freeItems.push({ ...dragged, place: "free", fx: c.fx, fy: c.fy });
  }

  for (const i of items) {
    if (i.place !== "free" || i.id === dragId) continue;
    freeItems.push(i);
  }

  dockItems.push(...base.map((i, idx) => ({ ...i, place: "dock" as const, order: idx })));
  return [...dockItems, ...freeItems];
}

/** Commit a finished drag + tell the robot what kind of personalization happened. */
export function commitDrag(
  items: LauncherItem[],
  dragId: string,
  fromPlace: LauncherPlace,
  landedDock: boolean,
  label?: string,
): LauncherItem[] {
  const dragged = items.find((i) => i.id === dragId);
  const saved = saveLauncherLayout(items);
  if (dragged) {
    const what: "pin_out" | "pin_in" | "move" =
      fromPlace === "dock" && !landedDock
        ? "pin_out"
        : fromPlace === "free" && landedDock
          ? "pin_in"
          : "move";
    robotBus.emit({ type: "app:layout_change", what, label: label ?? dragged.label });
  }
  return saved;
}
