import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Eye,
  FolderMinus,
  ImagePlus,
  Inbox,
  Pin,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Download,
  FileImage,
} from "lucide-react";
import { saveAs } from "file-saver";
import { db } from "../../db/schema";
import type { Attachment, DocType } from "../../types";
import { saveAttachment, deleteAttachment, rotateAttachmentImage } from "../../db/attachments";
import { deleteDocType, getDocTypesForCustomer } from "../../db/docTypes";
import { AiDocSortButton } from "../domain/AiDocSortButton";
import { Modal } from "./Modal";
import { useDropTarget } from "./DropZone";
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
 *
 * Every slot row and the «سایر مدارک» area are DROP TARGETS — drag files onto
 * a specific row to file them there, or drop anywhere on the profile to pick
 * a destination. Dropping directly on the AI button starts the smart filing.
 */

/** One document slot row — a top-level component so each row owns its own
 *  drop-highlight state without remounting on every parent render. */
function SlotRow({
  dt,
  files,
  busy,
  onPreview,
  onFiles,
}: {
  dt: DocType;
  files: Attachment[];
  busy: boolean;
  onPreview: (a: Attachment) => void;
  onFiles: (kind: string, files: File[]) => void;
}) {
  const { confirm } = useConfirm();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { hovering, dropHandlers } = useDropTarget((fs) => onFiles(dt.id, fs));
  const latest = files[0];

  return (
    <li
      data-slot={dt.id}
      className={`glass-soft flex items-center gap-3 rounded-2xl border p-2.5 transition-all duration-150 ${
        hovering
          ? "scale-[1.01] border-brand-400 bg-brand-500/10 ring-2 ring-brand-400/40"
          : "border-transparent"
      }`}
      {...dropHandlers}
    >
      {/* Thumbnail / empty placeholder */}
      {latest ? (
        <button
          type="button"
          className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border border-ink-900/5 dark:border-white/10"
          onClick={() => onPreview(latest)}
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
          onClick={() => inputRef.current?.click()}
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
          disabled={busy}
          onClick={() => inputRef.current?.click()}
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
              onClick={() => onPreview(latest)}
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(dt.id, files);
          e.target.value = "";
        }}
      />
    </li>
  );
}

export function DocumentSlots({ customerId }: { customerId: string }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Pending preview rotation in degrees (multiple of 90; CSS-only until saved). */
  const [rot, setRot] = useState(0);
  const [rotBusy, setRotBusy] = useState(false);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleFiles = async (kind: string, files: File[]) => {
    if (files.length === 0) return;
    setBusy(kind);
    try {
      for (const f of files) {
        await saveAttachment(customerId, kind, f);
      }
      toast.success(files.length > 1 ? `${toPersianDigits(files.length)} مدرک ذخیره شد` : "مدرک ذخیره شد");
    } catch (e) {
      console.error(e);
      toast.error("ذخیره مدرک با خطا مواجه شد");
    } finally {
      setBusy(null);
    }
  };

  // The «سایر مدارک» block is itself a drop zone (multi-file).
  const otherDrop = useDropTarget((files) => void handleFiles("other", files));

  const docList = docTypes ?? [];
  // Own (AI-created) slots render in their OWN GROUP ON TOP — right under
  // the AI button, well clear of the dates/«سایر مدارک» at the bottom — so a
  // freshly created slot is immediately visible on the profile.
  const ownSlots = docList.filter((d) => d.customerId === customerId);
  const globalSlots = docList.filter((d) => !d.customerId);

  /* --------------------- rotation (preview → persisted) -------------------- */

  // Opening another file (or closing) always starts upright.
  useEffect(() => {
    setRot(0);
  }, [preview?.id]);

  const saveRotation = async () => {
    if (!preview || rotBusy) return;
    const net = ((rot % 360) + 360) % 360;
    if (net === 0) return;
    setRotBusy(true);
    try {
      const updated = await rotateAttachmentImage(preview, net);
      setPreview(updated);
      setRot(0);
      toast.success("چرخش عکس ذخیره شد");
    } catch (e) {
      console.error(e);
      toast.error("ذخیره چرخش با خطا مواجه شد");
    } finally {
      setRotBusy(false);
    }
  };

  const rotated = Math.abs(((rot % 360) + 360) % 180) === 90;

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
        <>
          {/* Per-profile slots (AI-created for THIS customer) — on top */}
          {ownSlots.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-brand-600 dark:text-brand-300">
                <Pin size={12} className="shrink-0" />
                مخصوص این پرونده
              </p>
              <ul className="flex flex-col gap-2">
                {ownSlots.map((dt) => (
                  <SlotRow
                    key={dt.id}
                    dt={dt}
                    files={byKind(dt.id)}
                    busy={busy === dt.id}
                    onPreview={setPreview}
                    onFiles={(k, fs) => void handleFiles(k, fs)}
                  />
                ))}
              </ul>
            </div>
          )}
          {ownSlots.length > 0 && globalSlots.length > 0 && (
            <div className="h-px bg-ink-900/5 dark:bg-white/5" />
          )}
          {/* Global slots (Settings-defined, shared by every profile) */}
          {globalSlots.length > 0 && (
            <ul className="flex flex-col gap-2">
              {globalSlots.map((dt) => (
                <SlotRow
                  key={dt.id}
                  dt={dt}
                  files={byKind(dt.id)}
                  busy={busy === dt.id}
                  onPreview={setPreview}
                  onFiles={(k, fs) => void handleFiles(k, fs)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* Fixed bucket for extra files — a drop zone too */}
      <div
        className={`rounded-2xl border border-dashed transition-all duration-150 ${
          otherDrop.hovering
            ? "border-brand-400 bg-brand-500/10"
            : "border-transparent"
        }`}
        {...otherDrop.dropHandlers}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-1 pt-1">
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
            onClick={() => otherInputRef.current?.click()}
          >
            <ImagePlus size={14} />
            افزودن فایل
          </button>
          <input
            ref={otherInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void handleFiles("other", files);
              e.target.value = "";
            }}
          />
        </div>
        {others.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-300/60 px-4 py-3 text-center text-xs text-ink-400 dark:border-ink-700">
            فایل دیگری بارگذاری نشده — می‌توانید فایل‌ها را همین‌جا رها کنید
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
              className="mx-auto rounded-2xl object-contain transition-transform duration-200"
              style={{
                transform: `rotate(${rot}deg)`,
                maxHeight: rotated ? "min(58vh, 80vw)" : "64vh",
              }}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-500">
              پیش‌نمایش این نوع فایل پشتیبانی نمی‌شود — از دکمه دانلود استفاده کنید.
            </p>
          ))}
        {preview && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {preview.mime.startsWith("image/") ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  className="btn btn-glass btn-sm"
                  disabled={rotBusy}
                  onClick={() => setRot((r) => r - 90)}
                  title="چرخش به چپ"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  className="btn btn-glass btn-sm"
                  disabled={rotBusy}
                  onClick={() => setRot((r) => r + 90)}
                  title="چرخش به راست"
                >
                  <RotateCw size={15} />
                </button>
                {((rot % 360) + 360) % 360 !== 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={rotBusy}
                    onClick={() => void saveRotation()}
                  >
                    <Save size={14} />
                    ذخیره چرخش
                  </button>
                )}
              </div>
            ) : (
              <span />
            )}
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
