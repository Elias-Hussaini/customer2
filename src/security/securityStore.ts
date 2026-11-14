import { useSyncExternalStore } from "react";

/**
 * Hidden security layer — «صفحه امنیتی مخفی».
 *
 * Two features requested by the owner (round 25):
 *  1. کش (cache) kill-switch: the hidden console can turn the PWA
 *     service-worker cache OFF — the app then works only with internet.
 *  2. «حالت ناهنجاری» (anomaly trap): once armed, the console closes, the
 *     app looks perfectly normal, but after a RANDOM 15–20 clicks the screen
 *     locks itself ("algorithm detected the documents at risk") and demands
 *     the owner password. Cache is forced OFF for the whole trap.
 *
 * Everything persists in localStorage so a reload can NEVER escape the trap:
 * the click count survives reloads and a locked screen stays locked.
 */

/** SHA-256("Mazari1234$$$") — the literal password never ships in the bundle. */
const LOCK_PASSWORD_SHA256 =
  "7579b995a59cde5f2b51a0b9a027d28422a4ef9432117864f03cd39cb78190b0";

/** localStorage key — one versioned JSON blob. */
export const SECURITY_STORAGE_KEY = "customer2.security";

/** sessionStorage grant for the hidden console (set only by the secret combo). */
export const CONSOLE_GRANT_KEY = "customer2.sec.grant";

/** Hidden route — outside the app shell, absent from every menu. */
export const SECURITY_ROUTE = "/sec-console";

/** Secret sequence typed while Ctrl+Alt+Shift are held together. */
export const SECRET_SEQUENCE = "09029327968";

/** Trap window: lock fires after 15–20 clicks (random, inclusive). */
export const ANOMALY_MIN_CLICKS = 15;
export const ANOMALY_MAX_CLICKS = 20;

/**
 * Grace period after arming: clicks here don't count — gives the owner a
 * moment to close the console / hand the device over before counting starts.
 */
export const ANOMALY_GRACE_MS = 5_000;

/** 5 wrong passwords → 30 s cooldown before trying again. */
const FAILS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

export interface AnomalyState {
  /** Clicks counted since arming (persists across reloads). */
  clicks: number;
  /** Random threshold in [ANOMALY_MIN_CLICKS, ANOMALY_MAX_CLICKS]. */
  threshold: number;
  armedAt: number;
}

export interface SecurityState {
  /** true → no service worker, no CacheStorage; internet-only. */
  cacheOff: boolean;
  /** Cache state before the trap was armed (restored on disarm/unlock). */
  cacheBeforeAnomaly: boolean | null;
  anomaly: AnomalyState | null;
  locked: boolean;
  lockedAt: number;
  failedAttempts: number;
  cooldownUntil: number;
}

const DEFAULT_STATE: SecurityState = {
  cacheOff: false,
  cacheBeforeAnomaly: null,
  anomaly: null,
  locked: false,
  lockedAt: 0,
  failedAttempts: 0,
  cooldownUntil: 0,
};

function readStorage(): SecurityState {
  try {
    const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<SecurityState>;
    const merged = { ...DEFAULT_STATE, ...parsed };
    // shape guards — corrupt values can never brick the app
    if (typeof merged.cacheOff !== "boolean") merged.cacheOff = false;
    if (
      !merged.anomaly ||
      typeof merged.anomaly.threshold !== "number" ||
      typeof merged.anomaly.clicks !== "number"
    ) {
      merged.anomaly = null;
    }
    if (typeof merged.locked !== "boolean") merged.locked = false;
    if (typeof merged.failedAttempts !== "number") merged.failedAttempts = 0;
    if (typeof merged.cooldownUntil !== "number") merged.cooldownUntil = 0;
    // a lock without an armed trap is meaningless — self-heal to unlocked
    if (merged.locked && !merged.anomaly) merged.locked = false;
    return merged;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

let state: SecurityState = readStorage();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / storage full — in-memory only */
  }
}

