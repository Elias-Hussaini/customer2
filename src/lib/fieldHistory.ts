/**
 * Per-field typed-value history — the recall behind EVERY search field.
 *
 * The user asked: «اون فلش فقط توی بخش لیست‌ها اومده؛ میخواهم بک‌اسپیس یا اون
 * فلش هر وقت وارد فیلدی میشی بیاد و برگرده عقب» — so the recall that lived
 * only in the studio jump search now exists in every search box: focus a
 * field → the small arrow appears (when that field has history) → each tap
 * steps back through what was typed there before; Backspace on the empty
 * field does exactly the same.
 *
 * Each field keeps its own chain (keyed by an explicit id or the placeholder),
 * newest first, deduped, capped at 8 — exactly like the jump history.
 * Device-level localStorage on purpose: this is a per-device convenience.
 */

const KEY = "app.field.history.v1";
const MAX_PER_FIELD = 8;
const MAX_FIELDS = 16;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** In-memory shim so the history also works in node (tests) without a DOM. */
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

interface FieldEntry {
  v: string[];
  at: number;
}

type Store = Record<string, FieldEntry>;

/** Parse + sanitize the stored JSON (corrupted entries are dropped silently). */
function loadStore(): Store {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [k, entry] of Object.entries(parsed)) {
      if (
        typeof k === "string" &&
        k &&
        entry &&
        Array.isArray(entry.v) &&
        entry.v.every((x) => typeof x === "string")
      ) {
        out[k] = {
          v: entry.v.filter((x) => x.trim() !== "").slice(0, MAX_PER_FIELD),
          at: typeof entry.at === "number" ? entry.at : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  try {
    storage().setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode → non-fatal */
  }
}

/** The remembered values for one field, newest first (≤ 8). */
export function getFieldHistory(fieldKey: string): string[] {
  const entry = loadStore()[fieldKey];
  return entry ? entry.v.slice() : [];
}

/** Record a typed value: trimmed, non-empty, deduped to the top, capped at 8.
 *  Returns the new chain. The field's `at` stamp refreshes so the store can
 *  prune the least-recently-USED fields beyond MAX_FIELDS. */
export function pushFieldHistory(fieldKey: string, value: string): string[] {
  const clean = value.trim();
  const store = loadStore();
  if (!clean) return store[fieldKey]?.v.slice() ?? [];
  const prev = store[fieldKey]?.v ?? [];
  const next = [clean, ...prev.filter((x) => x !== clean)].slice(0, MAX_PER_FIELD);
  store[fieldKey] = { v: next, at: Date.now() };
  const keys = Object.keys(store);
  if (keys.length > MAX_FIELDS) {
    keys.sort((a, b) => (store[a].at ?? 0) - (store[b].at ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_FIELDS)) delete store[k];
  }
  saveStore(store);
  return next;
}

/** Test hook: wipe the whole store. */
export function __resetFieldHistoryForTests(): void {
  try {
    storage().removeItem(KEY);
  } catch {
    /* ignore */
  }
}
