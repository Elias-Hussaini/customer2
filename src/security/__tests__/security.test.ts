/**
 * Hidden security layer — cache kill-switch, anomaly click trap, lock screen
 * unlock rules, persistence-across-reload guarantees and corrupt-state
 * self-healing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---- in-memory WebStorage shims (BEFORE the store loads) ---------------- */

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const localStorageShim = new MemStorage();
const sessionStorageShim = new MemStorage();
vi.stubGlobal("localStorage", localStorageShim);
vi.stubGlobal("sessionStorage", sessionStorageShim);

// The store reads localStorage at module load — import only AFTER the shims.
const S = await import("../securityStore");

const {
  ANOMALY_MAX_CLICKS,
  ANOMALY_MIN_CLICKS,
  ANOMALY_GRACE_MS,
  SECURITY_STORAGE_KEY,
  armAnomaly,
  disarmAnomaly,
  getSecuritySnapshot,
  grantConsoleAccess,
  hasConsoleAccess,
  randomAnomalyThreshold,
  registerAnomalyClick,
  reloadSecurityState,
  resetSecurityState,
  setCacheOff,
  tryUnlock,
} = S;

/** Correct password (the only literal — used to verify the hash accepts it). */
const REAL_PASSWORD = "Mazari1234$$$";

beforeEach(() => {
  localStorageShim.clear();
  sessionStorageShim.clear();
  vi.useRealTimers();
  resetSecurityState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("security: default state", () => {
  it("starts fully neutral (cache on, no trap, unlocked)", () => {
    const s = getSecuritySnapshot();
    expect(s.cacheOff).toBe(false);
    expect(s.anomaly).toBeNull();
    expect(s.locked).toBe(false);
  });

  it("random threshold always lands inside 15..20", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const t = randomAnomalyThreshold();
      expect(t).toBeGreaterThanOrEqual(ANOMALY_MIN_CLICKS);
      expect(t).toBeLessThanOrEqual(ANOMALY_MAX_CLICKS);
      seen.add(t);
    }
    // all six values occur — the window is honest, not always-15.
    expect(seen.size).toBe(ANOMALY_MAX_CLICKS - ANOMALY_MIN_CLICKS + 1);
  });
});

describe("security: console grant", () => {
  it("grant is session-only and dies when the trap arms", () => {
    expect(hasConsoleAccess()).toBe(false);
    grantConsoleAccess();
    expect(hasConsoleAccess()).toBe(true);
    armAnomaly();
    expect(hasConsoleAccess()).toBe(false);
  });
});

describe("security: cache kill-switch", () => {
  it("persists to localStorage and survives a state reload", () => {
    setCacheOff(true);
    expect(getSecuritySnapshot().cacheOff).toBe(true);
    expect(
      JSON.parse(localStorageShim.getItem(SECURITY_STORAGE_KEY) ?? "{}").cacheOff,
    ).toBe(true);
    reloadSecurityState();
    expect(getSecuritySnapshot().cacheOff).toBe(true);
    setCacheOff(false);
    expect(getSecuritySnapshot().cacheOff).toBe(false);
  });
});

describe("security: anomaly trap", () => {
  it("arming force-disables the cache and remembers the previous state", () => {
    armAnomaly();
    const s = getSecuritySnapshot();
    expect(s.anomaly).not.toBeNull();
    expect(s.anomaly!.threshold).toBeGreaterThanOrEqual(ANOMALY_MIN_CLICKS);
    expect(s.anomaly!.threshold).toBeLessThanOrEqual(ANOMALY_MAX_CLICKS);
    expect(s.anomaly!.clicks).toBe(0);
    expect(s.cacheOff).toBe(true); // «در این حالت کش هم اتوماتیک غیرفعال بشه»
    expect(s.cacheBeforeAnomaly).toBe(false);
    expect(s.locked).toBe(false);
  });

  it("captures a manual cache-off and does not double-false it", () => {
    setCacheOff(true); // user had already disabled the cache
    armAnomaly();
    expect(getSecuritySnapshot().cacheBeforeAnomaly).toBe(true);
  });

  it("grace period: clicks right after arming do not count", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    armAnomaly();
    for (let i = 0; i < 30; i++) {
      expect(registerAnomalyClick()).toBe(false);
    }
    expect(getSecuritySnapshot().anomaly!.clicks).toBe(0);
    // after the grace window counting starts
    vi.setSystemTime(1_000_000 + ANOMALY_GRACE_MS + 10);
    expect(registerAnomalyClick()).toBe(false);
    expect(getSecuritySnapshot().anomaly!.clicks).toBe(1);
  });

  it("locks exactly on the random threshold", () => {
    vi.useFakeTimers();
    armAnomaly();
    const threshold = getSecuritySnapshot().anomaly!.threshold;
    vi.setSystemTime(Date.now() + ANOMALY_GRACE_MS + 10);
    let tripped = false;
    for (let i = 0; i < threshold; i++) {
      tripped = registerAnomalyClick();
    }
    expect(tripped).toBe(true);
    const s = getSecuritySnapshot();
    expect(s.locked).toBe(true);
    expect(s.anomaly!.clicks).toBe(threshold);
    expect(s.cacheOff).toBe(true);
    // extra clicks after the lock are ignored
    expect(registerAnomalyClick()).toBe(false);
    expect(getSecuritySnapshot().anomaly!.clicks).toBe(threshold);
  });

  it("trap + lock survive a page reload (no escape by refreshing)", async () => {
    vi.useFakeTimers();
    armAnomaly();
    const threshold = getSecuritySnapshot().anomaly!.threshold;
    vi.setSystemTime(Date.now() + ANOMALY_GRACE_MS + 10);
    for (let i = 0; i < threshold - 1; i++) registerAnomalyClick();
    // "reload": fresh module instance reads the same localStorage
    vi.resetModules();
    const fresh = await import("../securityStore");
    expect(fresh.getSecuritySnapshot().locked).toBe(false);
    expect(fresh.getSecuritySnapshot().anomaly!.clicks).toBe(threshold - 1);
    expect(fresh.getSecuritySnapshot().cacheOff).toBe(true);
    // the last counted click (even in the NEW page) trips the lock
    expect(fresh.registerAnomalyClick()).toBe(true);
    expect(fresh.getSecuritySnapshot().locked).toBe(true);
  });
});

