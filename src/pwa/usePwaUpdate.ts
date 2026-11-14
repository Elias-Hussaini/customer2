import { useEffect, useRef } from "react";
import { useToast } from "../hooks/useToast";
import { BUILD_SHA } from "./version";
import {
  getSecuritySnapshot,
  reloadSecurityState,
  SECURITY_STORAGE_KEY,
} from "../security/securityStore";

type ToastApi = ReturnType<typeof useToast>;

/**
 * Module-level state so the React effect (and StrictMode double-invocation)
 * can't double-register the service worker or double-arm watchers.
 */
let registrationRef: ServiceWorkerRegistration | null = null;
let updateFnRef: ((reload?: boolean) => Promise<void>) | null = null;
let registerPromise: Promise<void> | null = null;
let watchersArmed = false;
let storageSyncArmed = false;
let lastPromptAt = 0;

/** Set by the hook; surfaces the sticky update toast when a new deploy lands. */
let showUpdatePrompt: (() => void) | null = null;
/** Set by the hook; announces offline-ready once. */
let notifyOfflineReady: (() => void) | null = null;

/** Re-check for a new deploy every 5 minutes while the app stays open. */
const UPDATE_POLL_MS = 5 * 60_000;
/** First probe shortly after startup — the toast should appear fast. */
const FIRST_PROBE_MS = 3_000;
/** How long checkForUpdatesNow waits for an installing worker to settle. */
const INSTALL_SETTLE_MS = 15_000;
const INSTALL_POLL_MS = 500;

/** Shape of dist/version.json (written by the versionJsonPlugin at build time). */
interface DeployedVersion {
  sha?: string;
  time?: string;
}

