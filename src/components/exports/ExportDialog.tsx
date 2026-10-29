import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, FileText, FileType2, Image, Layers, Paperclip } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Checkbox } from "../ui/fields";
import type {
  ExportColumn,
  ExportRow,
  PartySummaryData,
  SummarySection,
} from "../../utils/export/tabular";
import {
  exportCsv,
  exportXlsx,
  flattenGroups,
  groupExportRows,
} from "../../utils/export/tabular";
import { exportElementAsPdf, exportElementAsPng } from "../../utils/export/raster";
import { ExportDoc, type ExportRowPhotos, type ExportRowReceipts, type ExportTheme } from "./ExportDoc";
import { useToast } from "../../hooks/useToast";
import { loadPageFilter, savePageFilter } from "../../utils/pageFilters";

type Format = "xlsx" | "csv" | "pdf" | "png";

const FORMATS: { key: Format; label: string; icon: typeof FileText }[] = [
  { key: "xlsx", label: "اکسل", icon: FileSpreadsheet },
  { key: "csv", label: "CSV", icon: FileType2 },
  { key: "pdf", label: "PDF", icon: FileText },
  { key: "png", label: "تصویر PNG", icon: Image },
];

function isFormat(v: string): v is Format {
  return FORMATS.some((f) => f.key === v);
}

/** Saved column selection is a comma-joined key list; "!" = user chose none. */
const NONE_SENTINEL = "!";

/** Load the remembered column selection for a report type, intersected with
 *  the columns that actually exist (unknown saved keys are dropped; a report
 *  whose columns all vanished falls back to everything selected). */
function loadColumnPrefs(allKeys: string[], page: string): string[] {
  const saved = loadPageFilter<string>(page, "columns", "", () => true);
  if (!saved) return allKeys;
  if (saved === NONE_SENTINEL) return [];
  const set = new Set(saved.split(",").filter(Boolean));
  const kept = allKeys.filter((k) => set.has(k));
  return kept.length > 0 ? kept : allKeys;
}

/** Grouping configuration — e.g. by representative with profile photos. */
export interface ExportGrouping {
  /** Column whose values define the groups (e.g. "representative"). */
  columnKey: string;
  /** Persian word for what is grouped — «دسته‌بندی بر اساس …». */
  label: string;
  /** group value → profile photo (data URL) shown small next to the name. */
  photos?: Record<string, string | undefined>;
}

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: ExportRow[];
  defaultFilename: string;
  summary?: { label: string; value: string }[];
  /** Grouped summary (accounting) — currency-badged chip rows. */
  summarySections?: SummarySection[];
  /** Per-party breakdown table for the export doc footer + XLSX. */
  partySummary?: PartySummaryData;
  /** Optional section grouping (offered automatically when >1 group exists). */
  grouping?: ExportGrouping;
  /** Optional per-row photos (e.g. customer photo beside their name). */
  rowPhotos?: ExportRowPhotos;
  /** Optional per-row receipt images (سند) — offered as a toggle when at
   *  least one row owns a receipt photo; embedded below each transaction. */
  rowReceipts?: { idKey: string; photos: Record<string, string[]> };
  /** Section identity for PDF/PNG documents: "visa" (default) or "acc". */
  theme?: ExportTheme;
  extra?: ReactNode;
}

/**
 * Universal export dialog: pick columns + format, then generate XLSX/CSV
 * (data) or PDF/PNG (rasterized print document with full Persian support).
 * When `grouping` is set and several groups exist, the export is sectioned —
 * one representative completely, then the next — with a small profile photo
 * next to each name (XLSX embeds it as a real image; PDF/PNG render it).
 * When `rowPhotos` is set, every data row shows a small round photo beside
 * the matching name cell (customer photos) in all formats.
 *
 * The LAST choices (output columns like ارز/لیست, format, grouping) are
 * remembered per report type — reopening the dialog restores them, so a
 * habitual "same report, same columns" export is one click.
 */
