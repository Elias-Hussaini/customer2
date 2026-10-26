/**
 * «افزودن با هوش مصنوعی» — smart document filing for one customer.
 *
 * The user picks any mix of photos and PDFs. The pipeline:
 *   1. PDFs are rendered to page images locally (pdf.js), photos normalized.
 *   2. Combined scans (e.g. front+back of a tazkira on one page) are cut
 *      apart locally by gutter detection.
 *   3. Every image is sent to the user's Cloudflare AI worker together with
 *      the customer's CURRENT document slots — the model answers where each
 *      image belongs: a slot, the profile photo, a NEW custom slot, or «سایر».
 *   4. Images are saved to their destinations and a summary is shown.
 */

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Settings2,
  Sparkles,
} from "lucide-react";
import { db } from "../../db/schema";
import {
  AiAllWorkersFailedError,
  ACCEPTED_MIME,
  aiChat,
  buildDocSortMessages,
  imageFileToJpeg,
  parseDocSortReply,
  pdfToJpegs,
  splitCombinedImage,
  useAiWorkers,
  validateAiFile,
  type DocSortResult,
} from "../../lib/ai";
import { createDocType } from "../../db/docTypes";
import { saveAttachmentDataUrl } from "../../db/attachments";
import { dataUrlToSquareDataUrl, setCustomerPhoto } from "../../db/photos";
import { customerFullName } from "../../db/customers";
import { Modal } from "../ui/Modal";
import { useToast } from "../../hooks/useToast";
import { toPersianDigits } from "../../utils/jalali";

/** Images per AI request (context/cost safety — extra images go in a 2nd batch). */
const CHUNK = 6;
/** Hard cap on images per run (after splitting). */
const MAX_IMAGES = 18;

interface Piece {
  dataUrl: string;
  /** Origin file name — used when the piece lands in «سایر». */
  origin: string;
}

interface Outcome {
  results: DocSortResult[];
  pieces: string[];
  newSlots: string[];
  skippedPhoto: boolean;
  truncated: boolean;
}

type RunState =
  | { t: "idle" }
  | { t: "busy"; label: string; percent: number }
  | { t: "done"; outcome: Outcome }
  | { t: "error"; message: string; needsSetup?: boolean };

