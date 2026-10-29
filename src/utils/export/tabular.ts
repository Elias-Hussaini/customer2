import { saveAs } from "file-saver";

export interface ExportColumn {
  key: string;
  header: string;
}

export type ExportRow = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Grouped summary (accounting) — currency sections + per-party table  */
/* ------------------------------------------------------------------ */

/**
 * A summary section rendered as a chip row led by a small currency badge
 * (تومان / دلار). The badge carries the unit, so item labels and values
 * never repeat it — no «جمع برداشت (دلار): ۲۰۰ دلار» duplication.
 */
export interface SummarySection {
  /** Badge label — e.g. تومان / دلار. Omit for a neutral group. */
  tag?: string;
  items: { label: string; value: string }[];
}

/**
 * Per-party breakdown table appended under the data table (and mirrored in
 * XLSX) — «جمع‌بندی به تفکیک طرف حساب» plus a bold «جمع کل» row, i.e. the
 * جمع‌بندی کلی. Built only when the report covers MORE than one party.
 */
export interface PartySummaryData {
  title: string;
  /** Column headers (RTL order). */
  columns: string[];
  /** One row of pre-formatted cells per party. */
  rows: string[][];
  /** Bold «جمع کل» row (same width as columns). */
  totalRow: string[];
}

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
/* Grouping by a column value (e.g. representative)                     */
/* ------------------------------------------------------------------ */

export interface ExportGroup {
  /** Group key — the column value ("" when the cell is empty). */
  value: string;
  rows: ExportRow[];
}

/**
 * Group rows by a column's value so exports read section-by-section —
 * one representative completely, then the next one below it.
 *
 * Groups are Persian-locale ordered (alphabetical, فارسی درست);
 * rows keep their natural order inside each group.
 */
export function groupExportRows(rows: ExportRow[], columnKey: string): ExportGroup[] {
  const map = new Map<string, ExportRow[]>();
  for (const r of rows) {
    const v = r[columnKey];
    const key = v == null ? "" : String(v).trim();
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => {
      // Named groups Persian-ordered; the «بدون …» (empty) group always LAST.
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return a[0].localeCompare(b[0], "fa");
    })
    .map(([value, groupRows]) => ({ value, rows: groupRows }));
}

/** Flatten grouped rows back to a plain ordered list (CSV export order). */
export function flattenGroups(groups: ExportGroup[]): ExportRow[] {
  return groups.flatMap((g) => g.rows);
}

/** Display label of a group — empty cells become «بدون …» (e.g. بدون نماینده). */
export function groupLabel(value: string, what: string): string {
  const v = value.trim();
  return v ? v : `بدون ${what}`;
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
  /* — accounting scope — */
  /** Distinct non-empty party names (طرف حساب) across the export. */
  accParties: string[];
  /** Count of قطعی (incl. فقط ثبت) transaction rows. */
  finalTx: number;
  reversedTx: number;
  cancelledTx: number;
  /** Outstanding rows: سررسید گذشته / باز / پرداخت جزئی / تسویه شده. */
  overdueItems: number;
  openItems: number;
  partialItems: number;
  settledItems: number;
  /** True when any accounting status value was recognized. */
  hasAccStatus: boolean;
}

/**
 * Smart scope statistics computed from the ACTUAL exported rows — the same
 * export is summarised differently when it covers everyone vs. one
 * representative, with no call-site plumbing.
 *
 * Two scopes are recognized in one column:
 *  — visa statuses (صادر شده / در حال کار / لغو)
 *  — accounting statuses (قطعی / برگشت خورده / ابطال + باز / جزئی / تسویه / سررسید گذشته)
 */
