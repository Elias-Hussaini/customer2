import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Portal-based anchored layer.
 *
 * Why a portal: glass cards use `backdrop-filter`, which creates a stacking
 * context. An absolutely-positioned popover inside such a card is trapped in
 * that context, so everything rendered later in the DOM (cards, tables, rows)
 * paints ON TOP of the popover — the panel "goes under" the content below.
 * By portaling to document.body with `position: fixed`, the layer escapes all
 * ancestor stacking/overflow contexts, and z-index is guaranteed above
 * modals (z-70) and below toasts.
 */

/** True when the event target is inside a Floating panel (for outside-click checks). */
export function isFloatingPanel(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-floating-panel]"));
}

interface FloatingProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Preferred side; automatically flips when there is not enough room. */
  placement?: "top" | "bottom";
  /** Physical horizontal alignment of the panel edge relative to the anchor. */
  align?: "left" | "right" | "center";
  gap?: number;
  /** Panel width follows the anchor width (min 200px). */
  matchAnchorWidth?: boolean;
  /** Fixed panel width in px. */
  width?: number;
  className?: string;
  /** Called when the user presses Escape while the panel is open. */
  onClose?: () => void;
}

const MIN_MATCHED_WIDTH = 200;

export function Floating({
  open,
  anchorRef,
  children,
  placement = "bottom",
  align = "right",
  gap = 8,
  matchAnchorWidth,
  width,
  className = "",
  onClose,
}: FloatingProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width?: number } | null>(null);

  const update = () => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = width ?? (matchAnchorWidth ? Math.max(rect.width, MIN_MATCHED_WIDTH) : panel.offsetWidth);
    const ph = panel.offsetHeight;

    let top = placement === "bottom" ? rect.bottom + gap : rect.top - gap - ph;
    // Auto flip when the preferred side does not fit.
    if (placement === "bottom" && top + ph > vh - 8 && rect.top - gap - ph >= 8) {
      top = rect.top - gap - ph;
    } else if (placement === "top" && top < 8 && rect.bottom + gap + ph <= vh - 8) {
      top = rect.bottom + gap;
    }

    let left: number;
    if (align === "left") left = rect.left;
    else if (align === "center") left = rect.left + rect.width / 2 - pw / 2;
    else left = rect.right - pw;
    left = Math.min(Math.max(8, left), Math.max(8, vw - pw - 8));

    setBox({ top, left, width: matchAnchorWidth || width ? pw : undefined });
  };

  // Measure & place before first paint (no flash at the wrong position).
  useLayoutEffect(() => {
    if (open) update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, align, gap, width, matchAnchorWidth]);

  useEffect(() => {
    if (!open) return;
    update();
    const ro = new ResizeObserver(() => update());
    if (panelRef.current) ro.observe(panelRef.current);
    // Capture phase catches scrolls inside any inner scroll container,
    // not just the window (e.g. modal bodies, filter bars).
    const onMove = () => update();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-floating-panel=""
      className={`glass-strong anim-pop fixed ${className}`}
      style={{
        top: box?.top ?? -9999,
        left: box?.left ?? -9999,
        width: box?.width,
        zIndex: 95,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
