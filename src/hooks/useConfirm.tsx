import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  >(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, resolve });
    });
  };

  const settle = (value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="no-print fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div
            className="anim-fade absolute inset-0 bg-[#0d0f1a]/45 backdrop-blur-[3px]"
            onClick={() => settle(false)}
          />
          <div
            className="glass-strong anim-pop relative w-full max-w-sm rounded-3xl p-6"
            role="alertdialog"
            aria-modal="true"
            aria-label={state.title}
          >
            <div
              className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${
                state.danger
                  ? "bg-[#ef4444]/12 text-[#ef4444]"
                  : "bg-brand-500/12 text-brand-600 dark:text-brand-300"
              }`}
            >
              {state.danger ? <Trash2 size={22} /> : <AlertTriangle size={22} />}
            </div>
            <h3 className="text-base font-bold">{state.title}</h3>
            {state.message && (
              <div className="mt-2 text-[13px] leading-6 text-ink-600 dark:text-ink-300">
                {state.message}
              </div>
            )}
            <div className="mt-5 flex gap-2">
              <button className="btn btn-glass flex-1" onClick={() => settle(false)} autoFocus>
                {state.cancelLabel ?? "انصراف"}
              </button>
              <button
                className={`btn flex-1 ${state.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => settle(true)}
              >
                {state.confirmLabel ?? "تأیید"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
