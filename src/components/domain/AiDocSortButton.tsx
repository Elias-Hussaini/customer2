/**
 * «افزودن با هوش مصنوعی» — smart document filing for one customer.
 *
 *   1. PDFs are rendered to page images locally (pdf.js); blank pages are
 *      dropped; photos are normalized.
 *   2. Combined scans (e.g. front+back of a tazkira on one page) are cut
 *      apart locally by gutter detection — but NEVER through content: a
 *      "blank" band whose edges touch ink sits inside ONE document and is
 *      rejected (fixes the halved پشت-تذکره bug).
 *   3. Every image is sent to the user's Cloudflare AI worker with the
 *      customer's CURRENT document slots — the model answers where each
 *      image belongs.
 *   4. Pieces of one page that all land in the same destination are re-joined
 *      (the original whole page is filed once) — resolveActions.
 *   5. Images are saved to their destinations and a short summary is shown.
 *
 * The pipeline is RESUMABLE: when any step fails (CORS, network, invalid
 * JSON, quota…), the error shows a «تلاش دوباره» button that continues
 * EXACTLY where it stopped — converted pages and already-classified chunks
 * are never redone, so no quota is wasted. A «لغو» button stops a running
 * job at any time.
 */

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { db } from "../../db/schema";
import {
  AiAllWorkersFailedError,
  ACCEPTED_MIME,
  aiChat,
  buildChunks,
  buildDocSortMessages,
  chunkLocalGroups,
  imageFileToJpeg,
  isBlankImage,
  parseDocSortReply,
  pdfToJpegs,
  resolveActions,
  splitCombinedImage,
  useAiWorkers,
  validateAiFile,
  type DocSlotOption,
  type DocSortResult,
  type SortAction,
  type SortOriginal,
  type SortPiece,
} from "../../lib/ai";
import type { DocType } from "../../types";
import { createDocType, getDocTypesForCustomer } from "../../db/docTypes";
import { saveAttachmentDataUrl } from "../../db/attachments";
import { dataUrlToSquareDataUrl, setCustomerPhoto } from "../../db/photos";
import { customerFullName } from "../../db/customers";
import { Modal } from "../ui/Modal";
import { useToast } from "../../hooks/useToast";
import { toPersianDigits } from "../../utils/jalali";

/** Hard cap on images per run (after splitting). */
const MAX_IMAGES = 18;

/** A run that can be paused by an error and continued with «تلاش دوباره». */
interface SortJob {
  files: File[];
  expanded: SortPiece[];
  originals: SortOriginal[];
  docTypes: DocType[];
  slots: DocSlotOption[];
  chunks: number[][];
  results: DocSortResult[];
  /** Next chunk index to classify (== chunks.length when all are done). */
  nextChunk: number;
  /** Computed once all chunks are classified. */
  actions: SortAction[] | null;
  newIdByLabel: Map<string, string>;
  newLabels: string[];
  /** Next action index to save (== actions.length when all are saved). */
  appliedIdx: number;
  truncated: boolean;
  blankSkipped: number;
  skippedPhoto: boolean;
}

/** Errors that retrying the same files will never fix (bad/empty input). */
class DeterministicError extends Error {}

interface Outcome {
  actions: SortAction[];
  newSlots: string[];
  skippedPhoto: boolean;
  truncated: boolean;
  blankSkipped: number;
}

type RunState =
  | { t: "idle" }
  | { t: "busy"; label: string; percent: number }
  | { t: "done"; outcome: Outcome }
  | { t: "error"; message: string; needsSetup?: boolean; canRetry?: boolean };

