/**
 * Smart extraction step for the customer form — deterministic document
 * reading (MRZ + PDF text + local OCR) with a field-level review screen.
 * Nothing is saved until the operator confirms.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  FileText,
  Loader2,
  Pencil,
  ScanSearch,
  ShieldCheck,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/fields";
import {
  runExtraction,
  validateFile,
  latinNameToFa,
  matchCustomers,
  type ExtractionResult,
  type ExtractedValue,
  type CanonicalField,
  type PipelineProgress,
  type CustomerMatch,
} from "../../lib/docex";
import { useCustomers } from "../../hooks/useData";
import { customerFullName } from "../../db/customers";
import { toPersianDigits } from "../../utils/jalali";

/** What the customer form needs after review. */
export interface SmartExtractOutcome {
  /** Operator-confirmed values, keyed for the customer form. */
  firstName: string;
  lastName: string;
  passportNo: string;
  birthDate: string | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  /** Extra canonical values for custom fields / notes. */
  extras: Partial<Record<CanonicalField, string>>;
  /** Attach the uploaded file to the new customer's documents. */
  attachFile: File | null;
}

interface Props {
  onApply: (outcome: SmartExtractOutcome) => void;
  onSkip: () => void;
}

type Phase = "upload" | "processing" | "review";

/** Fields shown in the review grid, in display order. */
const FIELD_DEFS: Array<{ key: CanonicalField; label: string; editable: true }> = [
  { key: "givenNames", label: "نام (لاتین)", editable: true },
  { key: "surname", label: "نام خانوادگی (لاتین)", editable: true },
  { key: "documentNumber", label: "شماره سند / پاسپورت", editable: true },
  { key: "dateOfBirth", label: "تاریخ تولد", editable: true },
  { key: "dateOfExpiry", label: "تاریخ انقضا", editable: true },
  { key: "dateOfIssue", label: "تاریخ صدور", editable: true },
  { key: "sex", label: "جنسیت", editable: true },
  { key: "nationality", label: "ملیت", editable: true },
  { key: "nationalId", label: "شماره ملی / تذکره", editable: true },
  { key: "placeOfBirth", label: "محل تولد", editable: true },
  { key: "fatherName", label: "نام پدر", editable: true },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "تأیید شده", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  needs_review: { label: "نیاز به بازبینی", cls: "bg-amber-500/15 text-[#c77d0a] dark:text-[#f5b84f]" },
  invalid: { label: "نامعتبر", cls: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  not_found: { label: "یافت نشد", cls: "bg-ink-500/10 text-ink-500 dark:text-ink-400" },
};

const KIND_LABELS: Record<string, string> = {
  passport: "پاسپورت",
  id_card: "کارت شناسایی",
  tazkira_paper: "تذکره (کاغذی)",
  visa_form: "فرم ویزا",
  photo: "عکس پورتره",
  unknown: "نامشخص",
};

const STAGE_LABELS: Record<string, string> = {
  validating: "بررسی فایل",
  opening: "باز کردن PDF",
  page_text: "خواندن متن صفحه",
  page_ocr: "پردازش OCR صفحه",
  merging: "ادغام نتایج",
  done: "پایان",
};

export function SmartExtract({ onApply, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [edits, setEdits] = useState<Partial<Record<CanonicalField, string>>>({});
  const [attach, setAttach] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const customers = useCustomers();

  // Clean up is unnecessary: we keep no object URLs (data URLs only, small).

  const start = async (f: File) => {
    const err = validateFile(f);
    if (err) {
      setProgress({ stage: "done", page: 0, totalPages: 0, percent: 100 });
      setResult({
        pages: [],
        fields: {},
        detectedKinds: [],
        warnings: [err],
        fileName: f.name,
        fileSize: f.size,
        processedAt: Date.now(),
      });
      setPhase("review");
      return;
    }
    setFile(f);
    setPhase("processing");
    setProgress(null);
    const res = await runExtraction(f, {
      onProgress: (p) => setProgress(p),
    });
    setResult(res);
    setPhase("review");
  };

  /** Current value of a field = edited value ?? extracted value ?? "". */
  const currentVal = (key: CanonicalField): string => {
    const edited = edits[key];
    if (edited !== undefined) return edited;
    const v = result?.fields[key]?.value;
    return v == null ? "" : String(v);
  };

  const fieldsWithStatus = useMemo(() => {
    return FIELD_DEFS.map((def) => {
      const extracted: ExtractedValue | undefined = result?.fields[def.key];
      const edited = edits[def.key];
      const value = currentVal(def.key);
      const status = edited !== undefined
        ? value.trim() ? "confirmed" : "not_found"
        : (extracted?.status ?? "not_found");
      return { ...def, value, status, method: extracted?.method, raw: extracted?.raw, note: extracted?.note };
    });
  }, [result, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches: CustomerMatch[] = useMemo(() => {
    if (!result || !customers) return [];
    return matchCustomers(result.fields, customers);
  }, [result, customers]);

  const apply = () => {
    const val = (k: CanonicalField) => currentVal(k).trim();
    const given = val("givenNames");
    const surname = val("surname");
    // Only trust clean-looking extras in notes — OCR garbage stays out.
    const clean = (v: string, allowDigits = false) =>
      (allowDigits ? /^[A-Za-z0-9\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF\s\-'.]*$/ : /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s\-'.]*$/).test(v)
        ? v
        : "";
    const extras: SmartExtractOutcome["extras"] = {
      sex: val("sex"),
      nationality: clean(val("nationality")),
      nationalId: clean(val("nationalId"), true),
      placeOfBirth: clean(val("placeOfBirth")),
      fatherName: clean(val("fatherName")),
    };
    const outcome: SmartExtractOutcome = {
      // Persian form values via deterministic transliteration; operator
      // reviews/edits them in the customer form as usual.
      firstName: latinNameToFa(given) || given,
      lastName: latinNameToFa(surname) || surname,
      passportNo: val("documentNumber"),
      birthDate: val("dateOfBirth") || null,
      passportIssueDate: val("dateOfIssue") || null,
      passportExpiryDate: val("dateOfExpiry") || null,
      extras,
      attachFile: attach && file ? file : null,
    };
    onApply(outcome);
  };

  return (
    <div className="flex flex-col gap-4" data-page-form>
      {phase === "upload" && (
        <>
          <div className="flex items-start gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/8 px-3.5 py-3">
            <ScanSearch size={18} className="mt-0.5 shrink-0 text-brand-500" />
            <div className="min-w-0 text-[12px] leading-5">
              <p className="font-bold">دستیار خواندن مدارک</p>
              <p className="mt-0.5 text-ink-500 dark:text-ink-400">
                فایل PDF یا تصویرِ پاسپورت، تذکره یا کارت شناسایی را بدهید. فیلدها به‌صورت
                خودکار خوانده و پر می‌شوند؛ شما فقط بازبینی و تأیید می‌کنید.
                پردازش کاملاً در همین مرورگر انجام می‌شود.
              </p>
            </div>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void start(f);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all ${
              dragOver
                ? "border-brand-500 bg-brand-500/10"
                : "border-ink-900/15 hover:border-brand-500/50 hover:bg-brand-500/5 dark:border-white/15"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/bmp,.pdf,.jpg,.jpeg,.png,.webp,.bmp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void start(f);
              }}
            />
            <Upload size={26} className="text-brand-500" />
            <p className="text-[13px] font-bold">فایل را اینجا رها کنید یا کلیک کنید</p>
            <p className="text-[11px] text-ink-500 dark:text-ink-400">
              PDF یا تصویر (JPEG / PNG / WebP) — حداکثر ۲۵ مگابایت
            </p>
          </label>

          <button
            type="button"
            className="mx-auto text-[12px] font-medium text-brand-500 hover:underline"
            onClick={onSkip}
          >
            بی‌خیال — فرم را دستی پر می‌کنم
          </button>
        </>
      )}

      {phase === "processing" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-900/8 px-4 py-10 dark:border-white/10">
          <Loader2 size={28} className="animate-spin text-brand-500" />
          <p className="text-[13px] font-bold">
            {progress
              ? `${STAGE_LABELS[progress.stage] ?? progress.stage}${
                  progress.totalPages ? ` — صفحهٔ ${toPersianDigits(progress.page)} از ${toPersianDigits(progress.totalPages)}` : ""
                }`
              : "شروع پردازش…"}
          </p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-ink-900/8 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-300"
              style={{ width: `${Math.max(4, progress?.percent ?? 4)}%` }}
            />
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-ink-400">
            <ShieldCheck size={13} />
            فایل دستگاه شما را ترک نمی‌کند — OCR محلی، بدون سرویس ابری
          </p>
        </div>
      )}

      {phase === "review" && result && (
        <>
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/6 px-2.5 py-1 font-medium dark:bg-white/10">
              <FileText size={12} /> {result.fileName}
            </span>
            {result.pages.map((p) => (
              <span
                key={p.index}
                className="rounded-full bg-brand-500/10 px-2.5 py-1 font-medium text-brand-600 dark:text-brand-300"
              >
                صفحهٔ {toPersianDigits(p.index)}: {KIND_LABELS[p.kind] ?? p.kind}
                {p.mrz ? ` (MRZ ${p.mrz.allValid ? "✓" : "؟"})` : ""}
              </span>
            ))}
          </div>

          {result.warnings.length > 0 && (
            <div className="flex flex-col gap-1 rounded-2xl bg-amber-500/10 px-3.5 py-3 text-[11.5px] leading-5 text-[#c77d0a] dark:text-[#f5b84f]">
              {result.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-1 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Existing-customer matches */}
          {matches.length > 0 && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-500/8 px-3.5 py-3 text-[12px]">
              <p className="flex items-center gap-1.5 font-bold text-sky-700 dark:text-sky-300">
                <UserCheck size={15} /> مشتری مشابه پیدا شد
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {matches.slice(0, 3).map((m) => (
                  <div key={m.customer.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{customerFullName(m.customer)}</span>
                    <span className="text-[10.5px] text-sky-700/80 dark:text-sky-300/80">
                      {m.reasons.join(" و ")}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-4 text-sky-700/70 dark:text-sky-300/70">
                اگر همین شخص است، بهتر است از صفحهٔ مشتریِ موجود ویرایش کنید تا رکورد تکراری
                ساخته نشود. ادغام خودکار انجام نمی‌شود.
              </p>
            </div>
          )}

          {/* Field grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {fieldsWithStatus.map((f) => (
              <div
                key={f.key}
                className={`rounded-2xl border px-3 py-2.5 transition-colors ${
                  f.status === "confirmed"
                    ? "border-emerald-500/25"
                    : f.status === "needs_review" || f.status === "invalid"
                      ? "border-amber-500/35"
                      : "border-ink-900/8 dark:border-white/10"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-bold">{f.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${STATUS_META[f.status].cls}`}
                  >
                    {f.status === "confirmed" && f.method === "mrz" ? "تأیید MRZ" : STATUS_META[f.status].label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    dir={/[A-Za-z]/.test(f.value) || f.key === "dateOfBirth" || f.key.includes("Date") ? "ltr" : "rtl"}
                    className="text-[12px]"
                    value={f.value}
                    placeholder="—"
                    onChange={(e) => setEdits((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                  {f.status === "confirmed" && edits[f.key] === undefined && (
                    <Check size={14} className="shrink-0 text-emerald-500" />
                  )}
                  {(f.status === "needs_review" || f.status === "invalid") && (
                    <span title={f.note ?? "بازبینی کنید"} className="shrink-0">
                      <CircleHelp size={14} className="text-amber-500" />
                    </span>
                  )}
                </div>
                {f.raw && edits[f.key] === undefined && f.raw !== f.value && (
                  <p className="mt-1 truncate text-[10px] text-ink-400" dir="ltr">
                    {f.raw}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Persian preview of the name */}
          {(currentVal("givenNames") || currentVal("surname")) && (
            <p className="rounded-xl bg-ink-900/4 px-3 py-2 text-[11.5px] dark:bg-white/6">
              در فرم ثبت می‌شود:{" "}
              <b>{latinNameToFa(currentVal("givenNames"))}</b>{" "}
              <b>{latinNameToFa(currentVal("surname"))}</b>
              <span className="text-ink-500 dark:text-ink-400">
                {" "}— از روی حروف‌نویسی خودکار؛ در فرم قابل ویرایش است
              </span>
            </p>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => setAttach(e.target.checked)}
              className="size-4 accent-[var(--color-brand-500,#6366f1)]"
            />
            ذخیرهٔ همین فایل در «مدارک و تصاویر» مشتری
          </label>

          <div className="flex items-center justify-between gap-2 border-t border-ink-900/5 pt-3 dark:border-white/5">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-500 hover:text-ink-700 dark:text-ink-400"
              onClick={() => {
                setPhase("upload");
                setFile(null);
                setResult(null);
                setEdits({});
              }}
            >
              <X size={14} /> فایل دیگر
            </button>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={onSkip}>
                رد کردن
              </button>
              <Button variant="primary" onClick={apply}>
                <Pencil size={13} /> تأیید و پر کردن فرم
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
