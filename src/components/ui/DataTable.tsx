import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "start" | "center" | "end";
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Card renderer for phones — falls back to the first three columns. */
  mobileCard?: (row: T) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  initialSort?: { key: string; dir: "asc" | "desc" };
  footer?: ReactNode;
}

const ALIGN: Record<string, string> = {
  start: "text-right",
  center: "text-center",
  end: "text-left",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  mobileCard,
  empty,
  loading,
  initialSort,
  footer,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSort?.dir ?? "asc");

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb), "fa")
        : String(vb).localeCompare(String(va), "fa");
    });
    return copy;
  }, [rows, sortKey, sortDir, columns]);

  const toggleSort = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortValue) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl bg-ink-900/5 dark:bg-white/5" />
        ))}
      </div>
    );
  }

  if (sortedRows.length === 0) {
    return <>{empty ?? null}</>;
  }

  return (
    <>
      {/* Desktop table */}
      <div className="glass hidden overflow-hidden rounded-3xl md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ink-900/5 bg-white/30 text-[11px] font-semibold text-ink-500 dark:border-white/5 dark:bg-white/[0.03] dark:text-ink-400">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3.5 py-3 ${ALIGN[col.align ?? "start"]} ${
                      col.sortValue ? "cursor-pointer select-none hover:text-brand-600 dark:hover:text-brand-300" : ""
                    } ${col.className ?? ""}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortValue &&
                        (sortKey === col.key ? (
                          sortDir === "asc" ? (
                            <ArrowUp size={12} className="text-brand-500" />
                          ) : (
                            <ArrowDown size={12} className="text-brand-500" />
                          )
                        ) : (
                          <ChevronsUpDown size={12} className="opacity-40" />
                        ))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-ink-900/4 transition-colors last:border-0 dark:border-white/4 ${
                    onRowClick ? "cursor-pointer hover:bg-brand-500/5" : ""
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3.5 py-3 align-middle ${ALIGN[col.align ?? "start"]}`}
                    >
                      {col.render ? col.render(row) : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer && (
          <div className="border-t border-ink-900/5 px-4 py-2.5 text-xs text-ink-500 dark:border-white/5 dark:text-ink-400">
            {footer}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {sortedRows.map((row) =>
          mobileCard ? (
            <div key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {mobileCard(row)}
            </div>
          ) : (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className="glass flex flex-col gap-1.5 rounded-2xl p-3.5 text-[13px]"
            >
              {columns.slice(0, 3).map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-ink-500 dark:text-ink-400">{col.header}</span>
                  <span className="min-w-0 truncate font-medium">
                    {col.render ? col.render(row) : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                  </span>
                </div>
              ))}
            </div>
          ),
        )}
        {footer && <div className="px-1 text-xs text-ink-500 dark:text-ink-400">{footer}</div>}
      </div>
    </>
  );
}
