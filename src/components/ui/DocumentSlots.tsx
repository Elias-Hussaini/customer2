import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Eye, ImagePlus, Trash2, Download } from "lucide-react";
import { saveAs } from "file-saver";
import { db } from "../../db/schema";
import type { Attachment, AttachmentKind } from "../../types";
import { saveAttachment, deleteAttachment } from "../../db/attachments";
import { Modal } from "./Modal";
import { useToast } from "../../hooks/useToast";
import { formatTimestamp } from "../../utils/jalali";
import { formatNumber } from "../../utils/num";

export const ATTACHMENT_SLOTS: { kind: AttachmentKind; label: string; hint: string }[] = [
  { kind: "passport", label: "عکس پاسپورت", hint: "صفحه اول پاسپورت" },
  { kind: "nidFront", label: "عکس روی تذکره", hint: "روی کارت ملی/تذکره" },
  { kind: "nidBack", label: "عکس پشت تذکره", hint: "پشت کارت ملی/تذکره" },
];

/** Document slots for a customer: passport + national ID + extra files. */
export function DocumentSlots({ customerId }: { customerId: string }) {
  const toast = useToast();
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const attachments = useLiveQuery(
    () => db.attachments.where("customerId").equals(customerId).toArray(),
    [customerId],
  );

  const byKind = (kind: AttachmentKind) =>
    (attachments ?? []).filter((a) => a.kind === kind).sort((a, b) => b.createdAt - a.createdAt);

  const others = byKind("other");

  const handleFile = async (kind: AttachmentKind, file: File | undefined) => {
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

  const slotCard = (
    kind: AttachmentKind,
    label: string,
    hint: string,
    files: Attachment[],
  ) => {
    const latest = files[0];
    return (
      <div
        key={kind}
        className="glass-soft flex flex-col gap-2.5 rounded-2xl p-3.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFile(kind, e.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-bold">{label}</p>
            <p className="text-[11px] text-ink-500 dark:text-ink-400">{hint}</p>
          </div>
          <span className="chip-soft num rounded-full px-2 py-0.5 text-[10px]">
            {formatNumber(files.length)}
          </span>
        </div>

        {latest && (
          <button
            className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-ink-900/5 dark:border-white/10"
            onClick={() => setPreview(latest)}
          >
            {latest.mime.startsWith("image/") ? (
              <img
                src={URL.createObjectURL(latest.blob)}
                alt={label}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full items-center justify-center text-xs text-ink-500">
                {latest.name}
              </span>
            )}
          </button>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-glass btn-sm flex-1"
            disabled={busy === kind}
            onClick={() => fileInputs.current[kind]?.click()}
          >
            <ImagePlus size={14} />
            {latest ? "جایگزینی" : "افزودن"}
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
                title="حذف آخرین"
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
        </div>

        <input
          ref={(el) => {
            fileInputs.current[kind] = el;
          }}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => {
            void handleFile(kind, e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ATTACHMENT_SLOTS.map((s) => slotCard(s.kind, s.label, s.hint, byKind(s.kind)))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-bold">سایر مدارک</p>
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={() => fileInputs.current["other"]?.click()}
          >
            <ImagePlus size={14} />
            افزودن فایل
          </button>
          <input
            ref={(el) => {
              fileInputs.current["other"] = el;
            }}
            type="file"
            accept="image/*,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              files.forEach((f) => void handleFile("other", f));
              e.target.value = "";
            }}
          />
        </div>
        {others.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-300/60 px-4 py-4 text-center text-xs text-ink-400 dark:border-ink-700">
            فایل دیگری بارگذاری نشده است
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {others.map((a) => (
              <li
                key={a.id}
                className="glass-soft flex items-center gap-3 rounded-2xl px-3.5 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{a.name}</span>
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
