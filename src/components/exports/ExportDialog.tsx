import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, FileText, FileType2, Image } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Checkbox } from "../ui/fields";
import type { ExportColumn, ExportRow } from "../../utils/export/tabular";
import { exportCsv, exportXlsx } from "../../utils/export/tabular";
import { exportElementAsPdf, exportElementAsPng } from "../../utils/export/raster";
import { ExportDoc } from "./ExportDoc";
import { useToast } from "../../hooks/useToast";

type Format = "xlsx" | "csv" | "pdf" | "png";

const FORMATS: { key: Format; label: string; icon: typeof FileText }[] = [
  { key: "xlsx", label: "اکسل", icon: FileSpreadsheet },
  { key: "csv", label: "CSV", icon: FileType2 },
  { key: "pdf", label: "PDF", icon: FileText },
  { key: "png", label: "تصویر PNG", icon: Image },
];

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: ExportRow[];
  defaultFilename: string;
  summary?: { label: string; value: string }[];
  extra?: ReactNode;
}

/**
 * Universal export dialog: pick columns + format, then generate XLSX/CSV
 * (data) or PDF/PNG (rasterized print document with full Persian support).
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
  extra,
}: ExportDialogProps) {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(columns.map((c) => c.key));
  const [format, setFormat] = useState<Format>("xlsx");
  const [filename, setFilename] = useState(defaultFilename);
  const [busy, setBusy] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const [pendingDoc, setPendingDoc] = useState(false);
  const readyCb = useRef<(() => void) | null>(null);

  const activeColumns = columns.filter((c) => selected.includes(c.key));

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const run = async () => {
    if (activeColumns.length === 0) {
      toast.error("حداقل یک ستون را انتخاب کنید");
      return;
    }
    const name = (filename.trim() || defaultFilename).replace(/[\\/:*?"<>|]/g, "-");
    const dataRows = rows;
    setBusy(true);
    try {
      if (format === "csv") {
        exportCsv(name, activeColumns, dataRows);
        toast.success("خروجی CSV دانلود شد");
      } else if (format === "xlsx") {
        await exportXlsx(name, title, activeColumns, dataRows);
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
              rows={rows}
              summary={summary}
              onReady={() => readyCb.current?.()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