export function computeExportStats(columns: ExportColumn[], rows: ExportRow[]): ExportStats {
  const statusCol = columns.find(
    (c) => STATUS_COLUMN_KEYS.has(c.key) || c.header.includes("وضعیت"),
  );
  const repCol = columns.find((c) => c.key === "representative" || c.header.includes("نماینده"));
  const listCol = columns.find((c) => c.key === "list" || c.header.includes("لیست"));
  const partyCol = columns.find((c) => c.key === "party" || c.key === "partyName" || c.header.includes("طرف حساب"));
  const stats: ExportStats = {
    total: rows.length,
    representatives: [],
    lists: [],
    issued: 0,
    inProgress: 0,
    rejected: 0,
    hasStatus: false,
    hasRepresentative: Boolean(repCol),
    accParties: [],
    finalTx: 0,
    reversedTx: 0,
    cancelledTx: 0,
    overdueItems: 0,
    openItems: 0,
    partialItems: 0,
    settledItems: 0,
    hasAccStatus: false,
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
  if (partyCol) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r[partyCol.key];
      if (v != null && String(v).trim()) set.add(String(v).trim());
    }
    stats.accParties = [...set].sort();
  }
  if (statusCol) {
    for (const r of rows) {
      const v = r[statusCol.key];
      const s = v == null ? "" : String(v).trim();
      if (!s) continue;
      // — visa statuses —
      if (s.includes("صادر")) stats.issued++;
      else if (s.includes("در حال")) stats.inProgress++;
      else if (s.includes("لغو") || s.includes("رد ")) stats.rejected++;
      // — accounting transaction statuses —
      if (s.startsWith("قطعی")) stats.finalTx++;
      if (s.includes("برگشت خورده")) stats.reversedTx++;
      if (s.includes("ابطال")) stats.cancelledTx++;
      // — accounting outstanding statuses —
      if (s.includes("سررسید گذشته")) stats.overdueItems++;
      else if (s === "باز" || s.startsWith("باز ")) stats.openItems++;
      else if (s.includes("پرداخت جزئی")) stats.partialItems++;
      else if (s.includes("تسویه شده")) stats.settledItems++;
    }
    stats.hasStatus = stats.issued + stats.inProgress + stats.rejected > 0;
    stats.hasAccStatus =
      stats.finalTx + stats.reversedTx + stats.cancelledTx +
      stats.overdueItems + stats.openItems + stats.partialItems + stats.settledItems >
      0;
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
  if (stats.hasAccStatus) {
    if (stats.accParties.length === 1) parts.push(`طرف حساب: ${stats.accParties[0]}`);
    else if (stats.accParties.length > 1) parts.push(`${toFaDigits(stats.accParties.length)} طرف حساب`);
    parts.push(`${toFaDigits(stats.finalTx)} قطعی`);
    if (stats.reversedTx > 0) parts.push(`${toFaDigits(stats.reversedTx)} برگشت خورده`);
    if (stats.cancelledTx > 0) parts.push(`${toFaDigits(stats.cancelledTx)} ابطال شده`);
    if (stats.overdueItems > 0) parts.push(`${toFaDigits(stats.overdueItems)} سررسید گذشته`);
  }
  return parts.join(" — ");
}

/* ------------------------------------------------------------------ */
/* XLSX — ExcelJS writer (styled, RTL, optional per-rep sections with   */
/* an embedded small profile photo). Falls back to the legacy SheetJS  */
/* path if ExcelJS cannot be loaded, so an export never hard-fails.    */
/* ------------------------------------------------------------------ */

const XL_BRAND = "FF635BFF";
const XL_BRAND_DARK = "FF5344D6";
const XL_HEAD_FG = "FFFFFFFF";
const XL_ZEBRA = "FFF8F8FE";
const XL_BORDER = "FFECECF5";
const XL_SECTION_BG = "FFF3F1FF";

interface CellStyle {
  fill?: { type: "pattern"; pattern: "solid"; fgColor: { argb: string } };
  font?: Partial<{ bold: boolean; size: number; color: { argb: string }; name: string }>;
  border?: {
    top?: { style: "thin"; color: { argb: string } };
    bottom?: { style: "thin"; color: { argb: string } };
    left?: { style: "thin"; color: { argb: string } };
    right?: { style: "thin"; color: { argb: string } };
  };
  alignment?: Partial<{
    horizontal: "left" | "center" | "right";
    vertical: "middle" | "top" | "bottom";
    readingOrder: "rtl" | "ltr";
  }>;
}

function thinBorders(): CellStyle["border"] {
  const edge = { style: "thin" as const, color: { argb: XL_BORDER } };
  return { top: edge, bottom: edge, left: edge, right: edge };
}

/** data:image/... → { base64, extension } for ExcelJS (it accepts the full data URI). */
function parseDataUrl(url: string): { base64: string; extension: "jpeg" | "png" | "gif" } | null {
  const m = /^data:image\/(jpeg|jpg|png|gif);base64,(.*)$/s.exec(url.trim());
  if (!m) return null;
  return {
    base64: url.trim(),
    extension: m[1] === "jpg" ? "jpeg" : (m[1] as "jpeg" | "png" | "gif"),
  };
}

