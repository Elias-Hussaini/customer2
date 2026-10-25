import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
  /** Open the menu upward (for elements near the bottom edge). */
  up?: boolean;
}

export function Menu({ items, trigger, align = "end", up = true }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    <div className="relative inline-block" ref={ref}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </span>
      {open && (
        <div
          className={`glass-strong anim-pop absolute z-[60] min-w-[190px] overflow-hidden rounded-2xl p-1.5 ${
            up ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "end" ? "left-0" : "right-0"}`}
          role="menu"
        >
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
      )}
    </div>
  );
}
