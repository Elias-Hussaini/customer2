import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Floating, isFloatingPanel } from "./Floating";

export interface MenuItem {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  trigger: ReactNode;
  align?: "start" | "end";
  /** Preferred side (auto-flips when there is no room). */
  up?: boolean;
}

/**
 * Context menu rendered in a portal above every layer — never clipped by
 * glass cards or covered by following rows/cards.
 */
export function Menu({ items, trigger, align = "end", up = true }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (ref.current && !ref.current.contains(t) && !isFloatingPanel(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={ref}
        className="relative inline-block"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </span>
      <Floating
        open={open}
        anchorRef={ref}
        placement={up ? "top" : "bottom"}
        align={align === "end" ? "left" : "right"}
        className="min-w-[190px] overflow-hidden rounded-2xl p-1.5"
        onClose={() => setOpen(false)}
      >
        <div role="menu">
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-right text-[13px] font-medium transition-colors ${
                item.danger
                  ? "text-[#ef4444] hover:bg-[#ef4444]/10"
                  : "hover:bg-brand-500/10"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon && <item.icon size={15} className="shrink-0 opacity-80" />}
              {item.label}
            </button>
          ))}
        </div>
      </Floating>
    </>
  );
}