/** Fetch the DEPLOYED build identity. Never cached (no-store + json not precached). */
async function fetchDeployedVersion(): Promise<DeployedVersion | null> {
  try {
    const url = `${import.meta.env.BASE_URL}version.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as DeployedVersion;
    return typeof data?.sha === "string" ? data : null;
  } catch {
    return null; // offline / dev server without version.json
  }
}

type ProbeResult = "latest" | "available" | "offline";

/** Compare the deployed sha against the sha this page was compiled from. */
async function probeDeployedVersion(): Promise<ProbeResult> {
  if (BUILD_SHA === "dev") return "latest"; // dev builds never nag
  const deployed = await fetchDeployedVersion();
  if (!deployed?.sha) return "offline";
  return deployed.sha === BUILD_SHA ? "latest" : "available";
}

/**
 * Apply a waiting update: workbox-window path first (posts SKIP_WAITING and
 * reloads), manual waiting-worker path second, plain reload as a last resort.
 */
async function applyPendingUpdate(): Promise<void> {
  if (updateFnRef) {
    await updateFnRef(true);
    return;
  }
  const reg =
    registrationRef ??
    ("serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined);
  const waiting = reg?.waiting;
  if (waiting) {
    waiting.addEventListener("statechange", () => {
      if (waiting.state === "activated") window.location.reload();
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Safety net: if activation happened without the event reaching us, reload anyway.
    window.setTimeout(() => window.location.reload(), 4_000);
    return;
  }
  window.location.reload();
}

/** Wait (bounded) for an installing worker to reach the waiting state. */
async function waitForInstall(): Promise<ServiceWorkerRegistration | null> {
  const deadline = Date.now() + INSTALL_SETTLE_MS;
  while (Date.now() < deadline) {
    const reg = registrationRef;
    if (reg?.waiting) return reg;
    if (!reg?.installing) return reg ?? null;
    await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
  }
  return registrationRef;
}

/**
 * Register the service worker (deduped — safe under StrictMode and repeated
 * calls). Split out of the hook so the security kill-switch can re-register
 * later without re-mounting the app.
 */
async function registerServiceWorker(): Promise<void> {
  if (updateFnRef || !("serviceWorker" in navigator)) return;
  if (registerPromise) return registerPromise;
  registerPromise = (async () => {
    try {
      const { registerSW } = await import("virtual:pwa-register");
      updateFnRef = registerSW({
        immediate: true,
        onNeedRefresh() {
          showUpdatePrompt?.();
        },
        onOfflineReady() {
          notifyOfflineReady?.();
        },
        onRegisteredSW(_swUrl, registration) {
          registrationRef = registration ?? null;
          armUpdateWatchers();
        },
      });
    } catch (e) {
      // Dev mode or unsupported environment — skip silently (retry allowed).
      registerPromise = null;
      console.warn("PWA registration skipped", e);
    }
  })();
  return registerPromise;
}

/**
 * Cache kill-switch (hidden security console): unregister EVERY service
 * worker and wipe CacheStorage. User data lives in IndexedDB and is never
 * touched — after this the app is internet-only.
 */
export async function purgePwaCaches(): Promise<void> {
  registrationRef = null;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best effort — never block the app on this
  }
}

/**
 * Live inspection of the browser's cache state (hidden console status + QA).
 */
export async function inspectPwaState(): Promise<{
  swCount: number;
  cacheNames: string[];
  controlled: boolean;
}> {
  let swCount = 0;
  let controlled = false;
  try {
    if ("serviceWorker" in navigator) {
      swCount = (await navigator.serviceWorker.getRegistrations()).length;
      controlled = !!navigator.serviceWorker.controller;
    }
  } catch {
    /* ignore */
  }
  let cacheNames: string[] = [];
  try {
    if ("caches" in window) cacheNames = await caches.keys();
  } catch {
    /* ignore */
  }
  return { swCount, cacheNames, controlled };
}

/**
 * Bring the browser's cache state in line with the security flag:
 *  - cacheOff = true  → purge (unregister SW + wipe CacheStorage)
 *  - cacheOff = false → best-effort re-register so offline mode returns
 * Called at startup, after console toggles, after unlock, and on cross-tab
 * storage changes.
 */
export async function applySecurityCacheState(): Promise<void> {
  const { cacheOff } = getSecuritySnapshot();
  if (cacheOff) {
    await purgePwaCaches();
    return;
  }
  // Re-enabling: drop stale refs so the fresh registration takes over.
  if (updateFnRef) {
    updateFnRef = null;
    registerPromise = null;
  }
  await registerServiceWorker();
}

/**
 * Manual check — powers the «بررسی بروزرسانی» button in Settings.
 * Runs a real SW update check AND the version.json probe, then acts:
 *  - "latest"  → nothing to do
 *  - "applied" → a waiting update was applied (page reloads itself)
 *  - "pending" → new version found, still downloading (toast will arrive)
 *  - "stuck"   → deployed ≠ running but the SW can't deliver it → repair needed
 *  - "offline" → no network
 */
export type UpdateCheckResult = "latest" | "applied" | "pending" | "stuck" | "offline";

export async function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!("serviceWorker" in navigator)) {
    const probe = await probeDeployedVersion();
    if (probe === "offline") return "offline";
    return probe === "available" ? "stuck" : "latest";
  }
  try {
    const reg = registrationRef ?? (await navigator.serviceWorker.getRegistration());
    if (reg) {
      registrationRef = reg;
      await reg.update();
    }
  } catch {
    // offline or registration gone — fall through to the probe
  }
  const probe = await probeDeployedVersion();
  if (probe === "offline") return "offline";

  const reg = await waitForInstall();
  if (reg?.waiting) {
    void applyPendingUpdate();
    return "applied";
  }
  if (probe === "available") {
    // Deployed sha differs but no worker is waiting or installing.
    return reg?.installing ? "pending" : "stuck";
  }
  return "latest";
}

/**
 * Repair path for a broken/stuck service worker: unregister every SW and wipe
 * CacheStorage, then reload. 100% safe for this app — user data lives in
 * IndexedDB, caches only ever hold static build assets.
 */
export async function repairPwaAndReload(): Promise<void> {
  await purgePwaCaches();
  window.location.reload();
}

function armUpdateWatchers(): void {
  if (watchersArmed || !registrationRef) return;
  watchersArmed = true;
  // Probe once shortly after startup so the toast shows up fast on open.
  window.setTimeout(() => {
    void probeDeployedVersion().then((r) => {
      if (r === "available") showUpdatePrompt?.();
    });
  }, FIRST_PROBE_MS);
  window.setInterval(() => {
    void registrationRef?.update().catch(() => undefined);
    void probeDeployedVersion().then((r) => {
      if (r === "available") showUpdatePrompt?.();
    });
  }, UPDATE_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    // Coming back to the app tab/PWA window is the most likely moment a new
    // deploy exists — check immediately instead of waiting for the interval.
    if (document.visibilityState === "visible") {
      void registrationRef?.update().catch(() => undefined);
      void probeDeployedVersion().then((r) => {
        if (r === "available") showUpdatePrompt?.();
      });
    }
  });
}

/**
 * Cross-tab sync for the hidden security layer: another tab toggled the cache
 * kill-switch or tripped the anomaly lock → mirror it here immediately.
 */
function armSecurityStorageSync(): void {
  if (storageSyncArmed) return;
  storageSyncArmed = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== SECURITY_STORAGE_KEY) return;
    reloadSecurityState();
    void applySecurityCacheState();
  });
}

/**
 * Wires the PWA service-worker update flow to a sticky toast.
 * With vite-plugin-pwa registerType: "prompt", the user stays in control:
 * a new deploy shows «نسخه جدید آماده است» with a به‌روزرسانی button and the
 * page reloads only when they click it.
 *
 * Security kill-switch: when the hidden security console has turned the cache
 * OFF, the service worker is never registered (and any leftover worker /
 * caches are purged) — the app works only with internet until it is turned
 * back on.
 */
export function useRegisterPwaUpdate(): void {
  const toastRef = useRef<ToastApi | null>(null);
  const toast = useToast();
  toastRef.current = toast;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (updateFnRef) return; // already wired (StrictMode-safe singleton)

    showUpdatePrompt = () => {
      const now = Date.now();
      if (now - lastPromptAt < 10_000) return;
      lastPromptAt = now;
      toastRef.current?.sticky("نسخه جدیدی از برنامه آماده است — برای اعمال تغییرات، به‌روزرسانی کنید.", {
        label: "به‌روزرسانی",
        onClick: () => {
          void applyPendingUpdate();
        },
      });
    };
    notifyOfflineReady = () =>
      toastRef.current?.info("برنامه برای استفاده آفلاین آماده است");

    armSecurityStorageSync();

    // Cache kill-switch active → internet-only mode, no service worker.
    if (getSecuritySnapshot().cacheOff) {
      void purgePwaCaches();
      return;
    }

    void registerServiceWorker();
  }, []);
}
