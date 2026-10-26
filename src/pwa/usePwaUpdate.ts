import { useEffect, useRef } from "react";
import { useToast } from "../hooks/useToast";

type ToastApi = ReturnType<typeof useToast>;

/**
 * Wires the PWA service-worker update flow to a sticky toast.
 * With vite-plugin-pwa registerType: "prompt", the user stays in control.
 */
export function useRegisterPwaUpdate(): void {
  const toastRef = useRef<ToastApi | null>(null);
  const toast = useToast();
  toastRef.current = toast;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let updateFn: ((reload?: boolean) => void) | undefined;

    void (async () => {
      try {
        const { registerSW } = await import("virtual:pwa-register");
        updateFn = registerSW({
          onNeedRefresh() {
            toastRef.current?.sticky("نسخه جدیدی از برنامه آماده است.", {
              label: "به‌روزرسانی",
              onClick: () => {
                if (updateFn) updateFn(true);
                else window.location.reload();
              },
            });
          },
          onOfflineReady() {
            toastRef.current?.info("برنامه برای استفاده آفلاین آماده است");
          },
        });
      } catch (e) {
        // Dev mode or unsupported environment — skip silently.
        console.warn("PWA registration skipped", e);
      }
    })();
  }, []);
}
