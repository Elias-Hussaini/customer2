import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { robotBus } from "../lib/robot/eventBus";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** What the user just did — drives the companion robot's reaction. */
export type ToastCause = "save" | "delete" | "export" | "import" | "report";

interface ToastOptions {
  duration?: number;
  action?: ToastAction;
  /** Optional cause hint: makes the robot react to the REAL action. */
  cause?: ToastCause;
}

interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  duration: number;
  action?: ToastAction;
  closing?: boolean;
}

/** Robot bridge: success/error toasts with a known cause drive the robot. */
function robotToastEvent(kind: ToastItem["kind"], cause?: ToastCause): Parameters<typeof robotBus.emit>[0] | null {
  if (!cause) return null;
  if (kind === "success") {
    switch (cause) {
      case "save":
      case "delete":
        return { type: "app:save_success" };
      case "export":
        return { type: "app:export_done" };
      case "import":
        return { type: "app:import_done" };
      case "report":
        return { type: "app:report_generated" };
    }
  }
  if (kind === "error") {
    switch (cause) {
      case "save":
      case "delete":
        return { type: "app:save_error" };
      case "export":
        return { type: "app:export_error" };
      case "import":
        return { type: "app:import_error" };
    }
  }
  return null;
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  /** Persistent toast with an action button (used by the PWA update prompt). */
  sticky: (message: string, action: ToastAction) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    const timer = setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 200);
    timers.current.set(id, timer);
  }, []);

  const push = useCallback(
    (kind: ToastItem["kind"], message: string, options?: ToastOptions) => {
      const id = nextId++;
      setToasts((list) => [
        ...list.slice(-3),
        { id, kind, message, duration: options?.duration ?? 3600, action: options?.action },
      ]);
      if (options?.duration !== 0) {
        const timer = setTimeout(() => dismiss(id), options?.duration ?? 3600);
        timers.current.set(id, timer);
      }
      // Companion robot reacts to what the user just did (in the moment).
      const robotEvent = robotToastEvent(kind, options?.cause);
      if (robotEvent) robotBus.emit(robotEvent);
    },
    [dismiss],
  );

  const sticky = useCallback(
    (message: string, action: ToastAction) => push("info", message, { duration: 0, action }),
    [push],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value: ToastContextValue = {
    success: (m, o) => push("success", m, o),
    error: (m, o) => push("error", m, o),
    info: (m, o) => push("info", m, o),
    sticky,
    dismiss,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)" }}
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-toast glass-strong pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 ${
              t.closing ? "opacity-0 transition-opacity duration-200" : ""
            }`}
          >
            <span
              className={
                t.kind === "success"
                  ? "text-[#10b981]"
                  : t.kind === "error"
                    ? "text-[#ef4444]"
                    : "text-brand-500"
              }
            >
              {t.kind === "success" ? (
                <CheckCircle2 size={20} />
              ) : t.kind === "error" ? (
                <XCircle size={20} />
              ) : (
                <Info size={20} />
              )}
            </span>
            <p className="flex-1 text-[13px] leading-6">{t.message}</p>
            {t.action && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="icon-btn !h-7 !w-7"
              onClick={() => dismiss(t.id)}
              aria-label="بستن"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
