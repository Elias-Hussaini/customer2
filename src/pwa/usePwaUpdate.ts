import { useEffect, useRef } from "react";
import { useToast } from "../hooks/useToast";

type ToastApi = ReturnType<typeof useToast>;

/** Manual check outcome for the Settings → PWA «بررسی به‌روزرسانی» button. */
export type PwaUpdateCheck = "updated" | "latest" | "unsupported";

/**
 * Module-level state so the React effect (and StrictMode double-invocation)
 * can't double-register the service worker or double-arm watchers.
 */
let registrationRef: ServiceWorkerRegistration | null = null;
let updateFnRef: ((reload?: boolean) => Promise<void>) | null = null;
let watchersArmed = false;
let lastPromptAt = 0;

/** Set by the hook; lets checkForPwaUpdate() re-surface the sticky toast. */
let showUpdatePrompt: (() => void) | null = null;

/** Re-check for a new deploy every 5 minutes while the app stays open. */
const UPDATE_POLL_MS = 5 * 60_000;

function armUpdateWatchers(): void {
  if (watchersArmed || !registrationRef) return;
  watchersArmed = true;
  window.setInterval(() => {
    void registrationRef?.update().catch(() => undefined);
  }, UPDATE_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    // Coming back to the app tab/PWA window is the most likely moment a new
    // deploy exists — check immediately instead of waiting for the interval.
    if (document.visibilityState === "visible") {
      void registrationRef?.update().catch(() => undefined);
    }
  });
}

/**
 * Wires the PWA service-worker update flow to a sticky toast.
 * With vite-plugin-pwa registerType: "prompt", the user stays in control:
 * a new deploy shows «نسخه جدید آماده است» with a به‌روزرسانی button and the
 * page reloads only when they click it.
 *
 * On top of the browser's own navigation-time check, we also poll every 5
 * minutes and whenever the tab becomes visible — so the toast appears even
 * during a long-running session.
 */
export function useRegisterPwaUpdate(): void {
  const toastRef = useRef<ToastApi | null>(null);
  const toast = useToast();
  toastRef.current = toast;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (updateFnRef) return; // already wired (StrictMode-safe singleton)

    let cancelled = false;

    // Sticky prompt with a 10s dedupe so onNeedRefresh + a manual check
    // can't stack duplicate toasts.
    showUpdatePrompt = () => {
      const now = Date.now();
      if (now - lastPromptAt < 10_000) return;
      lastPromptAt = now;
      toastRef.current?.sticky("نسخه جدیدی از برنامه آماده است — برای اعمال تغییرات، به‌روزرسانی کنید.", {
        label: "به‌روزرسانی",
        onClick: () => {
          if (updateFnRef) void updateFnRef(true);
          else window.location.reload();
        },
      });
    };

    void (async () => {
      try {
        const { registerSW } = await import("virtual:pwa-register");
        if (cancelled) return;
        updateFnRef = registerSW({
          immediate: true,
          onNeedRefresh() {
            showUpdatePrompt?.();
          },
          onOfflineReady() {
            toastRef.current?.info("برنامه برای استفاده آفلاین آماده است");
          },
          onRegisteredSW(_swUrl, registration) {
            registrationRef = registration ?? null;
            armUpdateWatchers();
          },
        });
      } catch (e) {
        // Dev mode or unsupported environment — skip silently.
        console.warn("PWA registration skipped", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * Manual «بررسی به‌روزرسانی» — forces a service-worker update check right
 * now. Returns "updated" when a new version is installed/waiting (the sticky
 * update toast is re-surfaced), "latest" when this device already runs the
 * newest deploy, "unsupported" when no service worker is available (dev).
 */
export async function checkForPwaUpdate(): Promise<PwaUpdateCheck> {
  if (!("serviceWorker" in navigator) || !registrationRef) return "unsupported";
  try {
    await registrationRef.update();
  } catch {
    // Offline or transient failure — treat as "no news".
    return "latest";
  }
  const pending = registrationRef.waiting || registrationRef.installing;
  if (pending) {
    showUpdatePrompt?.();
    return "updated";
  }
  return "latest";
}
