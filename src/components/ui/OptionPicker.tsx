import { useState, type ReactNode } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

export interface PickerOption {
  value: string;
  label: string;
  /** short example / path preview shown under the label */
  hint?: string;
}

interface OptionPickerProps {
  /** section caption, e.g. «ساختار پوشه‌ها» */
  label: string;
  icon?: LucideIcon;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  /** extra controls rendered inside the open panel (e.g. a template input) */
  children?: ReactNode;
  /** option values that keep the panel open after selection (they need input) */
  stayOpenOn?: string[];
}

/**
 * A collapsible, space-saving option list. Closed it shows a single compact
 * row with the current selection; opened it reveals a radio-style list with
 * one hint line per option. Replaces wide button grids that ate the page.
 */
export function OptionPicker({ label, icon: Icon, options, value, onChange, children, stayOpenOn }: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        open
          ? "border-brand-400/60 bg-brand-500/4 dark:border-brand-400/40"
          : "border-ink-900/10 hover:border-brand-300 dark:border-white/10 dark:hover:border-brand-400/40"
      }`}
    >
      {/* header — always visible */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-right"
      >
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <Icon size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold leading-4">{label}</span>
          <span className="block truncate text-[11px] leading-5 text-brand-600 dark:text-brand-300" dir="auto">
            {current?.label ?? "—"}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-ink-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* expandable panel — grid-rows trick animates height without measuring.
          `invisible` keeps the collapsed options out of tab order and the a11y tree. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        aria-hidden={!open}
      >
        <div className={`overflow-hidden ${open ? "" : "invisible"}`}>
          <div className="flex flex-col gap-1 px-2.5 pb-2.5">
            {children}
            <div className="flex flex-col gap-1">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-checked={active}
                    role="radio"
                    onClick={() => {
                      onChange(o.value);
                      // options that need extra input keep the panel open;
                      // everything else folds away after the selection paints
                      if (!stayOpenOn?.includes(o.value)) {
                        window.setTimeout(() => setOpen(false), 140);
                      }
                    }}
                    className={`group flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-right transition-all ${
                      active
                        ? "bg-brand-500/12"
                        : "hover:bg-brand-500/6"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        active
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-ink-900/20 group-hover:border-brand-400 dark:border-white/25"
                      }`}
                      style={{ height: 18, width: 18 }}
                    >
                      {active && <Check size={11} strokeWidth={3.5} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[12px] font-bold leading-5 ${
                          active ? "text-brand-600 dark:text-brand-300" : ""
                        }`}
                      >
                        {o.label}
                      </span>
                      {o.hint && (
                        <span
                          className="block truncate text-[10.5px] leading-4 text-ink-400"
                          dir="auto"
                          title={o.hint}
                        >
                          {o.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
