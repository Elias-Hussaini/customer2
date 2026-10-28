import { saveAs } from "file-saver";

export interface ExportColumn {
  key: string;
  header: string;
}

export type ExportRow = Record<string, unknown>;

export function downloadBlob(blob: Blob, filename: string): void {
  saveAs(blob, filename);
}

/** UTF-8 BOM CSV that opens correctly in Excel with Persian text. */
export function exportCsv(
  filename: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): void {
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => esc(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")),
  ];
  const csv = "\uFEFF" + lines.join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
}

/* ------------------------------------------------------------------ */
/* Smart export statistics (shared by PDF/PNG doc + XLSX footer)        */
/* ------------------------------------------------------------------ */

const STATUS_COLUMN_KEYS = new Set(["status", "issued", "state"]);

function toFaDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export interface ExportStats {
  total: number;
  /** Distinct non-empty representative names (empty when no rep column). */
  representatives: string[];
  /** Distinct non-empty list names (empty when no list column). */
  lists: string[];
  issued: number;
  inProgress: number;
  rejected: number;
  /** True when a status column with recognizable status values exists. */
  hasStatus: boolean;
  hasRepresentative: boolean;
}

/**
 * Smart scope statistics computed from the ACTUAL exported rows — the same
 * export is summarised differently when it covers everyone vs. one
 * representative, with no call-site plumbing.
 */
export function computeExportStats(columns: ExportColumn[], rows: ExportRow[]): ExportStats {
  const statusCol = columns.find(
    (c) => STATUS_COLUMN_KEYS.has(c.key) || c.header.includes("وضعیت"),
  );
  const repCol = columns.find((c) => c.key === "representative" || c.header.includes("نماینده"));
  const listCol = columns.find((c) => c.key === "list" || c.header.includes("لیست"));
  const stats: ExportStats = {
    total: rows.length,
    representatives: [],
    lists: [],
    issued: 0,
    inProgress: 0,
    rejected: 0,
    hasStatus: false,
    hasRepresentative: Boolean(repCol),
  };
  if (repCol) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r[repCol.key];
      if (v != null && String(v).trim()) set.add(String(v).trim());
    }
    stats.representatives = [...set].sort();
  }
  if (listCol) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r[listCol.key];
      if (v != null && String(v).trim()) set.add(String(v).trim());
    }
    stats.lists = [...set].sort();
  }
  if (statusCol) {
    for (const r of rows) {
      const v = r[statusCol.key];
      const s = v == null ? "" : String(v).trim();
      if (!s) continue;
      if (s.includes("صادر")) stats.issued++;
      else if (s.includes("در حال")) stats.inProgress++;
      else if (s.includes("لغو") || s.includes("رد ")) stats.rejected++;
    }
    stats.hasStatus = stats.issued + stats.inProgress + stats.rejected > 0;
  }
  return stats;
}

/** One-line Persian summary of the export scope (XLSX footer / reports). */
export function exportStatsLine(stats: ExportStats): string {
  const parts: string[] = [`${toFaDigits(stats.total)} رکورد`];
  if (stats.hasRepresentative) {
    parts.push(
      stats.representatives.length === 1
        ? `نماینده: ${stats.representatives[0]}`
        : `${toFaDigits(stats.representatives.length)} نماینده`,
    );
  }
  if (stats.lists.length > 1) parts.push(`${toFaDigits(stats.lists.length)} لیست`);
  if (stats.hasStatus) {
    parts.push(`${toFaDigits(stats.issued)} صادر شده`);
    parts.push(`${toFaDigits(stats.inProgress)} در حال کار`);
    if (stats.rejected > 0) parts.push(`${toFaDigits(stats.rejected)} رد شده`);
  }
  return parts.join(" — ");
}

/** RTL XLSX via SheetJS. */
export async function exportXlsx(
  filename: string,
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<void> {
  const XLSX = await import("xlsx");
  const stats = computeExportStats(columns, rows);
  const aoa: unknown[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => (r[c.key] == null ? "" : r[c.key]))),
    [],
    [`جمع‌بندی: ${exportStatsLine(stats)}`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: Math.min(40, Math.max(10, c.header.length + 6)) }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 28) || "گزارش");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}.xlsx`,
  );
}
