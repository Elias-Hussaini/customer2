/**
 * Remember a page's filter/selection state across visits (localStorage).
 *
 * Usage: `const [sort, setSort] = usePersistentState("customers", "sort", "newest", is_valid);`
 *
 * The loader validates every stored value with the caller's guard — corrupt or
 * stale data (e.g. a saved representative id that no longer exists) falls back
 * to the default instead of crashing or filtering everything away.
 */

export function loadPageFilter<T extends string | null>(
  page: string,
  key: string,
  fallback: T,
  isValid: (value: string) => boolean,
): T {
  try {
    const raw = localStorage.getItem(`customer2-filter-${page}`);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return fallback;
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string" && (value === "" ? fallback === "" : isValid(value))) {
      return value as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function savePageFilter(page: string, key: string, value: string | null): void {
  try {
    const raw = localStorage.getItem(`customer2-filter-${page}`);
    const parsed: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    if (value == null || value === "") delete parsed[key];
    else parsed[key] = value;
    localStorage.setItem(`customer2-filter-${page}`, JSON.stringify(parsed));
  } catch {
    // localStorage unavailable (private mode…) — persistence is best-effort.
  }
}
