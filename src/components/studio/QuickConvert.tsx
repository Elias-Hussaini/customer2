/**
 * ابزار عکس — quick conversion board (تبدیل سریع).
 *
 * Drop or pick any mix of photos and PDFs; every PDF page is rendered into a
 * crisp image (locally, via the bundled pdf.js) and everything lands on one
 * board as tiles. From there each image can jump straight into the editor,
 * be downloaded, removed — or the whole batch saved into the studio library
 * / downloaded at once.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eraser,
  FileText,
  FolderPlus,
  ImagePlus,
  Loader2,
  Pencil,
  Trash2,
  Wand2,
} from "lucide-react";
import { saveAs } from "file-saver";
import { useToast } from "../../hooks/useToast";
import { useDropTarget } from "../ui/DropZone";
import { Button } from "../ui/Button";
import { filesToImages, type PdfPageImage } from "../../lib/studio/convert";
import { toPersianDigits } from "../../utils/jalali";

export interface BoardImage extends PdfPageImage {
  /** Object URL for the tile preview (revoked on unmount / replace). */
  url: string;
}

export function QuickConvert({
  initialFiles,
  onEdit,
}: {
  /** Files handed over from the editor tab (dropped PDFs). */
  initialFiles?: File[];
  /** Open one board image in the editor tab. */
  onEdit: (file: File, name: string) => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [board, setBoard] = useState<BoardImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  /** Bumped whenever new forwarded files arrive → the effect re-runs. */
  const [forwarded, setForwarded] = useState<File[]>(initialFiles ?? []);
  const urlCache = useRef<string[]>([]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setProgress({ label: "شروع تبدیل…", percent: 0 });
    try {
      const { images, errors } = await filesToImages(files, (label, percent) =>
        setProgress({ label, percent }),
      );
      setBoard((prev) => {
        for (const p of prev) URL.revokeObjectURL(p.url);
        const next = [
          ...prev,
          ...images.map((img) => {
            const url = URL.createObjectURL(img.blob);
            urlCache.current.push(url);
            return { ...img, url };
          }),
        ];
        return next;
      });
      if (images.length > 0) {
        toast.success(
          images.length > 1
            ? `${toPersianDigits(images.length)} تصویر آماده شد`
            : "تصویر آماده شد",
          { cause: "save" },
        );
      }
      for (const e of errors) toast.error(e);
    } catch (e) {
      console.error(e);
      toast.error("تبدیل فایل‌ها با خطا مواجه شد");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Forwarded PDFs from the editor tab convert immediately.
  useEffect(() => {
    if (forwarded.length > 0) {
      const files = forwarded;
      setForwarded([]);
      void addFiles(files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwarded]);

  useEffect(() => {
    return () => {
      for (const u of urlCache.current) URL.revokeObjectURL(u);
    };
  }, []);

  const removeAt = (idx: number) => {
    setBoard((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearAll = () => {
    setBoard((prev) => {
      for (const b of prev) URL.revokeObjectURL(b.url);
      return [];
    });
  };

  const downloadAll = () => {
    for (const b of board) saveAs(b.blob, b.name);
  };

  const saveAllToLibrary = async () => {
    if (board.length === 0) return;
    setSavingAll(true);
    try {
      const { saveStudioImage } = await import("../../db/studio");
      for (const b of board) {
        await saveStudioImage({
          folderId: null,
          name: b.name,
          mime: "image/jpeg",
          blob: b.blob,
          width: b.width,
          height: b.height,
        });
      }
      toast.success(`${toPersianDigits(board.length)} تصویر در کتابخانه ذخیره شد`, { cause: "save" });
    } catch (e) {
      console.error(e);
      toast.error("ذخیره در کتابخانه ناموفق بود");
    } finally {
      setSavingAll(false);
    }
  };

  const drop = useDropTarget((files) => void addFiles(files));

  const totals = useMemo(
    () => ({ count: board.length, bytes: board.reduce((s, b) => s + b.blob.size, 0) }),
    [board],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* -------------------------------- picker ------------------------------- */}
      <div
        className={`rounded-3xl border-2 border-dashed p-5 text-center transition-all duration-150 ${
          drop.hovering
            ? "scale-[1.005] border-brand-400 bg-brand-500/10"
            : "border-ink-300/60 bg-white/40 dark:border-ink-700 dark:bg-white/3"
        }`}
        {...drop.dropHandlers}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
          {busy ? <Loader2 size={22} className="animate-spin" /> : <Wand2 size={22} />}
        </div>
        {busy ? (
          <div className="mx-auto max-w-sm">
            <p className="text-[13px] font-bold">در حال تبدیل…</p>
            <p className="mt-1 truncate text-[11.5px] text-ink-500 dark:text-ink-400">{progress?.label}</p>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink-900/8 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${Math.max(8, progress?.percent ?? 0)}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] font-extrabold">تبدیل سریع PDF و عکس</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              فایل PDF را رها کنید — تمام صفحاتش به‌صورت خودکار به عکس تبدیل می‌شود؛ عکس‌ها هم
              مستقیم قبول می‌شوند. بعد هر تصویر را با یک ضربه ویرایش کنید. همه‌چیز همین‌جا در
              گوشی شما انجام می‌شود.
            </p>
            <Button variant="primary" size="sm" icon={ImagePlus} className="mt-3" onClick={() => inputRef.current?.click()}>
              انتخاب فایل‌ها
            </Button>
          </>
        )}
      </div>

      {/* -------------------------------- board -------------------------------- */}
      {board.length > 0 && (
        <div className="glass flex flex-col gap-3 rounded-3xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13.5px] font-extrabold">
              تخته تصاویر
              <span className="chip-soft num mr-2 rounded-full px-2 py-0.5 text-[10.5px]">
                {toPersianDigits(totals.count)}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="glass"
                icon={FolderPlus}
                loading={savingAll}
                onClick={() => void saveAllToLibrary()}
              >
                ذخیره همه در کتابخانه
              </Button>
              <Button size="sm" variant="glass" icon={Download} onClick={downloadAll}>
                دانلود همه
              </Button>
              <Button size="sm" variant="glass" icon={Eraser} className="!text-rose-600 dark:!text-rose-400" onClick={clearAll}>
                پاک کردن
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {board.map((img, i) => (
              <div
                key={`${img.name}-${i}`}
                className="glass-soft group relative overflow-hidden rounded-2xl border border-transparent transition-all hover:border-brand-300/60"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-900/5 dark:bg-white/5">
                  <img src={img.url} alt={img.name} className="h-full w-full object-cover" loading="lazy" />
                  {img.page > 1 || img.name.includes("صفحه") ? (
                    <span className="num absolute right-1.5 top-1.5 rounded-full bg-ink-950/55 px-2 py-0.5 text-[10px] font-bold text-white">
                      صفحه {toPersianDigits(img.page)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 p-2">
                  <p className="min-w-0 flex-1 truncate text-[11.5px] font-semibold" title={img.name}>
                    {img.name}
                  </p>
                  <button
                    className="icon-btn !h-7 !w-7 text-brand-600 dark:text-brand-300"
                    title="ویرایش"
                    aria-label="ویرایش"
                    onClick={() => onEdit(new File([img.blob], img.name, { type: "image/jpeg" }), img.name)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-btn !h-7 !w-7"
                    title="دانلود"
                    aria-label="دانلود"
                    onClick={() => saveAs(img.blob, img.name)}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    className="icon-btn !h-7 !w-7 hover:!text-rose-600"
                    title="حذف"
                    aria-label="حذف"
                    onClick={() => removeAt(i)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {board.length === 0 && !busy && (
        <div className="glass flex flex-col items-center gap-2.5 rounded-3xl px-6 py-12 text-center">
          <FileText size={30} className="text-ink-400" />
          <p className="text-[13.5px] font-extrabold">تخته خالی است</p>
          <p className="max-w-sm text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            یک PDF رها کنید تا صفحاتش به‌صورت عکس بیاید؛ بعد می‌توانید سریع هر کدام را ویرایش
            کنید، دانلود کنید یا همه را یک‌جا در کتابخانه ذخیره کنید.
          </p>
        </div>
      )}
    </div>
  );
}