export function AiDocSortButton({ customerId }: { customerId: string }) {
  const toast = useToast();
  const workers = useAiWorkers();
  const hasWorker = (workers ?? []).some((w) => w.enabled && w.url.trim() && w.key.trim());
  const fileRef = useRef<HTMLInputElement>(null);
  const [run, setRun] = useState<RunState>({ t: "idle" });
  /** The resumable job (null until the files are prepared). */
  const jobRef = useRef<SortJob | null>(null);
  /** Last picked files — lets a failed PREPARE retry without re-picking. */
  const filesRef = useRef<File[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const stage = (label: string, percent: number) =>
    setRun((cur) => (cur.t === "busy" ? { t: "busy", label, percent } : cur));

  const pick = () => fileRef.current?.click();

  /* ------------------------------ 1+2) prepare ----------------------------- */

  const prepareJob = async (files: File[]): Promise<SortJob> => {
    const pieces: SortPiece[] = [];
    const originals: SortOriginal[] = [];
    let truncated = false;
    let blankSkipped = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const pages = await pdfToJpegs(file, (p) =>
          stage(
            `تبدیل PDF — صفحهٔ ${p.page.toLocaleString("fa-IR")} از ${p.totalPages.toLocaleString("fa-IR")}`,
            4 + Math.round(((i + p.page / p.totalPages) / files.length) * 30),
          ),
        );
        const base = file.name.replace(/\.pdf$/i, "");
        for (let n = 0; n < pages.length; n++) {
          if (await isBlankImage(pages[n])) {
            blankSkipped++;
            continue;
          }
          if (pieces.length >= MAX_IMAGES) {
            truncated = true;
            break;
          }
          const origin = `${base || "صفحه"}-ص${n + 1}.jpg`;
          originals.push({ dataUrl: pages[n], origin });
          pieces.push({ dataUrl: pages[n], origin, groupId: originals.length - 1 });
        }
      } else {
        if (pieces.length >= MAX_IMAGES) {
          truncated = true;
          continue;
        }
        stage("آماده‌سازی فایل‌ها…", 4 + Math.round(((i + 1) / files.length) * 30));
        const img = await imageFileToJpeg(file);
        const origin = file.name || "تصویر.jpg";
        originals.push({ dataUrl: img, origin });
        pieces.push({ dataUrl: img, origin, groupId: originals.length - 1 });
      }
    }
    if (pieces.length === 0) {
      throw new DeterministicError(
        blankSkipped > 0
          ? "همه صفحه‌ها خالی بودند — فایل دیگری امتحان کنید."
          : "از این فایل‌ها هیچ تصویری ساخته نشد — فایل دیگری امتحان کنید.",
      );
    }

    // Cut combined scans apart (front+back on one page) — never through ink.
    stage("بررسی صفحات ترکیبی…", 36);
    const expanded: SortPiece[] = [];
    for (const piece of pieces) {
      const report = await splitCombinedImage(piece.dataUrl);
      if (report.images.length === 1) {
        expanded.push(piece);
      } else {
        const base = piece.origin.replace(/\.[a-z0-9]+$/i, "");
        for (let n = 0; n < report.images.length; n++) {
          if (expanded.length >= MAX_IMAGES) {
            truncated = true;
            break;
          }
          expanded.push({
            dataUrl: report.images[n],
            origin: `${base}-بخش${n + 1}.jpg`,
            groupId: piece.groupId,
          });
        }
      }
    }

    // Slots the AI may choose from: the global defaults (Settings) plus the
    // slots that belong to THIS customer only. A slot another customer's AI
    // run created is deliberately invisible here — new inputs never leak
    // into every profile again.
    const docTypes = (await getDocTypesForCustomer(customerId))
      .filter((d) => !d.archivedAt)
      .sort((a, b) => a.order - b.order);
    return {
      files,
      expanded,
      originals,
      docTypes,
      slots: docTypes.map((d) => ({ id: d.id, label: d.label })),
      chunks: buildChunks(expanded),
      results: [],
      nextChunk: 0,
      actions: null,
      newIdByLabel: new Map(),
      newLabels: [],
      appliedIdx: 0,
      truncated,
      blankSkipped,
      skippedPhoto: false,
    };
  };

  /* --------------------------- 3+4) classify & save ------------------------- */

  const runJob = async (job: SortJob) => {
    /* ---- classify in chunks (resume: skip already-classified chunks) ---- */
    for (let c = job.nextChunk; c < job.chunks.length; c++) {
      if (cancelledRef.current) return;
      const chunk = job.chunks[c];
      const slice = chunk.map((idx) => job.expanded[idx].dataUrl);
      const localGroups = chunkLocalGroups(job.expanded, chunk);
      abortRef.current = new AbortController();
      const { text } = await aiChat(buildDocSortMessages(slice, job.slots, localGroups), {
        maxTokens: 1024,
        temperature: 0.1,
        signal: abortRef.current.signal,
        onAttempt: ({ worker, index, total }) =>
          stage(
            total > 1 && index > 0
              ? `حساب قبلی خطا داد — تلاش با «${worker.label}»…`
              : `ارسال به هوش مصنوعی (${worker.label})…`,
            40 + Math.round(((c + 0.6) / job.chunks.length) * 45),
          ),
      });
      if (cancelledRef.current) return;
      const part = parseDocSortReply(text, job.slots, slice.length);
      job.results.push(...part.map((r) => ({ ...r, index: r.index + chunk[0] - 1 })));
      job.nextChunk = c + 1;
    }

    /* ---- collapse same-destination cut groups, create new slots ---- */
    if (!job.actions) {
      stage("ذخیره مدارک…", 90);
      const actions = resolveActions(job.expanded, job.originals, job.results);
      for (const a of actions) {
        if (a.target.kind !== "new") continue;
        const key = a.target.label;
        if (job.newIdByLabel.has(key)) continue;
        const existing = job.docTypes.find((d) => d.label === key);
        if (existing) {
          job.newIdByLabel.set(key, existing.id);
          continue;
        }
        // New slots are created for THIS customer only — other profiles keep
        // their own clean slot list (defaults stay global via Settings).
        const dt = await createDocType({ label: key, customerId });
        job.newIdByLabel.set(key, dt.id);
        job.newLabels.push(key);
      }
      job.actions = actions;
      job.appliedIdx = 0;
    }

    /* ---- save (resume: continue from the action that failed) ---- */
    const customer = await db.customers.get(customerId);
    const customerName = customer ? customerFullName(customer) : "مشتری";
    for (let i = job.appliedIdx; i < job.actions.length; i++) {
      if (cancelledRef.current) return;
      const a = job.actions[i];
      if (a.target.kind === "photo") {
        if (customer && !customer.photo) {
          const square = await dataUrlToSquareDataUrl(a.image);
          await setCustomerPhoto(customerId, square, customerName);
        } else {
          // Profile photo already exists — keep the user's choice, keep the image.
          await saveAttachmentDataUrl(customerId, "other", a.image, "عکس شخصی.jpg");
          job.skippedPhoto = true;
        }
      } else if (a.target.kind === "slot") {
        await saveAttachmentDataUrl(customerId, a.target.slotId, a.image, `${a.target.label}.jpg`);
      } else if (a.target.kind === "new") {
        const slotId = job.newIdByLabel.get(a.target.label);
        await saveAttachmentDataUrl(
          customerId,
          slotId ?? "other",
          a.image,
          slotId ? `${a.target.label}.jpg` : a.origin,
        );
      } else {
        await saveAttachmentDataUrl(customerId, "other", a.image, a.origin);
      }
      job.appliedIdx = i + 1;
    }

    setRun({
      t: "done",
      outcome: {
        actions: job.actions,
        newSlots: [...job.newLabels],
        skippedPhoto: job.skippedPhoto,
        truncated: job.truncated,
        blankSkipped: job.blankSkipped,
      },
    });
    toast.success("مدارک ثبت شد");
  };

  /* -------------------------------- controls ------------------------------- */

  const formatError = (e: unknown): { message: string; needsSetup?: boolean } => {
    if (e instanceof AiAllWorkersFailedError) {
      return {
        message:
          e.attempts.length === 0
            ? "هیچ ورکر فعالی تنظیم نشده است."
            : `همه حساب‌ها ناموفق بودند:\n${e.attempts.map((a) => `• ${a.label}: ${a.message}`).join("\n")}`,
        needsSetup: e.attempts.length === 0,
      };
    }
    return {
      message: e instanceof Error ? e.message : "افزودن هوشمند مدارک با خطا متوقف شد.",
    };
  };

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
    cancelledRef.current = false;
    filesRef.current = files;
    jobRef.current = null;
    setRun({ t: "busy", label: "آماده‌سازی فایل‌ها…", percent: 4 });
    try {
      const job = await prepareJob(files);
      if (cancelledRef.current) return;
      jobRef.current = job;
      await runJob(job);
    } catch (e) {
      if (cancelledRef.current) return;
      const { message, needsSetup } = formatError(e);
      setRun({
        t: "error",
        message,
        needsSetup,
        canRetry: !(e instanceof DeterministicError) && (jobRef.current !== null || !!filesRef.current),
      });
    }
  };

  /** Continue a failed run exactly where it stopped (no re-conversion, no
   *  re-classification of finished chunks, no duplicate saves). */
  const retry = async () => {
    if (run.t === "busy") return;
    const job = jobRef.current;
    const resumable =
      job !== null &&
      (job.nextChunk < job.chunks.length || !job.actions || job.appliedIdx < job.actions.length);
    if (job && resumable) {
      cancelledRef.current = false;
      setRun({ t: "busy", label: "ادامه از همان مرحله…", percent: 40 });
      try {
        await runJob(job);
      } catch (e) {
        if (cancelledRef.current) return;
        const { message, needsSetup } = formatError(e);
        setRun({ t: "error", message, needsSetup, canRetry: true });
      }
    } else if (filesRef.current && filesRef.current.length > 0) {
      void start(filesRef.current);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setRun({ t: "idle" });
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

      {/* ---- progress (with cancel) ---- */}
      <Modal
        open={busy}
        onClose={() => undefined}
        title="افزودن هوشمند مدارک"
        size="sm"
        footer={
          <div className="flex justify-end">
            <button className="btn btn-glass btn-sm" onClick={cancel}>
              <X size={14} /> لغو
            </button>
          </div>
        }
      >
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
        </div>
      </Modal>

      {/* ---- results ---- */}
      <Modal
        open={run.t === "done"}
        onClose={() => setRun({ t: "idle" })}
        title="مدارک ثبت شد"
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
                بخش جدید: <b>{run.outcome.newSlots.join("، ")}</b>
                <span className="text-ink-500 dark:text-ink-400">
                  {" "}— فقط برای همین مشتری اضافه شد؛ بقیهٔ پروفایل‌ها تغییری نمی‌کنند.
                </span>
              </div>
            )}
            {(run.outcome.truncated || run.outcome.blankSkipped > 0 || run.outcome.skippedPhoto) && (
              <div className="flex items-start gap-2 rounded-2xl bg-[#f59e0b]/10 px-3.5 py-2.5 text-[12px] leading-5 text-[#c77d0a]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {run.outcome.blankSkipped > 0 &&
                    `${toPersianDigits(run.outcome.blankSkipped)} صفحهٔ خالی نادیده گرفته شد. `}
                  {run.outcome.truncated &&
                    `فقط ${toPersianDigits(MAX_IMAGES)} تصویر اول پردازش شد. `}
                  {run.outcome.skippedPhoto && "عکس شخصی در «سایر مدارک» ذخیره شد (پروفایل از قبل عکس دارد)."}
                </span>
              </div>
            )}
            <ul className="flex flex-col gap-1.5">
              {run.outcome.actions.map((a, i) => (
                <li key={i} className="glass-soft flex items-center gap-2.5 rounded-2xl px-2.5 py-2">
                  <img
                    src={a.image}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl border border-ink-900/5 object-cover dark:border-white/10"
                  />
                  <span className="min-w-0 flex-1 text-[12px] leading-5">
                    <b>{targetLabel(a, run.outcome.newSlots)}</b>
                  </span>
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      {/* ---- error (with retry) ---- */}
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
            <div className="flex items-center gap-2">
              {run.t === "error" && run.canRetry && (
                <button className="btn btn-primary" onClick={() => void retry()}>
                  <RotateCcw size={14} /> تلاش دوباره
                </button>
              )}
              <button
                className={run.t === "error" && run.canRetry ? "btn btn-glass" : "btn btn-primary"}
                onClick={() => setRun({ t: "idle" })}
              >
                بستن
              </button>
            </div>
          </div>
        }
      >
        {run.t === "error" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5 rounded-2xl bg-[#ef4444]/8 px-3.5 py-3 text-[12.5px] leading-6 text-[#b91c1c] dark:text-[#f87171]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">{run.message}</span>
            </div>
            {run.canRetry && (
              <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                با «تلاش دوباره» از همان‌جایی که خطا داد ادامه می‌دهد — کارهای انجام‌شده تکرار نمی‌شود.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function targetLabel(a: SortAction, newSlots: string[]): string {
  switch (a.target.kind) {
    case "slot":
      return a.target.label;
    case "photo":
      return "عکس پروفایل";
    case "new":
      return `${a.target.label}${newSlots.includes(a.target.label) ? " (بخش جدید)" : ""}`;
    case "other":
      return "سایر مدارک";
  }
}