export function AiDocSortButton({ customerId }: { customerId: string }) {
  const toast = useToast();
  const workers = useAiWorkers();
  const hasWorker = (workers ?? []).some((w) => w.enabled && w.url.trim() && w.key.trim());
  const fileRef = useRef<HTMLInputElement>(null);
  const [run, setRun] = useState<RunState>({ t: "idle" });

  const stage = (label: string, percent: number) =>
    setRun((cur) => (cur.t === "busy" ? { t: "busy", label, percent } : cur));

  const pick = () => fileRef.current?.click();

  const start = async (files: File[]) => {
    if (files.length === 0) return;
    if (!hasWorker) {
      setRun({
        t: "error",
        message: "هوش مصنوعی هنوز تنظیم نشده — اول ورکر Cloudflare را در تنظیمات اضافه کنید.",
        needsSetup: true,
      });
      return;
    }
    for (const f of files) {
      const err = validateAiFile(f);
      if (err) {
        setRun({ t: "error", message: err });
        return;
      }
    }

    setRun({ t: "busy", label: "آماده‌سازی فایل‌ها…", percent: 4 });
    try {
      /* ---- 1) convert: PDF → page images, photos → normalized JPEG ---- */
      const pieces: Piece[] = [];
      let truncated = false;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (isPdf) {
          const pages = await pdfToJpegs(file, (p) =>
            stage(
              `تبدیل PDF به عکس — صفحهٔ ${p.page.toLocaleString("fa-IR")} از ${p.totalPages.toLocaleString("fa-IR")}`,
              4 + Math.round(((i + p.page / p.totalPages) / files.length) * 30),
            ),
          );
          for (let n = 0; n < pages.length; n++) {
            if (pieces.length >= MAX_IMAGES) {
              truncated = true;
              break;
            }
            const base = file.name.replace(/\.pdf$/i, "");
            pieces.push({ dataUrl: pages[n], origin: `${base || "صفحه"}-ص${n + 1}.jpg` });
          }
        } else {
          stage(
            `آماده‌سازی تصویر ${(i + 1).toLocaleString("fa-IR")} از ${files.length.toLocaleString("fa-IR")}`,
            4 + Math.round(((i + 1) / files.length) * 30),
          );
          if (pieces.length >= MAX_IMAGES) {
            truncated = true;
            continue;
          }
          const img = await imageFileToJpeg(file);
          pieces.push({ dataUrl: img, origin: file.name || "تصویر.jpg" });
        }
      }
      if (pieces.length === 0) {
        setRun({ t: "error", message: "از این فایل‌ها هیچ تصویری ساخته نشد — فایل دیگری امتحان کنید." });
        return;
      }

      /* ---- 2) cut combined scans apart (front+back on one page) ---- */
      stage("بررسی صفحات ترکیبی (جداکردن روی و پشت یک صفحه)…", 36);
      const expanded: Piece[] = [];
      for (const piece of pieces) {
        const report = await splitCombinedImage(piece.dataUrl);
        if (report.images.length === 1) {
          expanded.push(piece);
        } else {
          for (let n = 0; n < report.images.length && expanded.length < MAX_IMAGES; n++) {
            const base = piece.origin.replace(/\.[a-z0-9]+$/i, "");
            expanded.push({ dataUrl: report.images[n], origin: `${base}-بخش${n + 1}.jpg` });
          }
        }
      }
      const images = expanded.map((p) => p.dataUrl);

      /* ---- 3) classify in chunks through the failover chain ---- */
      const docTypes = (await db.docTypes.toArray())
        .filter((d) => !d.archivedAt)
        .sort((a, b) => a.order - b.order);
      const slots = docTypes.map((d) => ({ id: d.id, label: d.label }));

      const results: DocSortResult[] = [];
      const chunks = Math.ceil(images.length / CHUNK);
      for (let c = 0; c < chunks; c++) {
        const slice = images.slice(c * CHUNK, (c + 1) * CHUNK);
        const { text } = await aiChat(buildDocSortMessages(slice, slots), {
          maxTokens: 1024,
          temperature: 0.1,
          onAttempt: ({ worker, index, total }) =>
            stage(
              total > 1 && index > 0
                ? `حساب قبلی خطا داد — تلاش با «${worker.label}»…`
                : `ارسال ${toPersianDigits(c + 1)} از ${toPersianDigits(chunks)} به هوش مصنوعی (${worker.label})…`,
              40 + Math.round(((c + 0.6) / chunks) * 45),
            ),
        });
        stage(`خواندن پاسخ ${toPersianDigits(c + 1)} از ${toPersianDigits(chunks)}…`, 40 + Math.round(((c + 1) / chunks) * 45));
        const part = parseDocSortReply(text, slots, slice.length);
        results.push(...part.map((r) => ({ ...r, index: r.index + c * CHUNK })));
      }

      /* ---- 4) apply: create new slots, save attachments, set profile photo ---- */
      stage("ذخیره در جای خودش…", 90);
      const customer = await db.customers.get(customerId);
      const customerName = customer ? customerFullName(customer) : "مشتری";

      // Create AI-proposed slots first (dedupe by label).
      const newLabels: string[] = [];
      const newIdByLabel = new Map<string, string>();
      for (const r of results) {
        if (r.target.kind !== "new") continue;
        const key = r.target.label;
        if (newIdByLabel.has(key)) continue;
        const existing = docTypes.find((d) => d.label === key);
        if (existing) {
          newIdByLabel.set(key, existing.id);
          continue;
        }
        const dt = await createDocType({ label: key });
        newIdByLabel.set(key, dt.id);
        newLabels.push(key);
      }

      let skippedPhoto = false;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const piece = expanded[i];
        if (!piece) continue;
        if (r.target.kind === "photo") {
          if (customer && !customer.photo) {
            const square = await dataUrlToSquareDataUrl(piece.dataUrl);
            await setCustomerPhoto(customerId, square, customerName);
          } else {
            // Profile photo already exists — keep the user's choice, keep the image.
            await saveAttachmentDataUrl(customerId, "other", piece.dataUrl, "عکس شخصی.jpg");
            skippedPhoto = true;
          }
        } else if (r.target.kind === "slot") {
          await saveAttachmentDataUrl(
            customerId,
            r.target.slotId,
            piece.dataUrl,
            `${r.target.label}.jpg`,
          );
        } else if (r.target.kind === "new") {
          const slotId = newIdByLabel.get(r.target.label);
          if (slotId) {
            await saveAttachmentDataUrl(customerId, slotId, piece.dataUrl, `${r.target.label}.jpg`);
          } else {
            await saveAttachmentDataUrl(customerId, "other", piece.dataUrl, piece.origin);
          }
        } else {
          await saveAttachmentDataUrl(customerId, "other", piece.dataUrl, piece.origin);
        }
      }

      setRun({
        t: "done",
        outcome: {
          results,
          pieces: images,
          newSlots: newLabels,
          skippedPhoto,
          truncated,
        },
      });
      toast.success("مدارک هوشمند ثبت شد");
    } catch (e) {
      if (e instanceof AiAllWorkersFailedError) {
        setRun({
          t: "error",
          message:
            e.attempts.length === 0
              ? "هیچ ورکر فعالی تنظیم نشده است."
              : `همه حساب‌ها ناموفق بودند:\n${e.attempts.map((a) => `• ${a.label}: ${a.message}`).join("\n")}`,
          needsSetup: e.attempts.length === 0,
        });
      } else {
        setRun({
          t: "error",
          message: e instanceof Error ? e.message : "افزودن هوشمند مدارک با خطا متوقف شد.",
        });
      }
    }
  };

  const busy = run.t === "busy";

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_MIME}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) void start(files);
        }}
      />

      {hasWorker ? (
        <button
          type="button"
          className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-lg shadow-[#6366f1]/35 transition-all hover:shadow-[#6366f1]/55 hover:brightness-110 active:scale-95 disabled:cursor-wait disabled:opacity-70"
          onClick={pick}
          disabled={busy}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} className="transition-transform duration-300 group-hover:rotate-12" />
          )}
          {busy ? "در حال افزودن…" : "افزودن با هوش مصنوعی"}
        </button>
      ) : (
        <Link
          to="/settings?tab=ai"
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-lg shadow-[#6366f1]/35 transition-all hover:shadow-[#6366f1]/55 hover:brightness-110 active:scale-95"
        >
          <Settings2 size={15} />
          فعال‌سازی هوش مصنوعی
        </Link>
      )}

      {/* ---- progress modal ---- */}
      <Modal open={busy} onClose={() => undefined} title="افزودن هوشمند مدارک" size="sm">
        <div className="flex flex-col gap-4 py-1">
          <div className="flex items-center gap-2.5 text-[13px] font-semibold">
            <Loader2 size={16} className="animate-spin text-[#6366f1]" />
            <span>{run.t === "busy" ? run.label : "…"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-900/8 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] transition-all duration-300"
              style={{ width: `${run.t === "busy" ? run.percent : 0}%` }}
            />
          </div>
          <p className="text-[11.5px] leading-5 text-ink-500 dark:text-ink-400">
            عکس‌ها و صفحات PDF شناسایی می‌شوند؛ صفحات ترکیبی (روی و پشت تذکره در یک صفحه) خودکار
            جدا و هر تصویر در جای درستش قرار می‌گیرد.
          </p>
        </div>
      </Modal>

      {/* ---- results modal ---- */}
      <Modal
        open={run.t === "done"}
        onClose={() => setRun({ t: "idle" })}
        title="مدارک هوشمند ثبت شد"
        size="md"
        footer={
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => setRun({ t: "idle" })}>
              تمام شد
            </button>
          </div>
        }
      >
        {run.t === "done" && (
          <div className="flex flex-col gap-3">
            {run.outcome.newSlots.length > 0 && (
              <div className="rounded-2xl bg-brand-500/8 px-3.5 py-2.5 text-[12px] leading-5">
                بخش جدید برای این مشتری ساخته شد:{" "}
                <b>{run.outcome.newSlots.join("، ")}</b>
              </div>
            )}
            {run.outcome.skippedPhoto && (
              <div className="flex items-start gap-2 rounded-2xl bg-[#f59e0b]/10 px-3.5 py-2.5 text-[12px] leading-5 text-[#c77d0a]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                عکس شخصی شناسایی شد اما پروفایل از قبل عکس دارد — عکس جدید در «سایر مدارک» ذخیره شد.
              </div>
            )}
            {run.outcome.truncated && (
              <div className="flex items-start gap-2 rounded-2xl bg-[#f59e0b]/10 px-3.5 py-2.5 text-[12px] leading-5 text-[#c77d0a]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                تعداد تصاویر زیاد بود — فقط {toPersianDigits(MAX_IMAGES)} تصویر اول پردازش شد.
              </div>
            )}
            <ul className="flex flex-col gap-1.5">
              {run.outcome.results.map((r, i) => (
                <li key={i} className="glass-soft flex items-center gap-2.5 rounded-2xl px-2.5 py-2">
                  <img
                    src={run.t === "done" ? run.outcome.pieces[i] : undefined}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl border border-ink-900/5 object-cover dark:border-white/10"
                  />
                  <span className="min-w-0 flex-1 text-[12px] leading-5">
                    <b>{targetLabel(r, run.t === "done" ? run.outcome.newSlots : [])}</b>
                    {r.note && <span className="text-ink-500 dark:text-ink-400"> — {r.note}</span>}
                  </span>
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      {/* ---- error modal ---- */}
      <Modal
        open={run.t === "error"}
        onClose={() => setRun({ t: "idle" })}
        title="افزودن هوشمند انجام نشد"
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            {run.t === "error" && run.needsSetup ? (
              <Link to="/settings?tab=ai" className="btn btn-glass btn-sm" onClick={() => setRun({ t: "idle" })}>
                <Settings2 size={14} /> تنظیمات هوش مصنوعی
              </Link>
            ) : (
              <span />
            )}
            <button className="btn btn-primary" onClick={() => setRun({ t: "idle" })}>
              بستن
            </button>
          </div>
        }
      >
        {run.t === "error" && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#ef4444]/8 px-3.5 py-3 text-[12.5px] leading-6 text-[#b91c1c] dark:text-[#f87171]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{run.message}</span>
          </div>
        )}
      </Modal>
    </>
  );
}

function targetLabel(r: DocSortResult, newSlots: string[]): string {
  switch (r.target.kind) {
    case "slot":
      return r.target.label;
    case "photo":
      return "عکس پروفایل";
    case "new":
      return `${r.target.label}${newSlots.includes(r.target.label) ? " (بخش جدید)" : ""}`;
    case "other":
      return "سایر مدارک";
  }
}
