/**
 * ProfileDocsManager — «ادیت مدارک» for BOTH customers and employers.
 *
 * One full-screen manager for the profile's document archive:
 *  - import by drag & drop / picker / paste; PDFs are expanded into pages
 *    DETERMINISTICALLY (pdf.js renders, blank pages are dropped — no cloud
 *    AI, no guessing) and every item gets a user-typed title (عنوان);
 *  - every stored document: inline rename, open in ابزار عکس (crop/resize/
 *    compress/rotate right there), download, delete;
 *  - PDFs: convert to per-page images right here.
 *
 * The customer variant files into the existing doc-slot system; the
 * employer variant is a flat titled archive.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FileImage,
  FileText,
  ImagePlus,
  Loader2,
  Pencil,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { saveAs } from "file-saver";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useDropTarget, useFilesDragging } from "../ui/DropZone";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { db } from "../../db/schema";
import {
  deleteAttachment,
  renameAttachment,
  saveAttachment,
  saveAttachmentDataUrl,
  saveEmployerAttachment,
  saveEmployerAttachmentDataUrl,
} from "../../db/attachments";
import { getDocTypesForCustomer } from "../../db/docTypes";
import { renderPdfPagesForImport } from "../../lib/ai/imaging";
import { openStudioFor } from "../../lib/studio/session";
import { formatNumber } from "../../utils/num";
import { toPersianDigits } from "../../utils/jalali";
import type { Attachment, DocType } from "../../types";

export interface DocsTarget {
  kind: "customer" | "employer";
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  target: DocsTarget;
  /** Files dropped on the profile page — go straight into staging. */
  initialFiles?: File[] | null;
}

/** One staged item waiting for a title (+ slot) before saving. */
interface StageItem {
  key: string;
  /** Image files come as File; PDF pages arrive as rendered data URLs. */
  file?: File;
  dataUrl?: string;
  title: string;
  slot: string;
  isPdfPage: boolean;
}

const isPdf = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

const isImage = (f: File) =>
  f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|avif|heic)$/i.test(f.name);

let stageSeq = 0;

