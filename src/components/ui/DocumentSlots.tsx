import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Eye, FolderMinus, ImagePlus, Inbox, Trash2, Download, FileImage } from "lucide-react";
import { saveAs } from "file-saver";
import { db } from "../../db/schema";
import type { Attachment, DocType } from "../../types";
import { saveAttachment, deleteAttachment } from "../../db/attachments";
import { deleteDocType, getDocTypesForCustomer } from "../../db/docTypes";
import { AiDocSortButton } from "../domain/AiDocSortButton";
import { Modal } from "./Modal";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatTimestamp } from "../../utils/jalali";
import { formatNumber } from "../../utils/num";
import { toPersianDigits } from "../../utils/jalali";

/**
 * Documents & images section of a customer.
 *
 * The slots are data-driven: global slots come from the `docTypes` table and
 * are managed in Settings → مدارک و تصاویر; slots with a `customerId` belong
 * to THIS profile only (created by the AI smart filing) and can be removed
 * right here. "other" is a fixed bucket for extra files; receipt photos live
 * on payments.
 */
export function DocumentSlots({ customerId }: { customerId: string }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const attachments = useLiveQuery(
    () => db.attachments.where("customerId").equals(customerId).toArray(),
    [customerId],
  );

  // Global slots + this customer's own slots (AI-created ones never leak
  // into other profiles).
  const docTypes = useLiveQuery(() => getDocTypesForCustomer(customerId), [customerId]);

  const byKind = (kind: string) =>
    (attachments ?? []).filter((a) => a.kind === kind).sort((a, b) => b.createdAt - a.createdAt);

  const others = byKind("other");

  const handleFile = async (kind: string, file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    try {
      await saveAttachment(customerId, kind, file);
      toast.success("مدرک ذخیره شد");
    } catch (e) {
      console.error(e);
      toast.error("ذخیره مدرک با خطا مواجه شد");
    } finally {
      setBusy(null);
    }
  };

  const hiddenInput = (kind: string, multiple = false) => (
    <input
      ref={(el) => {
        fileInputs.current[kind] = el;
      }}
      type="file"
      accept="image/*,.pdf"
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        if (multiple) {
          const files = Array.from(e.target.files ?? []);
          files.forEach((f) => void handleFile(kind, f));
        } else {
          void handleFile(kind, e.target.files?.[0]);
        }
        e.target.value = "";
      }}
    />
  );

  /** Compact single-line slot: thumb + one-line texts + icon actions. */
  const slotRow = (dt: DocType, files: Attachment[]) => {
    const latest = files[0];
    return (
      <li
        key={dt.id}
        className="glass-soft flex items-center gap-3 rounded-2xl p-2.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFile(dt.id, e.dataTransfer.files?.[0]);
        }}
      >
        {/* Thumbnail / empty placeholder */}
        {latest ? (
          <button
            type="button"
            className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border border-ink-900/5 dark:border-white/10"
            onClick={() => setPreview(latest)}
            aria-label={`مشاهده ${dt.label}`}
          >
            {latest.mime.startsWith("image/") ? (
              <img
                src={URL.createObjectURL(latest.blob)}
                alt={dt.label}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-400">
                <FileImage size={20} />
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] border border-dashed border-ink-300/70 text-ink-400 transition-colors hover:border-brand-400 hover:text-brand-500 dark:border-ink-700"
            onClick={() => fileInputs.current[dt.id]?.click()}
            aria-label={`افزودن ${dt.label}`}
          >
            <ImagePlus size={20} />
          </button>
        )}

        {/* One-line texts — never wrap into the mess below */}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-bold" title={dt.label}>
              {dt.label}
            </span>
            {dt.customerId && (
              <span
                className="chip-soft shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[9.5px] font-bold text-brand-600 dark:text-brand-300"
                title="این بخش فقط برای همین مشتری است"
              >
                مخصوص این پرونده
              </span>
            )}
            {files.length > 1 && (
              <span className="chip-soft num shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                {toPersianDigits(files.length)}
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">
            {latest ? formatTimestamp(latest.createdAt) : "بارگذاری نشده"}
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="icon-btn !h-8 !w-8 text-brand-600 dark:text-brand-300"
            title={latest ? "جایگزینی با فایل جدید" : "افزودن"}
            aria-label={latest ? "جایگزینی" : "افزودن"}
            disabled={busy === dt.id}
            onClick={() => fileInputs.current[dt.id]?.click()}
          >
            <ImagePlus size={15} />
          </button>
          {latest && (
            <>
              <button
                type="button"
                className="icon-btn !h-8 !w-8"
                title="مشاهده"
                aria-label="مشاهده"
                onClick={() => setPreview(latest)}
              >
                <Eye size={15} />
              </button>
              <button
                type="button"
                className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                title="حذف"
                aria-label="حذف"
                onClick={async () => {
                  await deleteAttachment(latest.id);
                  toast.info("مدرک حذف شد");
                }}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
          {dt.customerId && (
            <button
              type="button"
              className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
              title="حذف این بخش (فایل‌ها به «سایر مدارک» منتقل می‌شوند)"
              aria-label="حذف این بخش"
              onClick={async () => {
                const ok = await confirm({
                  title: `حذف بخش «${dt.label}» از همین پرونده؟`,
                  message:
                    "این بخش فقط برای همین مشتری است. فایل‌های داخلش حذف نمی‌شوند؛ به «سایر مدارک» منتقل می‌شوند.",
                  confirmLabel: "حذف بخش",
                });
                if (ok) {
                  await deleteDocType(dt.id, dt.label);
                  toast.info("بخش حذف شد");
                }
              }}
            >
              <FolderMinus size={15} />
            </button>
          )}
        </div>
        {hiddenInput(dt.id)}
      </li>
    );
  };

  const docList = docTypes ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Smart AI filing — picks any mix of photos/PDFs and files them */}
      <div className="flex justify-end">
        <AiDocSortButton customerId={customerId} />
      </div>
      {docList.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-300/60 px-4 py-5 text-center text-xs leading-6 text-ink-400 dark:border-ink-700">
          هنوز نوع مدرکی تعریف نشده — از تنظیمات ← «مدارک و تصاویر» اضافه کنید
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{docList.map((dt) => slotRow(dt, byKind(dt.id)))}</ul>
      )}

      {/* Fixed bucket for extra files */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold">
            سایر مدارک
            {others.length > 0 && (
              <span className="chip-soft num mr-2 rounded-full px-2 py-0.5 text-[10px]">
                {toPersianDigits(others.length)}
              </span>
            )}
          </p>
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={() => fileInputs.current["other"]?.click()}
          >
            <ImagePlus size={14} />
            افزودن فایل
          </button>
          {hiddenInput("other", true)}
        </div>
        {others.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-300/60 px-4 py-3 text-center text-xs text-ink-400 dark:border-ink-700">
            فایل دیگری بارگذاری نشده است
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {others.map((a) => (
              <li
                key={a.id}
                className="glass-soft flex items-center gap-3 rounded-2xl px-3 py-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  {a.mime.startsWith("image/") ? <FileImage size={16} /> : <Inbox size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{a.name}</span>
                  <span className="text-[11px] text-ink-400">
                    {formatNumber(Math.round(a.size / 1024))} کیلوبایت • {formatTimestamp(a.createdAt)}
                  </span>
                </span>
                <button
                  className="icon-btn !h-8 !w-8"
                  aria-label="مشاهده"
                  onClick={() => setPreview(a)}
                >
                  <Eye size={15} />
                </button>
                <button
                  className="icon-btn !h-8 !w-8"
                  aria-label="دانلود"
                  onClick={() => saveAs(a.blob, a.name)}
                >
                  <Download size={15} />
                </button>
                <button
                  className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                  aria-label="حذف"
                  onClick={async () => {
                    await deleteAttachment(a.id);
                    toast.info("فایل حذف شد");
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={preview != null} onClose={() => setPreview(null)} size="lg" title={preview?.name}>
        {preview &&
          (preview.mime.startsWith("image/") ? (
            <img
              src={URL.createObjectURL(preview.blob)}
              alt={preview.name}
              className="mx-auto max-h-[64vh] rounded-2xl object-contain"
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-500">
              پیش‌نمایش این نوع فایل پشتیبانی نمی‌شود — از دکمه دانلود استفاده کنید.
            </p>
          ))}
        {preview && (
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-glass" onClick={() => saveAs(preview.blob, preview.name)}>
              <Download size={15} />
              دانلود
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
