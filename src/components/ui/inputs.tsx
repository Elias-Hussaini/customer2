import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { normalizeFa } from "../../utils/normalize";
import { Floating, isFloatingPanel } from "./Floating";

export interface SearchSelectItem {
  id: string;
  title: string;
  subtitle?: string;
}

interface SearchSelectProps {
  items: SearchSelectItem[];
  value: string | null;
  onSelect: (id: string | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  clearable?: boolean;
  /** Show a "create" option that calls onCreate with the raw query. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  disabled?: boolean;
  className?: string;
}

/** Searchable single-select with optional create mode. */
export function SearchSelect({
  items,
  value,
  onSelect,
  placeholder = "جستجو و انتخاب…",
  emptyLabel = "موردی یافت نشد",
  clearable = true,
  onCreate,
  createLabel,
  disabled,
  className = "",
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = normalizeFa(query);
    if (!q) return items.slice(0, 60);
    return items
      .filter(
        (i) => normalizeFa(`${i.title} ${i.subtitle ?? ""}`).includes(q),
      )
      .slice(0, 60);
  }, [items, query]);

  const selected = items.find((i) => i.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(t) && !isFloatingPanel(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`field flex items-center justify-between gap-2 text-right ${open ? "border-brand-500" : ""}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-ink-400"}`}>
          {selected ? selected.title : placeholder}
        </span>
        {selected && subtitleOf(selected) && (
          <span className="hidden shrink-0 text-[11px] text-ink-400 sm:inline">
            {subtitleOf(selected)}
          </span>
        )}
        <ChevronDown
          size={15}
          className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <Floating
          open={open}
          anchorRef={wrapRef}
          matchAnchorWidth
          placement="bottom"
          className="overflow-hidden rounded-2xl"
          onClose={() => setOpen(false)}
        >
          <div className="flex items-center gap-2 border-b border-ink-900/5 px-3.5 py-2.5 dark:border-white/5">
            <Search size={14} className="shrink-0 text-ink-400" />
            <input
              ref={inputRef}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-400"
              placeholder="جستجو…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {clearable && selected && (
              <button
                type="button"
                className="w-full rounded-xl px-3 py-2 text-right text-[13px] text-ink-500 hover:bg-ink-500/8"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                — حذف انتخاب —
              </button>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded-xl px-3 py-2 text-right transition-colors hover:bg-brand-500/10 ${
                  item.id === value ? "bg-brand-500/12" : ""
                }`}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <span className="block truncate text-[13px] font-semibold">{item.title}</span>
                {item.subtitle && (
                  <span className="block truncate text-[11px] text-ink-500 dark:text-ink-400">
                    {item.subtitle}
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && !onCreate && (
              <p className="px-3 py-3 text-center text-xs text-ink-400">{emptyLabel}</p>
            )}
            {onCreate && query.trim() && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] font-semibold text-brand-600 hover:bg-brand-500/10 dark:text-brand-300"
                onClick={() => {
                  onCreate(query.trim());
                  setQuery("");
                  setOpen(false);
                }}
              >
                <Plus size={15} />
                {createLabel ? createLabel(query.trim()) : `ایجاد «${query.trim()}»`}
              </button>
            )}
          </div>
        </Floating>
      )}
    </div>
  );
}

function subtitleOf(item: SearchSelectItem): string | undefined {
  return item.subtitle;
}

interface RadioSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Segmented control for small option sets. */
export function RadioSelect({ options, value, onChange, className = "" }: RadioSelectProps) {
  return (
    <div
      className={`flex gap-1 rounded-[0.85rem] border border-ink-900/10 bg-white/50 p-1 dark:border-white/10 dark:bg-white/5 ${className}`}
      role="radiogroup"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-[0.65rem] px-2 py-1.5 text-xs font-bold transition-all ${
            value === opt.value
              ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
              : "text-ink-500 hover:text-ink-700 dark:text-ink-400"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  ariaLabel?: string;
}

/** Styled native select for filters. */
export function FilterSelect({ value, onChange, options, className = "", ariaLabel }: FilterSelectProps) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={ariaLabel}
        className="field !py-2 !ps-2.5 !pe-7 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "جستجو…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        className="field !py-2 pr-10 text-[13px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SectionCard({
  title,
  icon,
  children,
  action,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-3xl p-4 sm:p-5 ${className}`}>
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-bold text-ink-700 dark:text-ink-100">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
