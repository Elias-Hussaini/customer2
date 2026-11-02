import type { OutputFormat } from "./canvas";

/**
 * ابزار عکس — remembered preferences (device-level, localStorage).
 *
 * The user asked: «آخرین انتخاب‌ها رو یادش بمونه تا لازم نباشه هی از اول همهٔ
 * تنظیمات رو انجام بدم» — so the editor's output settings (format / quality /
 * max edge) plus the last library folder survive restarts. Default format is
 * JPEG («پیشفرض jpg، نه webp») the first time around.
 *
 * Deliberately NOT part of the IndexedDB domain: these are per-device choices,
 * exactly like the launcher layout (see lib/launcher/layoutStore.ts).
 */

const KEY = "studio.prefs.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** In-memory shim so prefs also work in node (tests) without a DOM. */
const memory = new Map<string, string>();
const memoryShim: StorageLike = {
  getItem: (k) => (memory.has(k) ? (memory.get(k) as string) : null),
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

function storage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode — fall through to the shim */
  }
  return memoryShim;
}

export interface StudioPrefs {
  /** Output image format for saves & downloads. */
  format: OutputFormat;
  /** JPEG/WebP quality 0.3..1. */
  quality: number;
  /** Long-edge cap in px (0 = unchanged). */
  maxEdge: number;
  /** Last folder used by «ذخیره در کتابخانه» (null = سایر). */
  lastFolderId: string | null;
}

export const DEFAULT_STUDIO_PREFS: StudioPrefs = {
  format: "image/jpeg",
  quality: 0.86,
  maxEdge: 0,
  lastFolderId: null,
};

const VALID_FORMATS: OutputFormat[] = ["image/jpeg", "image/webp", "image/png"];
const VALID_EDGES = new Set([0, 2000, 1600, 1200, 800, 600]);

/** Load the saved prefs, sanitized field-by-field onto the defaults. */
export function loadStudioPrefs(): StudioPrefs {
  const out: StudioPrefs = { ...DEFAULT_STUDIO_PREFS };
  const s = storage();
  try {
    const raw = s.getItem(KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<StudioPrefs>;
    if (typeof parsed.format === "string" && (VALID_FORMATS as string[]).includes(parsed.format)) {
      out.format = parsed.format;
    }
    if (typeof parsed.quality === "number" && Number.isFinite(parsed.quality)) {
      out.quality = Math.min(1, Math.max(0.3, parsed.quality));
    }
    if (typeof parsed.maxEdge === "number" && VALID_EDGES.has(parsed.maxEdge)) {
      out.maxEdge = parsed.maxEdge;
    }
    if (parsed.lastFolderId === null || typeof parsed.lastFolderId === "string") {
      out.lastFolderId = parsed.lastFolderId;
    }
  } catch {
    /* corrupted → defaults */
  }
  return out;
}

/** Merge-persist the given fields (only valid values are written). */
export function saveStudioPrefs(patch: Partial<StudioPrefs>): void {
  const s = storage();
  try {
    const next = { ...loadStudioPrefs(), ...sanitized(patch) };
    s.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode → non-fatal */
  }
}

function sanitized(patch: Partial<StudioPrefs>): Partial<StudioPrefs> {
  const out: Partial<StudioPrefs> = {};
  if (typeof patch.format === "string" && (VALID_FORMATS as string[]).includes(patch.format)) {
    out.format = patch.format;
  }
  if (typeof patch.quality === "number" && Number.isFinite(patch.quality)) {
    out.quality = Math.min(1, Math.max(0.3, patch.quality));
  }
  if (typeof patch.maxEdge === "number" && VALID_EDGES.has(patch.maxEdge)) {
    out.maxEdge = patch.maxEdge;
  }
  if (patch.lastFolderId === null || typeof patch.lastFolderId === "string") {
    out.lastFolderId = patch.lastFolderId;
  }
  return out;
}

/** Test hook: wipe the stored prefs. */
export function __resetStudioPrefsForTests(): void {
  try {
    storage().removeItem(KEY);
  } catch {
    /* ignore */
  }
}
