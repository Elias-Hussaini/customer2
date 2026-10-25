import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Keeps a closing overlay mounted for its exit animation. */
function useDelayedUnmount(open: boolean, timeout = 200): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), timeout);
    return () => clearTimeout(t);
  }, [open, timeout]);
  return mounted;
}

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [active]);
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Hide the close (×) button — e.g. for forced confirmations. */
  hideClose?: boolean;
}

const SIZE_CLASS: Record<string, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

/**
 * Responsive dialog: bottom sheet on phones, centered glass card on ≥sm.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  hideClose,
}: ModalProps) {
  const mounted = useDelayedUnmount(open);
  useLockBodyScroll(mounted);
  useEscape(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        const el = panelRef.current?.querySelector<HTMLElement>(
          "input:not([type=hidden]):not([disabled]), select, textarea",
        );
        el?.focus();
      }, 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`no-print fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6 ${
        open ? "" : "pointer-events-none"
      }`}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`anim-fade absolute inset-0 bg-[#0d0f1a]/45 backdrop-blur-[3px] ${open ? "" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`glass-strong relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] sm:rounded-[26px] ${SIZE_CLASS[size]} ${
          open ? "anim-sheet sm:anim-pop" : "translate-y-full opacity-0 sm:scale-95 sm:!translate-y-0"
        } transition-all duration-200`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink-300/70 sm:hidden" />
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1 sm:pt-5">
            <div className="min-w-0">
              {title && <h2 className="truncate text-[15px] font-bold">{title}</h2>}
              {subtitle && (
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>
              )}
            </div>
            {!hideClose && (
              <button className="icon-btn -mt-1 !h-8 !w-8 shrink-0" onClick={onClose} aria-label="بستن">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="border-t border-ink-900/5 bg-white/40 px-5 py-3.5 dark:border-white/5 dark:bg-white/[0.03]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Wide floating card on desktop instead of a bottom-anchored sheet. */
  desktopFloating?: boolean;
}

/** Telegram-style bottom sheet; becomes a floating glass card on desktop. */
export function BottomSheet({ open, onClose, title, children, desktopFloating = true }: BottomSheetProps) {
  const mounted = useDelayedUnmount(open);
  useLockBodyScroll(mounted);
  useEscape(open, onClose);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`no-print fixed inset-0 z-[70] ${open ? "" : "pointer-events-none"}`}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`anim-fade absolute inset-0 bg-[#0d0f1a]/45 backdrop-blur-[3px] ${open ? "" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto w-full ${
          desktopFloating
            ? "sm:bottom-10 sm:max-w-md sm:rounded-[28px] sm:px-0"
            : ""
        } ${open ? "anim-sheet" : "translate-y-full opacity-0"} transition-all duration-200`}
      >
        <div className="glass-strong flex max-h-[82dvh] flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]">
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink-300/70" />
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {title && <h2 className="mb-3 text-[15px] font-bold">{title}</h2>}
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
