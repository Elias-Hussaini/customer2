/**
 * ابزار عکس — jump-search history.
 *
 * The user asked: «حداقل ۵ تا سابقه رو نگه دار و با بک‌اسپیس بری گزینهٔ قبلی —
 * دیگه لازم نباشه هی از اول وارد پروفایل‌ها بشم». So every jump (customer /
 * employer) is remembered (at least 5, capped at 8, newest first, deduped),
 * shown under the search box whenever it's focused, and Backspace on the empty
 * input recalls the previous query so the results come back instantly.
 */

const KEY = "studio.jump.history.v1";
const MAX_ENTRIES = 8;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** In-memory shim so history also works in node (tests) without a DOM. */
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

export type JumpKind = "customer" | "employer";

export interface JumpHistoryEntry {
  id: string;
  type: JumpKind;
  title: string;
  subtitle: string;
  /** The query text that led to this jump (for Backspace recall). */
  query: string;
  /** Epoch ms — newest first ordering. */
  at: number;
}

/** Parse + sanitize the stored JSON (corrupted rows are dropped silently). */
function parse(raw: string | null): JumpHistoryEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: JumpHistoryEntry[] = [];
    for (const e of arr) {
      if (
        e &&
        typeof e.id === "string" &&
        (e.type === "customer" || e.type === "employer") &&
        typeof e.title === "string"
      ) {
        out.push({
          id: e.id,
          type: e.type,
          title: e.title,
          subtitle: typeof e.subtitle === "string" ? e.subtitle : "",
          query: typeof e.query === "string" ? e.query : "",
          at: typeof e.at === "number" ? e.at : 0,
        });
      }
      if (out.length >= MAX_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Read the recent jumps, newest first (≤ 8). */
export function getJumpHistory(): JumpHistoryEntry[] {
  try {
    return parse(storage().getItem(KEY));
  } catch {
    return [];
  }
}

/** Record a jump: deduped (same entity moves to the top), capped at 8. */
export function pushJumpHistory(
  entry: Omit<JumpHistoryEntry, "at">,
): JumpHistoryEntry[] {
  const next: JumpHistoryEntry[] = [
    { ...entry, at: Date.now() },
    ...getJumpHistory().filter((e) => !(e.type === entry.type && e.id === entry.id)),
  ].slice(0, MAX_ENTRIES);
  try {
    storage().setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota → history stays in-memory only this call */
  }
  return next;
}

/** Distinct recent queries, newest first — drives the Backspace recall. */
export function recentQueries(entries: JumpHistoryEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const q = e.query.trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

/** Test hook. */
export function __resetJumpHistoryForTests(): void {
  try {
    storage().removeItem(KEY);
  } catch {
    /* ignore */
  }
}