export function ExportDialog({
  open,
  onClose,
  title,
  subtitle,
  columns,
  rows,
  defaultFilename,
  summary,
  summarySections,
  partySummary,
  grouping,
  rowPhotos,
  rowReceipts,
  theme = "visa",
  extra,
}: ExportDialogProps) {
  const toast = useToast();
  /** localStorage page key for this report type's export preferences. */
  const prefsPage = `export-${defaultFilename}`;
  const [selected, setSelected] = useState<string[]>(() =>
    loadColumnPrefs(columns.map((c) => c.key), prefsPage),
  );
  const [format, setFormat] = useState<Format>(() => {
    const saved = loadPageFilter<string>(prefsPage, "format", "xlsx", isFormat);
    return isFormat(saved) ? saved : "xlsx";
  });
  const [filename, setFilename] = useState(defaultFilename);
  const [busy, setBusy] = useState(false);
  const [groupBy, setGroupBy] = useState(
    () => loadPageFilter<string>(prefsPage, "groupBy", "1", () => true) !== "0",
  );
  /** Embed receipt images below each transaction (سند) — remembered too. */
  const hasReceipts = (rowReceipts && Object.keys(rowReceipts.photos).length > 0) || false;
  const [withReceipts, setWithReceipts] = useState(
    () => loadPageFilter<string>(prefsPage, "receipts", "1", () => true) !== "0",
  );
  const docRef = useRef<HTMLDivElement>(null);
  const [pendingDoc, setPendingDoc] = useState(false);
  const readyCb = useRef<(() => void) | null>(null);

  // Switching report kind swaps the column set — reload that kind's saved
  // preferences (via a ref so a new inline columns array per render does not
  // reset the user's in-session tweaks) and refresh the default filename.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  useEffect(() => {
    setSelected(loadColumnPrefs(columnsRef.current.map((c) => c.key), `export-${defaultFilename}`));
    setFilename(defaultFilename);
  }, [defaultFilename]);

  // Remember every choice the moment it changes.
  useEffect(() => {
    savePageFilter(
      `export-${defaultFilename}`,
      "columns",
      selected.length > 0 ? selected.join(",") : NONE_SENTINEL,
    );
  }, [selected, defaultFilename]);
  useEffect(() => {
    savePageFilter(`export-${defaultFilename}`, "format", format);
  }, [format, defaultFilename]);
  useEffect(() => {
    savePageFilter(`export-${defaultFilename}`, "groupBy", groupBy ? "1" : "0");
  }, [groupBy, defaultFilename]);
  useEffect(() => {
    savePageFilter(`export-${defaultFilename}`, "receipts", withReceipts ? "1" : "0");
  }, [withReceipts, defaultFilename]);

  const activeColumns = columns.filter((c) => selected.includes(c.key));

  const groups = useMemo(
    () => (grouping ? groupExportRows(rows, grouping.columnKey) : []),
    [rows, grouping],
  );
  /** Sectioning is meaningful only with 2+ distinct values. */
  const multiGroup = groups.length > 1;
  const effectiveGroups = multiGroup && groupBy ? groups : undefined;
  /** Rows in export order — grouped sections when active, natural otherwise. */
  const orderedRows = effectiveGroups ? flattenGroups(effectiveGroups) : rows;
  /** Receipts actually embedded — only meaningful for xlsx/pdf/png. */
  const activeReceipts: ExportRowReceipts | undefined =
    rowReceipts && hasReceipts && withReceipts && format !== "csv" ? rowReceipts : undefined;

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const run = async () => {
    if (activeColumns.length === 0) {
      toast.error("حداقل یک ستون را انتخاب کنید");
      return;
    }
    const name = (filename.trim() || defaultFilename).replace(/[\\/:*?"<>|]/g, "-");
    setBusy(true);
    try {
      if (format === "csv") {
        exportCsv(name, activeColumns, orderedRows);
        toast.success("خروجی CSV دانلود شد");
      } else if (format === "xlsx") {
        await exportXlsx(
          name,
          title,
          activeColumns,
          orderedRows,
          effectiveGroups,
          grouping?.photos,
          grouping?.label,
          rowPhotos,
          activeReceipts,
          { sections: summarySections, partySummary },
        );
        toast.success("خروجی اکسل دانلود شد");
      } else {
        // PDF / PNG: render the print document off-screen, wait until its
        // auto-width layout is measured (fonts loaded), then rasterize.
        setPendingDoc(true);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2500); // hard fallback
          readyCb.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        // One frame so React commits the measured layout to the DOM.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const el = docRef.current;
        if (!el) throw new Error("export doc not ready");
        if (format === "pdf") {
          await exportElementAsPdf(el, name);
          toast.success("خروجی PDF دانلود شد");
        } else {
          await exportElementAsPng(el, name);
          toast.success("خروجی تصویر دانلود شد");
        }
        setPendingDoc(false);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در تولید خروجی — دوباره تلاش کنید");
      setPendingDoc(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="خروجی گرفتن"
        subtitle={`${title} — ${rows.length} ردیف`}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-3">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
              انصراف
            </button>
            <Button variant="primary" onClick={() => void run()} loading={busy}>
              دانلود خروجی
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {extra}
          {multiGroup && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/6 p-3">
              <Checkbox
                checked={groupBy}
                onChange={() => setGroupBy((v) => !v)}
                label={`دسته‌بندی بر اساس ${grouping?.label ?? "گروه"}`}
              />
              <div className="flex items-center gap-1.5 pt-0.5 text-[10.5px] leading-4 text-ink-400">
                <Layers size={13} className="shrink-0 text-brand-500" />
                <span>
                  هر {grouping?.label ?? "گروه"} یک بخش کامل می‌شود (با عکس پروفایل کنار نام) — از بالا به پایین، یکی تمام، بعدی زیرش
                </span>
              </div>
            </div>
          )}
          {hasReceipts && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#0b9e6e]/25 bg-[#0b9e6e]/[0.05] p-3">
              <Checkbox
                checked={withReceipts}
                onChange={() => setWithReceipts((v) => !v)}
                label="درج تصویر سند زیر هر ردیف"
              />
              <div className="flex items-center gap-1.5 pt-0.5 text-[10.5px] leading-4 text-ink-400">
                <Paperclip size={13} className="shrink-0 text-[#0b9e6e]" />
                <span>
                  {Object.keys(rowReceipts!.photos).length.toLocaleString("fa-IR")} ردیف سند تصویری دارد — عکس سندِ هر تراکنش، زیر همان تراکنش چاپ می‌شود
                </span>
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-[13px] font-bold">قالب خروجی</p>
            <div className="grid grid-cols-4 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFormat(f.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-[11px] font-bold transition-all ${
                    format === f.key
                      ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300"
                      : "border-ink-900/10 text-ink-500 hover:border-brand-400 dark:border-white/10 dark:text-ink-400"
                  }`}
                >
                  <f.icon size={18} />
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-bold">ستون‌ها</p>
              <div className="flex gap-1">
                <button
                  className="btn btn-ghost btn-sm !px-2"
                  onClick={() => setSelected(columns.map((c) => c.key))}
                >
                  همه
                </button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => setSelected([])}>
                  هیچ
                </button>
              </div>
            </div>
            <div className="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto rounded-2xl border border-ink-900/8 p-2.5 dark:border-white/10">
              {columns.map((c) => (
                <Checkbox
                  key={c.key}
                  checked={selected.includes(c.key)}
                  onChange={() => toggle(c.key)}
                  label={c.header}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-bold">نام فایل</p>
            <Input
              dir="ltr"
              className="text-left"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="filename"
            />
          </div>
        </div>
      </Modal>

      {/* Off-screen print document for PDF/PNG rasterization */}
      {pendingDoc &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: "-10000px",
              zIndex: -1,
              background: "#ffffff",
            }}
            aria-hidden
          >
            <ExportDoc
              ref={docRef}
              title={title}
              subtitle={subtitle}
              columns={activeColumns}
              rows={orderedRows}
              summary={summary}
              summarySections={summarySections}
              partySummary={partySummary}
              groups={effectiveGroups}
              groupMeta={{
                photos: grouping?.photos,
                what: grouping?.label,
              }}
              rowPhotos={rowPhotos}
              rowReceipts={activeReceipts}
              theme={theme}
              onReady={() => readyCb.current?.()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
