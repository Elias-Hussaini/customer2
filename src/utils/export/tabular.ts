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

/** RTL XLSX via SheetJS. */
export async function exportXlsx(
  filename: string,
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<void> {
  const XLSX = await import("xlsx");
  const aoa: unknown[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => (r[c.key] == null ? "" : r[c.key]))),
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
