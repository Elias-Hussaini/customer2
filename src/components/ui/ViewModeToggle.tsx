import { LayoutGrid, Table2 } from "lucide-react";

/**
 * Cards ↔ table display toggle — the «دو جور نمایش» the user asked for on the
 * representatives and employers sections (and any scoped list). The chosen
 * mode is remembered per page via pageFilters.
 */

export type CollectionViewMode = "cards" | "table";

export function isCollectionViewMode(v: string): v is CollectionViewMode {
  return v === "cards" || v === "table";
}

/** Segmented cards/table toggle. */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: CollectionViewMode;
  onChange: (v: CollectionViewMode) => void;
}) {
  return (
    <span className="glass-soft inline-flex shrink-0 items-center gap-0.5 rounded-full p-0.5">
      <button
        type="button"
        aria-pressed={value === "cards"}
        aria-label="نمایش کارتی"
        title="نمایش کارتی"
        className={`flex h-7.5 w-8 items-center justify-center rounded-full transition-all ${
          value === "cards"
            ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
            : "text-ink-400 hover:text-brand-600 dark:hover:text-brand-300"
        }`}
        onClick={() => onChange("cards")}
      >
        <LayoutGrid size={14} />
      </button>
      <button
        type="button"
        aria-pressed={value === "table"}
        aria-label="نمایش جدولی"
        title="نمایش جدولی"
        className={`flex h-7.5 w-8 items-center justify-center rounded-full transition-all ${
          value === "table"
            ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
            : "text-ink-400 hover:text-brand-600 dark:hover:text-brand-300"
        }`}
        onClick={() => onChange("table")}
      >
        <Table2 size={14} />
      </button>
    </span>
  );
}

/** One subtle line explaining the hover stage shortcuts (discoverability). */
export function HotkeyHint({ className = "" }: { className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] leading-4 text-ink-400 ${className}`}>
      <span>با نگه‌داشتن نشانگر روی هر مشتری:</span>
      <span className="flex items-center gap-1">
        <kbd className="kbd">Ctrl</kbd> مرحله بعد
      </span>
      <span className="flex items-center gap-1">
        <kbd className="kbd">Alt</kbd> مرحله قبل
      </span>
      <span className="flex items-center gap-1">
        <kbd className="kbd">Shift</kbd> صادر شده
      </span>
      <span className="flex items-center gap-1">
        <kbd className="kbd">Alt+Shift</kbd> رد شده
      </span>
    </p>
  );
}