export async function exportXlsx(
  filename: string,
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
  groups?: ExportGroup[],
  /** group value → profile photo (data URL) shown small next to the name. */
  photos?: Record<string, string | undefined>,
  /** Persian word for what is grouped — used for the «بدون …» label. */
  groupWhat?: string,
  /** Optional per-row photos (e.g. customer photo beside their name cell). */
  rowPhotos?: {
    columnKey: string;
    idKey: string;
    photos: Record<string, string | undefined>;
  },
  /** Optional accounting summary — currency sections + per-party table. */
  accSummary?: {
    sections?: SummarySection[];
    partySummary?: PartySummaryData;
  },
): Promise<void> {
  const stats = computeExportStats(columns, rows);
  try {
    const mod: unknown = await import("exceljs");
    const lib = (mod as { default?: unknown }).default ?? mod;
    const ExcelJS = lib as typeof import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "E-managment";
    const ws = wb.addWorksheet(sheetName.slice(0, 28) || "گزارش", {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });

    // Column widths from the widest content (chars), same heuristic as before.
    const photoColIdx = rowPhotos ? columns.findIndex((c) => c.key === rowPhotos.columnKey) : -1;
    const colWidth = columns.map((c, i) => {
      let len = c.header.length;
      for (const r of rows) {
        const v = r[c.key];
        if (v != null && v !== "") len = Math.max(len, String(v).length);
      }
      // extra room beside the embedded round photo
      if (i === photoColIdx) len += 5;
      return Math.min(40, Math.max(10, len + 4));
    });
    ws.columns = columns.map((c, i) => ({ key: c.key, width: colWidth[i] }));

    // Header row
    const headRow = ws.addRow(columns.map((c) => c.header));
    headRow.height = 24;
    headRow.eachCell((cell) => {
      cell.style = {
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: XL_BRAND } },
        font: { bold: true, size: 11, color: { argb: XL_HEAD_FG }, name: "Calibri" },
        alignment: { horizontal: "center", vertical: "middle", readingOrder: "rtl" },
        border: {
          top: { style: "thin", color: { argb: XL_BRAND_DARK } },
          bottom: { style: "thin", color: { argb: XL_BRAND_DARK } },
          left: { style: "thin", color: { argb: "FF8079E8" } },
          right: { style: "thin", color: { argb: "FF8079E8" } },
        },
      } satisfies CellStyle;
    });

    const addDataRow = (r: ExportRow, zebra: boolean) => {
      const row = ws.addRow(columns.map((c) => (r[c.key] == null ? "" : r[c.key])));
      const hasPhoto = photoColIdx >= 0;
      row.height = hasPhoto ? 24 : 20;
      row.eachCell((cell, colNo) => {
        const v = cell.value;
        const style: CellStyle = {
          border: thinBorders(),
          alignment: { horizontal: "center", vertical: "middle", readingOrder: "rtl" },
          ...(zebra ? { fill: { type: "pattern", pattern: "solid", fgColor: { argb: XL_ZEBRA } } } : {}),
        };
        if (typeof v === "number" && Number.isInteger(v) && Math.abs(v) >= 1000) {
          cell.numFmt = "#,##0";
        }
        cell.style = style;
      });
      // Small round photo beside the name cell (e.g. customer photo).
      if (rowPhotos && photoColIdx >= 0) {
        const id = String(r[rowPhotos.idKey] ?? "");
        const photo = rowPhotos.photos[id];
        const parsed = photo ? parseDataUrl(photo) : null;
        if (parsed) {
          try {
            const imgId = wb.addImage({ base64: parsed.base64, extension: parsed.extension });
            const rowIdx = ws.rowCount - 1; // 0-based anchor of the row just added
            ws.addImage(imgId, {
              tl: { col: photoColIdx + 0.06, row: rowIdx + 0.09 },
              ext: { width: 18, height: 18 },
            });
          } catch {
            /* photo is decoration — never fail the export for it */
          }
        }
      }
    };

    if (groups && groups.length > 0) {
      // Grouped sections: [photo] نام نماینده — then that rep's rows, then the next.
      for (const g of groups) {
        const sectionRowIndex = ws.rowCount + 1; // 1-based
        const sectionRow = ws.addRow([]);
        sectionRow.height = 34;
        const label = groupLabel(g.value, groupWhat ?? "نمایه");
        const textCell = ws.getCell(sectionRowIndex, columns.length > 1 ? 2 : 1);
        if (columns.length > 1) {
          ws.mergeCells(sectionRowIndex, 2, sectionRowIndex, columns.length);
        }
        textCell.value = `${label}  (${toFaDigits(g.rows.length)} رکورد)`;
        textCell.style = {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: XL_SECTION_BG } },
          font: { bold: true, size: 12.5 },
          alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
          border: thinBorders(),
        } satisfies CellStyle;
        // Tint the photo cell too (image floats above it).
        ws.getCell(sectionRowIndex, 1).style = {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: XL_SECTION_BG } },
          border: thinBorders(),
        } satisfies CellStyle;
        // Small photo at the row start — col 0 renders rightmost in RTL view.
        const photo = photos?.[g.value];
        const parsed = photo ? parseDataUrl(photo) : null;
        if (parsed) {
          try {
            const imgId = wb.addImage({
              base64: parsed.base64,
              extension: parsed.extension,
            });
            ws.addImage(imgId, {
              tl: { col: 0.08, row: sectionRowIndex - 1 + 0.12 },
              ext: { width: 26, height: 26 },
            });
          } catch {
            /* photo is decoration — never fail the export for it */
          }
        }
        g.rows.forEach((r, i) => addDataRow(r, i % 2 === 1));
      }
    } else {
      rows.forEach((r, i) => addDataRow(r, i % 2 === 1));
    }

    // — Accounting extras: per-party breakdown table + currency sections —
    if (accSummary?.partySummary && accSummary.partySummary.rows.length > 0) {
      const ps = accSummary.partySummary;
      ws.addRow([]);
      const titleIdx = ws.rowCount + 1;
      const titleRow = ws.addRow([ps.title]);
      if (columns.length > 1) ws.mergeCells(titleIdx, 1, titleIdx, columns.length);
      ws.getCell(titleIdx, 1).style = {
        font: { bold: true, size: 12, color: { argb: "FF07815A" } },
        alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
      } satisfies CellStyle;
      void titleRow;
      const headIdx = ws.rowCount + 1;
      ws.addRow(ps.columns);
      for (let c = 1; c <= ps.columns.length; c++) {
        ws.getCell(headIdx, c).style = {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF9F3" } },
          font: { bold: true, size: 11, color: { argb: "FF07815A" } },
          border: thinBorders(),
          alignment: { horizontal: "center", vertical: "middle", readingOrder: "rtl" },
        } satisfies CellStyle;
      }
      for (const row of [...ps.rows, ps.totalRow]) {
        const isTotal = row === ps.totalRow;
        const rIdx = ws.rowCount + 1;
        ws.addRow(row);
        for (let c = 1; c <= ps.columns.length; c++) {
          ws.getCell(rIdx, c).style = {
            border: thinBorders(),
            font: { bold: isTotal || c === 1, size: 10.5 },
            ...(isTotal
              ? { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF9F3" } } }
              : rIdx % 2 === 0
                ? { fill: { type: "pattern", pattern: "solid", fgColor: { argb: XL_ZEBRA } } }
                : {}),
            alignment: {
              horizontal: c === 1 ? "right" : "center",
              vertical: "middle",
              readingOrder: "rtl",
            },
          } satisfies CellStyle;
        }
      }
    }
    if (accSummary?.sections && accSummary.sections.length > 0) {
      ws.addRow([]);
      for (const sec of accSummary.sections) {
        const line = [sec.tag ? `— ${sec.tag} —` : "", ...sec.items.map((it) => `${it.label}: ${it.value}`)]
          .filter(Boolean)
          .join("     ");
        const sIdx = ws.rowCount + 1;
        ws.addRow([line]);
        if (columns.length > 1) ws.mergeCells(sIdx, 1, sIdx, columns.length);
        ws.getCell(sIdx, 1).style = {
          font: { bold: true, size: 11, color: { argb: "FF07815A" } },
          alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
        } satisfies CellStyle;
      }
    }

    // Smart summary footer
    ws.addRow([]);
    const footerRowIndex = ws.rowCount + 1;
    const footerRow = ws.addRow([`جمع‌بندی: ${exportStatsLine(stats)}`]);
    if (columns.length > 1) ws.mergeCells(footerRowIndex, 1, footerRowIndex, columns.length);
    const footerCell = ws.getCell(footerRowIndex, 1);
    footerCell.style = {
      font: { bold: true, size: 11, color: { argb: XL_BRAND_DARK } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
    } satisfies CellStyle;
    void footerRow;

    const out = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${filename}.xlsx`,
    );
  } catch (e) {
    // ExcelJS unavailable (offline first load of a new chunk, old browser, …)
    // → legacy plain SheetJS output, still grouped row ORDER, no photos.
    console.warn("ExcelJS export failed, falling back to SheetJS", e);
    await exportXlsxLegacy(filename, sheetName, columns, groups && groups.length ? flattenGroups(groups) : rows);
  }
}

/** Legacy plain RTL XLSX via SheetJS — the never-fail fallback. */
async function exportXlsxLegacy(
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