export function ProfileDocsManager({ open, onClose, target, initialFiles }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const [stage, setStage] = useState<StageItem[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [slotByStageKey, setSlotByStageKey] = useState<Record<string, string>>({});

  const docTypes = useLiveQuery(
    () => (target.kind === "customer" ? getDocTypesForCustomer(target.id) : Promise.resolve([] as DocType[])),
    [target.kind, target.id],
  );

  const docs = useLiveQuery(
    () =>
      target.kind === "customer"
        ? db.attachments.where("customerId").equals(target.id).sortBy("createdAt")
        : db.attachments.where("employerId").equals(target.id).sortBy("createdAt"),
    [target.kind, target.id],
  );

  const addFiles = useRef<(files: File[]) => void>(() => undefined);
  addFiles.current = (files: File[]) => void addFilesImpl(files);

  const addFilesImpl = async (files: File[]) => {
    if (!files.length) return;
    const items: StageItem[] = [];
    let blanksTotal = 0;
    // Plain images stage instantly; PDFs render afterwards (they take time,
    // and nothing should make the photos wait behind a PDF).
    const images = files.filter((f) => !isPdf(f) && isImage(f));
    const pdfs = files.filter((f) => isPdf(f));
    for (const file of images) {
      items.push({
        key: `s${++stageSeq}`,
        file,
        title: file.name.replace(/\.[a-z0-9]{1,6}$/i, ""),
        slot: "other",
        isPdfPage: false,
      });
    }
    if (images.length > 0) setStage((prev) => [...prev, ...items]);
    const staged: StageItem[] = [];
    for (const file of pdfs) {
      setBusyLabel(`در حال تبدیل PDF «${file.name}» به تصویر…`);
      try {
        const { pages, blanksRemoved, truncated } = await renderPdfPagesForImport(file, {
          maxPages: 40,
        });
        blanksTotal += blanksRemoved;
        for (const page of pages) {
          staged.push({
            key: `s${++stageSeq}`,
            dataUrl: page.dataUrl,
            title: `صفحهٔ ${toPersianDigits(page.index)} — ${file.name.replace(/\.pdf$/i, "")}`,
            slot: "other",
            isPdfPage: true,
          });
        }
        if (truncated) {
          toast.info("این PDF بیشتر از ۴۰ صفحه داشت — ۴۰ صفحهٔ اول تبدیل شد");
        }
      } catch (e) {
        console.error(e);
        toast.error(`تبدیل «${file.name}» به تصویر ممکن نشد`);
      } finally {
        setBusyLabel(null);
      }
    }
    for (const file of files) {
      if (!isPdf(file) && !isImage(file)) {
        toast.error(`«${file.name}»: فقط عکس و PDF پذیرفته می‌شود`);
      }
    }
    if (blanksTotal > 0) {
      toast.info(`${toPersianDigits(blanksTotal)} صفحهٔ خالی خودکار حذف شد`);
    }
    if (staged.length > 0) setStage((prev) => [...prev, ...staged]);
  };

  // Dropped-on-profile files flow straight into staging when the manager opens.
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      void addFiles.current([...initialFiles]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  // Reset staging when the manager closes.
  useEffect(() => {
    if (!open) {
      setStage([]);
      setSlotByStageKey({});
      setBusyLabel(null);
    }
  }, [open]);

  const dragging = useFilesDragging();
  const modalDrop = useDropTarget((files) => void addFiles.current(files));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveAll = async () => {
    if (stage.length === 0 || busyLabel) return;
    setBusyLabel("ذخیره…");
    let ok = 0;
    try {
      for (const item of stage) {
        const title = item.title.trim() || "سند";
        if (target.kind === "customer") {
          if (item.isPdfPage && item.dataUrl) {
            await saveAttachmentDataUrl(target.id, item.slot, item.dataUrl, title);
          } else if (item.file) {
            await saveAttachment(target.id, item.slot, item.file, title);
          }
        } else if (item.isPdfPage && item.dataUrl) {
          await saveEmployerAttachmentDataUrl(target.id, item.dataUrl, title);
        } else if (item.file) {
          await saveEmployerAttachment(target.id, item.file, title);
        }
        ok++;
      }
      toast.success(
        ok > 1
          ? `${toPersianDigits(ok)} سند با عنوان‌های شما ذخیره شد`
          : "سند با عنوان شما ذخیره شد",
      );
      setStage([]);
    } catch (e) {
      console.error(e);
      toast.error("ذخیره اسناد با خطا مواجه شد");
    } finally {
      setBusyLabel(null);
    }
  };

  /* ----------------------------- stored docs UI ---------------------------- */

  const slotLabel = (kind: string): string => {
    if (kind === "other") return "سایر مدارک";
    if (kind === "receipt") return "رسید پرداخت";
    const dt = (docTypes ?? []).find((d) => d.id === kind);
    return dt?.label ?? kind;
  };

  const groups = useMemo(() => {
    const list = docs ?? [];
    if (target.kind === "employer") {
      return [{ label: "اسناد کارفرما", items: list }];
    }
    const map = new Map<string, Attachment[]>();
    for (const a of list) {
      const key = a.paymentId ? "receipt" : a.kind;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].map(([kind, items]) => ({ label: slotLabel(kind), items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, docTypes, target.kind]);

  const openInStudio = (att: Attachment) => {
    if (!att.mime.startsWith("image/")) return;
    openStudioFor({ kind: "attachment", attachment: att });
    onClose();
    navigate("/studio");
  };

  const convertPdf = async (att: Attachment) => {
    if (!att.mime.includes("pdf")) return;
    setBusyLabel(`در حال تبدیل «${att.name}» به تصویر…`);
    try {
      const file = new File([att.blob], att.name, { type: att.mime });
      const { pages, blanksRemoved, truncated } = await renderPdfPagesForImport(file, {
        maxPages: 40,
      });
      for (const page of pages) {
        const title = `صفحهٔ ${toPersianDigits(page.index)} — ${att.name.replace(/\.pdf$/i, "")}`;
        if (target.kind === "customer") {
          await saveAttachmentDataUrl(target.id, "other", page.dataUrl, title);
        } else {
          await saveEmployerAttachmentDataUrl(target.id, page.dataUrl, title);
        }
      }
      if (blanksRemoved > 0) toast.info(`${toPersianDigits(blanksRemoved)} صفحهٔ خالی خودکار حذف شد`);
      if (truncated) toast.info("این PDF بیشتر از ۴۰ صفحه داشت — ۴۰ صفحهٔ اول تبدیل شد");
      toast.success(`${toPersianDigits(pages.length)} تصویر با عنوان صفحه اضافه شد`);
    } catch (e) {
      console.error(e);
      toast.error("تبدیل PDF ممکن نشد");
    } finally {
      setBusyLabel(null);
    }
  };

  const removeDoc = async (att: Attachment) => {
    const ok = await confirm({
      title: `حذف «${att.name}»؟`,
      message: "فایل برای همیشه از این پرونده حذف می‌شود.",
      danger: true,
      confirmLabel: "حذف",
    });
    if (!ok) return;
    await deleteAttachment(att.id);
    toast.info("سند حذف شد");
  };

  const totalBytes = (docs ?? []).reduce((s, d) => s + d.size, 0);

  return (
    <>
      <Modal
        open={open}
        onClose={busyLabel ? () => undefined : onClose}
        title={`ادیت مدارک — ${target.name}`}
        subtitle={`${toPersianDigits(docs?.length ?? 0)} سند • ${formatNumber(totalBytes)} بایت${target.kind === "customer" ? " • پروندهٔ مشتری" : " • پروندهٔ کارفرما"}`}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                className="btn btn-glass btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!busyLabel}
              >
                <ImagePlus size={14} /> انتخاب فایل / PDF
              </button>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={!!busyLabel}>
                بستن
              </button>
              {stage.length > 0 && (
                <Button variant="primary" onClick={() => void saveAll()} loading={!!busyLabel}>
                  ذخیرهٔ {toPersianDigits(stage.length)} سند
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div
          className="flex flex-col gap-5"
          {...(dragging && open ? modalDrop.dropHandlers : {})}
          onPaste={(e) => {
            if (!open) return;
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) void addFiles.current(files);
          }}
        >
          {busyLabel && (
            <div className="flex items-center gap-2 rounded-2xl bg-brand-500/10 px-4 py-3 text-[12.5px] font-bold text-brand-700 dark:text-brand-200">
              <Loader2 size={15} className="animate-spin" /> {busyLabel}
            </div>
          )}

          {/* -------- staging -------- */}
          <section className="rounded-3xl border border-ink-900/5 p-4 dark:border-white/10">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[13px] font-extrabold">
                افزودن مدارک
                <span className="mr-2 text-[11px] font-bold text-ink-400">
                  عنوان هر سند را خودتان می‌نویسید — PDFها صفحه‌به‌صفحه تبدیل می‌شوند و صفحات خالی خودکار حذف می‌شوند
                </span>
              </p>
            </div>

            {stage.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-900/15 py-8 text-center dark:border-white/15">
                <FileImage size={26} className="text-ink-300 dark:text-ink-600" />
                <p className="text-[12px] text-ink-500 dark:text-ink-400">
                  فایل یا PDF را همین‌جا بکشید و رها کنید، بچسبانید، یا «انتخاب فایل» را بزنید
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {stage.map((item) => {
                  const thumb = item.dataUrl ?? (item.file ? URL.createObjectURL(item.file) : "");
                  const slot = slotByStageKey[item.key] ?? item.slot;
                  return (
                    <div
                      key={item.key}
                      className="glass flex flex-wrap items-center gap-3 rounded-2xl p-2.5"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/60 dark:bg-white/10">
                        {thumb ? (
                          <img src={thumb} alt={item.title} className="h-full w-full object-cover" />
                        ) : (
                          <FileText size={20} className="text-ink-300" />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <input
                          className="field !py-1.5 text-[12.5px]"
                          value={item.title}
                          onChange={(e) =>
                            setStage((prev) =>
                              prev.map((s) => (s.key === item.key ? { ...s, title: e.target.value } : s)),
                            )
                          }
                          placeholder="عنوان این سند…"
                        />
                        {target.kind === "customer" && (
                          <select
                            className="field !py-1.5 text-[12px]"
                            value={slot}
                            onChange={(e) =>
                              setSlotByStageKey((prev) => ({ ...prev, [item.key]: e.target.value }))
                            }
                          >
                            <option value="other">سایر مدارک</option>
                            {(docTypes ?? [])
                              .filter((d) => !d.archivedAt)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.label}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                      {item.isPdfPage && (
                        <span className="chip shrink-0 !text-[10px]">از PDF</span>
                      )}
                      <button
                        type="button"
                        className="icon-btn !h-8 !w-8 shrink-0 !text-rose-500"
                        title="حذف از فهرست"
                        onClick={() => setStage((prev) => prev.filter((s) => s.key !== item.key))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* -------- stored documents -------- */}
          <section className="flex flex-col gap-4">
            {(docs ?? []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-ink-900/15 py-8 text-center text-[12px] text-ink-400 dark:border-white/15">
                هنوز سندی در این پرونده نیست.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[12px] font-extrabold text-ink-600 dark:text-ink-300">
                    {group.label}
                    <span className="mr-1.5 text-[10.5px] font-bold text-ink-400">
                      ({toPersianDigits(group.items.length)})
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {group.items.map((att) => (
                      <DocCard
                        key={att.id}
                        att={att}
                        onRename={async (name) => {
                          await renameAttachment(att.id, name);
                          toast.success("عنوان سند ذخیره شد");
                        }}
                        onEditInStudio={att.mime.startsWith("image/") ? () => openInStudio(att) : undefined}
                        onConvertPdf={att.mime.includes("pdf") ? () => void convertPdf(att) : undefined}
                        onDownload={() => saveAs(att.blob, att.name)}
                        onDelete={() => void removeDoc(att)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addFiles.current(files);
        }}
      />
    </>
  );
}

/* ------------------------------ doc card ------------------------------ */

function DocCard({
  att,
  onRename,
  onEditInStudio,
  onConvertPdf,
  onDownload,
  onDelete,
}: {
  att: Attachment;
  onRename: (name: string) => Promise<void> | void;
  onEditInStudio?: () => void;
  onConvertPdf?: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(att.name);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (att.mime.startsWith("image/")) {
      url = URL.createObjectURL(att.blob);
      setThumb(url);
    } else {
      setThumb(null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [att]);

  return (
    <div className="glass flex flex-col gap-1.5 rounded-2xl p-2.5 text-[11px]">
      <div className="flex items-start justify-between gap-1.5">
        {editing ? (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <input
              autoFocus
              className="field !py-1 text-[11.5px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  setEditing(false);
                  if (draft.trim() && draft.trim() !== att.name) await onRename(draft);
                }
              }}
            />
            <button
              className="icon-btn !h-7 !w-7"
              title="ذخیره عنوان"
              onClick={async () => {
                setEditing(false);
                if (draft.trim() && draft.trim() !== att.name) await onRename(draft);
              }}
            >
              <Pencil size={12} />
            </button>
          </span>
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-right font-bold"
            title={`${att.name} — برای تغییر عنوان بزنید`}
            onClick={() => {
              setDraft(att.name);
              setEditing(true);
            }}
          >
            {att.name}
          </button>
        )}
        <span className="num shrink-0 text-[10px] text-ink-400">
          {formatNumber(att.size)}B
        </span>
      </div>

      <span className="flex h-24 items-center justify-center overflow-hidden rounded-xl bg-white/60 dark:bg-white/10">
        {thumb ? (
          <img src={thumb} alt={att.name} className="h-full w-full object-cover" />
        ) : (
          <FileText size={26} className="text-ink-300 dark:text-ink-600" />
        )}
      </span>

      <div className="flex flex-wrap gap-1">
        {onEditInStudio && (
          <button
            className="chip !px-2 !py-1 !text-[10px] !text-brand-600 dark:!text-brand-300"
            title="باز کردن در ابزار عکس — برش، سایز، فشرده‌سازی و ذخیرهٔ درجا"
            onClick={onEditInStudio}
          >
            <Wand2 size={11} /> ویرایش
          </button>
        )}
        {onConvertPdf && (
          <button
            className="chip !px-2 !py-1 !text-[10px] !text-brand-600 dark:!text-brand-300"
            title="تبدیل این PDF به تصاویر صفحه‌به‌صفحه"
            onClick={onConvertPdf}
          >
            <FileImage size={11} /> تبدیل به عکس
          </button>
        )}
        <button className="chip !px-2 !py-1 !text-[10px]" title="دانلود" onClick={onDownload}>
          دانلود
        </button>
        <button
          className="chip !px-2 !py-1 !text-[10px] !text-rose-500"
          title="حذف"
          onClick={onDelete}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