describe("security: unlock rules", () => {
  function armAndLock(): void {
    vi.useFakeTimers();
    armAnomaly();
    const threshold = getSecuritySnapshot().anomaly!.threshold;
    vi.setSystemTime(Date.now() + ANOMALY_GRACE_MS + 10);
    for (let i = 0; i < threshold; i++) registerAnomalyClick();
    expect(getSecuritySnapshot().locked).toBe(true);
  }

  it("wrong passwords are counted and reported", async () => {
    armAndLock();
    await expect(tryUnlock("0000")).resolves.toBe("wrong");
    expect(getSecuritySnapshot().failedAttempts).toBe(1);
    expect(getSecuritySnapshot().locked).toBe(true);
  });

  it("the real password unlocks, disarms and restores the cache", async () => {
    armAndLock();
    await expect(tryUnlock(REAL_PASSWORD)).resolves.toBe("ok");
    const s = getSecuritySnapshot();
    expect(s.locked).toBe(false);
    expect(s.anomaly).toBeNull();
    expect(s.cacheOff).toBe(false); // pre-trap state restored
    expect(s.cacheBeforeAnomaly).toBeNull();
  });

  it("keeps the cache off if it was manually off before arming", async () => {
    setCacheOff(true);
    armAndLock();
    await expect(tryUnlock(REAL_PASSWORD)).resolves.toBe("ok");
    expect(getSecuritySnapshot().cacheOff).toBe(true);
  });

  it("5 wrong passwords trigger a cooldown that blocks even the right one", async () => {
    armAndLock();
    for (let i = 0; i < 5; i++) {
      await expect(tryUnlock("nope")).resolves.toBe("wrong");
    }
    expect(getSecuritySnapshot().cooldownUntil).toBeGreaterThan(Date.now());
    await expect(tryUnlock(REAL_PASSWORD)).resolves.toBe("cooldown");
    expect(getSecuritySnapshot().locked).toBe(true);
    // after the cooldown the real password works again
    vi.setSystemTime(Date.now() + 31_000);
    await expect(tryUnlock(REAL_PASSWORD)).resolves.toBe("ok");
  });
});

describe("security: corrupt / hostile storage self-heals", () => {
  it("garbage JSON falls back to defaults", () => {
    localStorageShim.setItem(SECURITY_STORAGE_KEY, "{not json");
    reloadSecurityState();
    const s = getSecuritySnapshot();
    expect(s.cacheOff).toBe(false);
    expect(s.locked).toBe(false);
    expect(s.anomaly).toBeNull();
  });

  it("locked-without-anomaly is meaningless and self-heals to unlocked", () => {
    localStorageShim.setItem(
      SECURITY_STORAGE_KEY,
      JSON.stringify({ cacheOff: false, locked: true, anomaly: null }),
    );
    reloadSecurityState();
    expect(getSecuritySnapshot().locked).toBe(false);
  });

  it("anomaly with a nonsense threshold is discarded", () => {
    localStorageShim.setItem(
      SECURITY_STORAGE_KEY,
      JSON.stringify({
        cacheOff: true,
        anomaly: { clicks: "many", threshold: null, armedAt: 1 },
      }),
    );
    reloadSecurityState();
    expect(getSecuritySnapshot().anomaly).toBeNull();
    expect(getSecuritySnapshot().cacheOff).toBe(true); // cache flag survives
  });
});

describe("security: disarm from the console", () => {
  it("ends the trap and restores the pre-trap cache state", () => {
    armAnomaly();
    disarmAnomaly();
    const s = getSecuritySnapshot();
    expect(s.anomaly).toBeNull();
    expect(s.locked).toBe(false);
    expect(s.cacheOff).toBe(false);
  });
});