function set(patch: Partial<SecurityState>): void {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive hook (same pattern as uiStore). */
export function useSecurityState<T>(selector: (s: SecurityState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** Current snapshot for non-React code (PWA registration, click trap). */
export function getSecuritySnapshot(): SecurityState {
  return state;
}

/** Re-read localStorage (another tab changed it) and notify subscribers. */
export function reloadSecurityState(): void {
  state = readStorage();
  listeners.forEach((l) => l());
}

/* ------------------------------ console grant ----------------------------- */

export function grantConsoleAccess(): void {
  try {
    sessionStorage.setItem(CONSOLE_GRANT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasConsoleAccess(): boolean {
  try {
    return sessionStorage.getItem(CONSOLE_GRANT_KEY) === "1";
  } catch {
    return false;
  }
}

function revokeConsoleAccess(): void {
  try {
    sessionStorage.removeItem(CONSOLE_GRANT_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ cache switch ------------------------------ */

export function setCacheOff(off: boolean): void {
  set({ cacheOff: off });
}

/* ------------------------------ anomaly trap ------------------------------ */

/** Random lock threshold — uniform 15..20 (inclusive). */
export function randomAnomalyThreshold(): number {
  return (
    ANOMALY_MIN_CLICKS +
    Math.floor(Math.random() * (ANOMALY_MAX_CLICKS - ANOMALY_MIN_CLICKS + 1))
  );
}

/**
 * Arm the trap: console closes right after, everything looks normal, cache is
 * force-disabled until the trap ends.
 */
export function armAnomaly(): void {
  if (state.anomaly || state.locked) return;
  set({
    cacheBeforeAnomaly: state.cacheOff,
    cacheOff: true, // «در این حالت کش هم اتوماتیک غیرفعال بشه»
    anomaly: { clicks: 0, threshold: randomAnomalyThreshold(), armedAt: Date.now() },
    locked: false,
    lockedAt: 0,
    failedAttempts: 0,
    cooldownUntil: 0,
  });
  // The grant dies with arming: from now on the hidden console is reachable
  // ONLY through the secret key combo again (URL knowledge alone is useless).
  revokeConsoleAccess();
}

/** End the trap (owner action from the console) and restore the cache state. */
export function disarmAnomaly(): void {
  set({
    anomaly: null,
    locked: false,
    lockedAt: 0,
    failedAttempts: 0,
    cooldownUntil: 0,
    cacheOff: state.cacheBeforeAnomaly ?? false,
    cacheBeforeAnomaly: null,
  });
}

/** Trap armed and counting (false once the screen has locked). */
export function isAnomalyArmed(): boolean {
  return !!state.anomaly && !state.locked;
}

/**
 * Count one user click while the trap is armed. Returns true when THIS click
 * tripped the lock — the caller then re-asserts the offline-only cache state.
 */
export function registerAnomalyClick(): boolean {
  if (!state.anomaly || state.locked) return false;
  // Grace window right after arming — the owner's own clicks don't count.
  if (Date.now() - state.anomaly.armedAt < ANOMALY_GRACE_MS) return false;
  const clicks = state.anomaly.clicks + 1;
  if (clicks >= state.anomaly.threshold) {
    set({
      anomaly: { ...state.anomaly, clicks },
      locked: true,
      lockedAt: Date.now(),
      cacheOff: true, // belt & suspenders: lock ⇒ never a working offline cache
    });
    return true;
  }
  set({ anomaly: { ...state.anomaly, clicks } });
  return false;
}

/* --------------------------------- unlock --------------------------------- */

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type UnlockResult = "ok" | "wrong" | "cooldown";

/**
 * Try the lock password. Correct password ends the trap COMPLETELY (unlock +
 * disarm + cache restored to its pre-trap state). Fail-closed when WebCrypto
 * is unavailable (non-secure context) — a lock must never open on error.
 */
export async function tryUnlock(password: string): Promise<UnlockResult> {
  if (state.cooldownUntil > Date.now()) return "cooldown";
  let hash = "";
  try {
    hash = await sha256Hex(password);
  } catch {
    return "wrong";
  }
  if (hash !== LOCK_PASSWORD_SHA256) {
    const failedAttempts = state.failedAttempts + 1;
    const cooldownUntil =
      failedAttempts % FAILS_BEFORE_COOLDOWN === 0
        ? Date.now() + COOLDOWN_MS
        : state.cooldownUntil;
    set({ failedAttempts, cooldownUntil });
    return "wrong";
  }
  disarmAnomaly();
  return "ok";
}

/** Reset everything to defaults — test helper / emergency reset. */
export function resetSecurityState(): void {
  state = { ...DEFAULT_STATE };
  persist();
  listeners.forEach((l) => l());
}
