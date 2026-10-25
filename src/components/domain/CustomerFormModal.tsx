import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea, Toggle } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { DatePicker } from "../ui/DatePicker";
import { SearchSelect } from "../ui/inputs";
import { MoneyInput } from "../ui/MoneyInput";
import { CustomFieldsGroup } from "../ui/CustomFields";
import {
  runExtraction,
  validateFile,
  warmupOcr,
  formatDateForTemplate,
  latinNameToFa,
  type PipelineProgress,
  type CanonicalField,
  type ExtractionResult,
  type ExtractedValue,
} from "../../lib/docex";
import { createCustomer, findDuplicatePassport, updateCustomer, customerFullName } from "../../db/customers";
import { createRequest } from "../../db/requests";
import { createVisaType } from "../../db/taxonomy";
import { updatePrefs } from "../../db/prefs";
import { saveAttachment } from "../../db/attachments";
import { useCustomFields, useLists, usePrefs, useRepresentatives, useVisaTypes } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso, toPersianDigits } from "../../utils/jalali";
import type { Currency, Customer } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Present = edit mode. */
  customer?: Customer;
  onSaved?: (customer: Customer) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  passportNo: string;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  referrer: string;
  notes: string;
  representativeId: string | null;
  listId: string | null;
  registrationDate: string | null;
  customValues: Record<string, unknown>;
}

const EMPTY: FormState = {
  firstName: "",
  lastName: "",
  birthDate: null,
  passportNo: "",
  passportIssueDate: null,
  passportExpiryDate: null,
  referrer: "",
  notes: "",
  representativeId: null,
  listId: null,
  registrationDate: null,
  customValues: {},
};

/** Identity fields the AI can fill — used for the per-field badges. */
type AiField = "firstName" | "lastName" | "passportNo" | "birthDate" | "passportIssueDate" | "passportExpiryDate";

/** Quick-fill engine state. */
type AiState =
  | { t: "idle" }
  | { t: "busy"; progress: PipelineProgress | null }
  | { t: "done"; filled: number; review: number; fileName: string }
  | { t: "error"; message: string };

const AI_STAGES: Partial<Record<PipelineProgress["stage"], string>> = {
  validating: "بررسی فایل",
  opening: "باز کردن PDF",
  page_text: "خواندن متن",
  page_ocr: "خواندن OCR",
  merging: "ادغام نتایج",
  done: "پایان",
};

/** Tiny badge on a field label: emerald = trusted value, amber = re-check. */
function AiMark({ state }: { state?: "ok" | "review" }) {
  if (!state) return null;
  return (
    <span
      dir="ltr"
      className={`mr-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1.5px] text-[9px] font-extrabold leading-none ${
        state === "ok"
          ? "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400"
          : "bg-amber-500/20 text-[#c77d0a] dark:text-[#f5b84f]"
      }`}
    >
      <Sparkles size={9} />
      {state === "ok" ? "AI" : "AI؟"}
    </span>
  );
}

/**
 * Names: keep Persian letters (or Latin A-Z) and drop OCR noise — stray
 * dots, pipes and digits never reach the customer record.
 */
function safePersonName(s: string): string {
  if (!s) return "";
  const hasFa = /[\u0600-\u06FF]/.test(s);
  const cleaned = hasFa
    ? s.replace(/[^\u0600-\u06FF\s\-'\u200C]/g, "")
    : s.toUpperCase().replace(/[^A-Z\s\-'.]/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

export function CustomerFormModal({ open, onClose, customer, onSaved }: Props) {
  const toast = useToast();
  const customFields = useCustomFields();
  const prefs = usePrefs();
  const representatives = useRepresentatives();
  const lists = useLists();
  const visaTypes = useVisaTypes();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- AI quick-fill (extraction runs locally, values land straight in the form) ----
  const [ai, setAi] = useState<AiState>({ t: "idle" });
  const [aiMarks, setAiMarks] = useState<Partial<Record<AiField, "ok" | "review">>>({});
  const [aiRun, setAiRun] = useState(0); // bump → identity grid re-mounts with the flash sweep
  const [dragActive, setDragActive] = useState(false);
  const [smartFile, setSmartFile] = useState<File | null>(null); // auto-attach to the customer's documents
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Simultaneous visa-request section (create mode only).
  const [withRequest, setWithRequest] = useState(true);
  const [reqVisaType, setReqVisaType] = useState<string | null>(null);
  const [reqAmount, setReqAmount] = useState<number | null>(null);
  const [reqCurrency, setReqCurrency] = useState<Currency>("IRT");

  // Read the latest values inside the open-effect without re-running it
  // whenever live queries refresh (would wipe user input otherwise).
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const repsRef = useRef(representatives);
  repsRef.current = representatives;
  const listsRef = useRef(lists);
  listsRef.current = lists;

  const calMode = prefs.passportDateCalendar ?? "gregorian";

  const fields = useMemo(
    () =>
      (customFields ?? [])
        .filter((f) => f.entity === "customer" && f.showInForm && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [customFields],
  );

  useEffect(() => {
    if (open) {
      // Preload the local OCR engines in the background — the first document
      // then fills in seconds instead of paying the model-load cost.
      void warmupOcr();
      setDupWarning(null);
      setErrors({});
      setAi({ t: "idle" });
      setAiMarks({});
      setAiRun(0);
      setDragActive(false);
      setSmartFile(null);
      if (customer) {
        setForm({
          firstName: customer.firstName ?? "",
          lastName: customer.lastName ?? "",
          birthDate: customer.birthDate ?? null,
          passportNo: customer.passportNo ?? "",
          passportIssueDate: customer.passportIssueDate ?? null,
          passportExpiryDate: customer.passportExpiryDate ?? null,
          referrer: customer.referrer ?? "",
          notes: customer.notes ?? "",
          representativeId: customer.representativeId ?? null,
          listId: customer.listId ?? null,
          registrationDate: customer.registrationDate,
          customValues: { ...(customer.customValues ?? {}) },
        });
      } else {
        // Pre-fill list & representative from the remembered last selection.
        const p = prefsRef.current;
        const lastRep =
          p.rememberLastSelections &&
          p.lastRepresentativeId &&
          (repsRef.current ?? []).some((r) => r.id === p.lastRepresentativeId)
            ? p.lastRepresentativeId
            : null;
        const lastList =
          p.rememberLastSelections &&
          p.lastListId &&
          (listsRef.current ?? []).some((l) => l.id === p.lastListId)
            ? p.lastListId
            : null;
        setForm({ ...EMPTY, representativeId: lastRep, listId: lastList, registrationDate: todayIso() });
        // Reset the visa-request section.
        setWithRequest(true);
        setReqVisaType(p.defaultVisaType ?? null);
        setReqAmount(null);
        setReqCurrency(p.defaultCurrency);
      }
    }
  }, [open, customer]);

  const checkDuplicate = async (passportNo: string) => {
    if (!passportNo.trim() || passportNo === (customer?.passportNo ?? "")) {
      setDupWarning(null);
      return;
    }
    const dup = await findDuplicatePassport(passportNo, customer?.id);
    setDupWarning(dup ? `این شماره پاسپورت قبلاً برای «${customerFullName(dup)}» ثبت شده است.` : null);
  };

  const visaTypeItems = useMemo(
    () => (visaTypes ?? []).map((v) => ({ id: v.name, title: v.name })),
    [visaTypes],
  );

  /**
   * Set one of the identity fields from user input — editing a value takes
   * ownership of it, so its AI badge is dropped.
   */
  const touch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setAiMarks((m) => {
      if (m[key as AiField] == null) return m;
      const next = { ...m };
      delete next[key as AiField];
      return next;
    });
  };

  /** Read the extraction, write values straight into this form. */
  const applyAiResult = (res: ExtractionResult, fileName: string) => {
    const f = res.fields;
    const v = (k: CanonicalField) => (f[k]?.value != null ? String(f[k].value) : "");
    const st = (k: CanonicalField): "ok" | "review" | undefined => {
      const ex = f[k];
      if (!ex || ex.value == null || !String(ex.value).trim()) return undefined;
      return ex.status === "confirmed" ? "ok" : "review";
    };
    // OCR garbage stays out of the notes — only clean-looking extras go in.
    const clean = (value: string, allowDigits = false) =>
      (allowDigits
        ? /^[A-Za-z0-9\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF\s\-'.]*$/
        : /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s\-'.]*$/
      ).test(value)
        ? value
        : "";

    const firstName = safePersonName(latinNameToFa(v("givenNames")) || v("givenNames"));
    const lastName = safePersonName(latinNameToFa(v("surname")) || v("surname"));
    const passportNo = v("documentNumber");
    const birthDate = v("dateOfBirth");
    const issueDate = v("dateOfIssue");
    const expiryDate = v("dateOfExpiry");

    const marks: Partial<Record<AiField, "ok" | "review">> = {};
    const mark = (k: AiField, s: "ok" | "review" | undefined) => {
      if (s) marks[k] = s;
    };
    mark("firstName", st("givenNames"));
    mark("lastName", st("surname"));
    mark("passportNo", st("documentNumber"));
    mark("birthDate", st("dateOfBirth"));
    mark("passportIssueDate", st("dateOfIssue"));
    mark("passportExpiryDate", st("dateOfExpiry"));

    const applied = [
      firstName,
      lastName,
      passportNo,
      birthDate,
      issueDate,
      expiryDate,
    ].filter((x) => x.trim().length > 0);
    const filled = applied.length;
    const review = Object.values(marks).filter((s) => s === "review").length;

    if (filled === 0) {
      setAi({ t: "error", message: res.warnings[0] ?? "هیچ فیلد شناخته‌شده‌ای خوانده نشد — فرم را دستی پر کنید." });
      return;
    }

    const extrasNote = [
      clean(v("nationalId"), true) && `شماره ملی/تذکره: ${clean(v("nationalId"), true)}`,
      clean(v("placeOfBirth")) && `محل تولد: ${clean(v("placeOfBirth"))}`,
      clean(v("fatherName")) && `نام پدر: ${clean(v("fatherName"))}`,
      clean(v("nationality")) && `ملیت: ${clean(v("nationality"))}`,
      v("sex") === "M" && "جنسیت: مرد",
      v("sex") === "F" && "جنسیت: زن",
      v("entryDate") &&
        `تاریخ ورود: ${toPersianDigits(formatDateForTemplate(v("entryDate"), "jalali"))}`,
    ]
      .filter(Boolean)
      .join(" — ");

    setForm((prev) => ({
      ...prev,
      firstName: firstName || prev.firstName,
      lastName: lastName || prev.lastName,
      passportNo: passportNo || prev.passportNo,
      birthDate: birthDate || prev.birthDate,
      passportIssueDate: issueDate || prev.passportIssueDate,
      passportExpiryDate: expiryDate || prev.passportExpiryDate,
      notes: extrasNote || prev.notes,
    }));
    setAiMarks(marks);
    setAiRun((n) => n + 1);
    setAi({ t: "done", filled, review, fileName });
    if (passportNo) void checkDuplicate(passportNo);
  };

  /**
   * Live progressive fill — values land in the form the moment they are read
   * (empty slots only, so anything the operator already typed is respected).
   * This is what makes the fill feel instant on multi-page scans: the bio
   * page fields appear while later pages are still being read.
   */
  const applyPartialFields = (fields: Partial<Record<CanonicalField, ExtractedValue>>) => {
    const v = (k: CanonicalField) => (fields[k]?.value != null ? String(fields[k].value).trim() : "");
    const first = safePersonName(latinNameToFa(v("givenNames")) || v("givenNames"));
    const last = safePersonName(latinNameToFa(v("surname")) || v("surname"));
    const pno = v("documentNumber").toUpperCase();
    const dob = v("dateOfBirth");
    const iss = v("dateOfIssue");
    const exp = v("dateOfExpiry");
    setForm((prev) => {
      const next = { ...prev };
      let touched = false;
      if (first && !next.firstName) { next.firstName = first; touched = true; }
      if (last && !next.lastName) { next.lastName = last; touched = true; }
      if (pno && !next.passportNo) { next.passportNo = pno; touched = true; }
      if (dob && !next.birthDate) { next.birthDate = dob; touched = true; }
      if (iss && !next.passportIssueDate) { next.passportIssueDate = iss; touched = true; }
      if (exp && !next.passportExpiryDate) { next.passportExpiryDate = exp; touched = true; }
      return touched ? next : prev;
    });
    const markOf = (k: CanonicalField): "ok" | "review" | undefined => {
      const ex = fields[k];
      if (!ex || ex.value == null || !String(ex.value).trim()) return undefined;
      return ex.status === "confirmed" ? "ok" : "review";
    };
    setAiMarks((m) => {
      const next = { ...m };
      const add = (k: AiField, s: "ok" | "review" | undefined) => {
        if (s) next[k] = s;
      };
      add("firstName", markOf("givenNames"));
      add("lastName", markOf("surname"));
      add("passportNo", markOf("documentNumber"));
      add("birthDate", markOf("dateOfBirth"));
      add("passportIssueDate", markOf("dateOfIssue"));
      add("passportExpiryDate", markOf("dateOfExpiry"));
      return next;
    });
    if (pno) void checkDuplicate(pno);
  };

  const runAi = async (file: File) => {
    const err = validateFile(file);
    if (err) {
      setAi({ t: "error", message: err });
      return;
    }
    setAi({ t: "busy", progress: null });
    setAiMarks({});
    setSmartFile(file);
    try {
      const res = await runExtraction(file, {
        previews: false,
        onProgress: (p) => setAi((s) => (s.t === "busy" ? { t: "busy", progress: p } : s)),
        onFields: (fields) => applyPartialFields(fields),
      });
      applyAiResult(res, file.name);
    } catch {
      setAi({ t: "error", message: "خواندن فایل با خطا متوقف شد — دستی پر کنید." });
    }
  };

  // ---- drag & drop across the whole form ----
  const busy = ai.t === "busy";
  const onDragOver = (e: React.DragEvent) => {
    if (busy) return;
    e.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!bodyRef.current?.contains(e.relatedTarget as Node | null)) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void runAi(f);
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!form.firstName.trim() && !form.lastName.trim() && !form.passportNo.trim()) {
      next.firstName = "حداقل نام، نام خانوادگی یا شماره پاسپورت را وارد کنید";
    }
    if (!form.representativeId) {
      next.representativeId = "هر مشتری باید زیر یک نماینده ثبت شود";
    }
    if (!form.listId) {
      next.listId = "هر مشتری باید در یک لیست قرار بگیرد";
    }
    if (!customer && withRequest && !reqVisaType) {
      next.visaType = "نوع ویزا را انتخاب کنید یا با تایپ، نوع جدید بسازید";
    }
    for (const field of fields) {
      const val = form.customValues[field.key];
      const empty = val == null || val === "" || (Array.isArray(val) && val.length === 0);
      if (field.required && empty) {
        next[field.key] = "این فیلد الزامی است";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const input = {
        firstName: form.firstName,
        lastName: form.lastName,
        birthDate: form.birthDate ?? undefined,
        passportNo: form.passportNo,
        passportIssueDate: form.passportIssueDate ?? undefined,
        passportExpiryDate: form.passportExpiryDate ?? undefined,
        referrer: form.referrer,
        notes: form.notes,
        representativeId: form.representativeId,
        listId: form.listId,
        registrationDate: form.registrationDate || todayIso(),
        customValues: form.customValues,
      };
      if (customer) {
        await updateCustomer(customer.id, input);
        toast.success("مشتری ویرایش شد");
        onSaved?.({ ...customer, ...input });
      } else {
        const created = await createCustomer(input);
        // Save the source document into the customer's document slots.
        if (smartFile) {
          try {
            await saveAttachment(created.id, "passport", smartFile);
          } catch {
            toast.error("ذخیرهٔ فایل مدرک ناموفق بود (مشتری ثبت شد)");
          }
        }
        // Register the visa request together with the customer — same
        // representative, list and registration date. No re-asking.
        if (withRequest && reqVisaType) {
          await createRequest({
            customerId: created.id,
            representativeId: form.representativeId,
            listId: form.listId,
            visaType: reqVisaType,
            tags: [],
            quotedAmount: reqAmount ?? undefined,
            currency: reqAmount != null ? reqCurrency : undefined,
            registrationDate: input.registrationDate,
            issued: false,
            issuedAt: null,
          });
          toast.success(`مشتری «${customerFullName(created)}» با درخواست «${reqVisaType}» ثبت شد`);
        } else {
          toast.success(`مشتری «${customerFullName(created)}» ثبت شد`);
        }
        onSaved?.(created);
      }
      // Remember list, representative and visa type for the next entry.
      if (prefsRef.current.rememberLastSelections) {
        await updatePrefs({
          lastRepresentativeId: form.representativeId,
          lastListId: form.listId,
          defaultVisaType: !customer && withRequest && reqVisaType ? reqVisaType : prefsRef.current.defaultVisaType,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره مشتری");
    } finally {
      setSaving(false);
    }
  };

  const liveFilled = Object.keys(aiMarks).length;
  const stageText =
    ai.t === "busy" && ai.progress
      ? `${AI_STAGES[ai.progress.stage] ?? "پردازش"}${
          ai.progress.totalPages
            ? ` — صفحهٔ ${toPersianDigits(ai.progress.page)} از ${toPersianDigits(ai.progress.totalPages)}`
            : ""
        }${liveFilled > 0 ? ` — ${toPersianDigits(liveFilled)} فیلد پر شد` : ""}`
      : "شروع…";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? "ویرایش مشتری" : "مشتری جدید"}
      subtitle={
        customer
          ? undefined
          : "لیست و نماینده الزامی است — بقیه فیلدها را می‌توانید بعداً کامل کنید"
      }
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {customer ? "ذخیره تغییرات" : "ثبت مشتری"}
          </Button>
        </div>
      }
    >
      <div
        ref={bodyRef}
        data-page-form
        className="relative flex flex-col gap-4"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* ---- AI quick-fill bar ---- */}
        <div className="relative overflow-hidden rounded-2xl border border-[#6366f1]/25 bg-gradient-to-l from-[#6366f1]/10 via-[#8b5cf6]/10 to-[#d946ef]/10 px-3.5 py-3 dark:border-[#818cf8]/25">
          <div className="pointer-events-none absolute -top-12 left-1/4 size-32 rounded-full bg-[#8b5cf6]/25 blur-2xl" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-lg shadow-[#6366f1]/35 transition-all hover:shadow-[#6366f1]/55 hover:brightness-110 active:scale-95 disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} className="transition-transform duration-300 group-hover:rotate-12" />
                )}
                {busy ? "در حال خواندن…" : "پرکردن با AI"}
              </button>
              <p className="hidden min-w-0 text-[11px] leading-4 text-ink-500 sm:block dark:text-ink-400">
                {busy ? stageText : "عکس یا PDF مدرک را بدهید — همین فرم خودکار پر می‌شود"}
              </p>
            </div>
            {ai.t === "done" && (
              <span className="inline-flex shrink-0 flex-wrap items-center gap-2 text-[11px] font-bold">
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  {toPersianDigits(ai.filled)} فیلد پر شد
                </span>
                {ai.review > 0 && (
                  <span className="inline-flex items-center gap-1 text-[#c77d0a] dark:text-[#f5b84f]">
                    <AlertTriangle size={12} />
                    {toPersianDigits(ai.review)} مورد بازبینی
                  </span>
                )}
              </span>
            )}
          </div>
          {busy && (
            <div className="relative mt-2.5 h-1 overflow-hidden rounded-full bg-[#6366f1]/15">
              <div
                className="h-full rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] transition-all duration-300"
                style={{ width: `${Math.max(5, (ai as { progress: PipelineProgress | null }).progress?.percent ?? 5)}%` }}
              />
            </div>
          )}
          {!busy && ai.t === "done" && (
            <p className="relative mt-2 truncate text-[10.5px] leading-4 text-ink-500 dark:text-ink-400">
              از «{ai.fileName}» — نشان‌ها را سریع چک کنید و نماینده/لیست/نوع ویزا را انتخاب کنید
            </p>
          )}
          {!busy && ai.t === "error" && (
            <p className="relative mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-rose-600 dark:text-rose-400">
              <AlertTriangle size={12} className="shrink-0" />
              {ai.message}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/bmp,.pdf,.jpg,.jpeg,.png,.webp,.bmp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void runAi(f);
            }}
          />
        </div>

        {/* List & representative — every customer MUST belong to both. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="نماینده"
            required
            error={errors.representativeId}
            hint="مشتری زیر این نماینده ثبت می‌شود"
          >
            <SearchSelect
              items={(representatives ?? []).map((r) => ({ id: r.id, title: r.name, subtitle: r.phone }))}
              value={form.representativeId}
              onSelect={(v) => setForm({ ...form, representativeId: v })}
              placeholder="انتخاب نماینده…"
              clearable={false}
            />
          </FormField>
          <FormField
            label="لیست"
            required
            error={errors.listId}
            hint="مشتری در این لیست قرار می‌گیرد"
          >
            <SearchSelect
              items={(lists ?? []).map((l) => ({ id: l.id, title: l.name }))}
              value={form.listId}
              onSelect={(v) => setForm({ ...form, listId: v })}
              placeholder="انتخاب لیست…"
              clearable={false}
            />
          </FormField>
        </div>

        {/* Identity — AI fills these directly; the violet sweep marks them. */}
        <div key={aiRun} className={aiRun > 0 ? "ai-flash grid grid-cols-1 gap-4 sm:grid-cols-2" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
          <FormField
            label={
              <>
                نام <AiMark state={aiMarks.firstName} />
              </>
            }
            error={errors.firstName}
          >
            <Input
              value={form.firstName}
              onChange={(e) => touch("firstName", e.target.value)}
              placeholder="مثلاً زهرا"
            />
          </FormField>
          <FormField
            label={
              <>
                نام خانوادگی <AiMark state={aiMarks.lastName} />
              </>
            }
          >
            <Input
              value={form.lastName}
              onChange={(e) => touch("lastName", e.target.value)}
              placeholder="مثلاً موسوی"
            />
          </FormField>
          <FormField
            label={
              <>
                شماره پاسپورت <AiMark state={aiMarks.passportNo} />
              </>
            }
            hint="در صورت تکراری بودن، هشدار می‌گیرید"
          >
            <Input
              dir="ltr"
              className="text-left"
              value={form.passportNo}
              onChange={(e) => touch("passportNo", e.target.value.toUpperCase())}
              onBlur={() => void checkDuplicate(form.passportNo)}
              placeholder="A12345678"
            />
          </FormField>
          <FormField label="معرف">
            <Input
              value={form.referrer}
              onChange={(e) => setForm({ ...form, referrer: e.target.value })}
              placeholder="چه کسی معرفی کرده؟"
            />
          </FormField>
          <FormField
            label={
              <>
                تاریخ تولد <AiMark state={aiMarks.birthDate} />
              </>
            }
            hint={calMode === "gregorian" ? "میلادی" : "شمسی"}
          >
            <DatePicker
              calendar={calMode}
              value={form.birthDate}
              onChange={(iso) => touch("birthDate", iso)}
            />
          </FormField>
          <FormField label="تاریخ ثبت">
            <JalaliDatePicker
              value={form.registrationDate}
              onChange={(iso) => setForm({ ...form, registrationDate: iso })}
              clearable={false}
            />
          </FormField>
          <FormField
            label={
              <>
                تاریخ صدور پاسپورت <AiMark state={aiMarks.passportIssueDate} />
              </>
            }
            hint={calMode === "gregorian" ? "میلادی" : "شمسی"}
          >
            <DatePicker
              calendar={calMode}
              value={form.passportIssueDate}
              onChange={(iso) => touch("passportIssueDate", iso)}
            />
          </FormField>
          <FormField
            label={
              <>
                تاریخ انقضای پاسپورت <AiMark state={aiMarks.passportExpiryDate} />
              </>
            }
            hint={calMode === "gregorian" ? "میلادی" : "شمسی"}
          >
            <DatePicker
              calendar={calMode}
              value={form.passportExpiryDate}
              onChange={(iso) => touch("passportExpiryDate", iso)}
            />
          </FormField>
        </div>

        {/* Simultaneous visa request — create mode only. */}
        {!customer && (
          <div className="rounded-2xl border border-ink-900/8 p-3.5 dark:border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13px] font-bold">
                  <FilePlus2 size={14} className="text-brand-500" />
                  ثبت همزمان درخواست ویزا
                </p>
                <p className="mt-0.5 text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                  با همان نماینده و لیستِ همین فرم ثبت می‌شود و دیگر لازم نیست جداگانه ثبتش کنید.
                  بعداً می‌توانید مبلغ، وضعیت صدور و مدارک را تکمیل کنید.
                </p>
              </div>
              <Toggle checked={withRequest} onChange={setWithRequest} />
            </div>
            {withRequest && (
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-ink-900/5 pt-3 sm:grid-cols-2 dark:border-white/5">
                <FormField label="نوع ویزا" required error={errors.visaType}>
                  <SearchSelect
                    items={visaTypeItems}
                    value={reqVisaType}
                    onSelect={setReqVisaType}
                    onCreate={async (name) => {
                      await createVisaType(name);
                      setReqVisaType(name);
                    }}
                    createLabel={(q) => `ایجاد و ثبت «${q}»`}
                    placeholder="انتخاب یا ساخت…"
                    clearable={false}
                  />
                </FormField>
                <FormField label="مبلغ پیشنهادی" hint="اختیاری — بعداً هم قابل ثبت است">
                  <MoneyInput
                    amount={reqAmount}
                    currency={reqCurrency}
                    onAmountChange={setReqAmount}
                    onCurrencyChange={setReqCurrency}
                  />
                </FormField>
              </div>
            )}
          </div>
        )}

        {dupWarning && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#f59e0b]/10 px-3.5 py-3 text-xs leading-5 text-[#c77d0a] dark:text-[#f5b84f]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {dupWarning} — می‌توانید ادامه دهید.
          </div>
        )}

        <FormField label="توضیحات">
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="یادداشت آزاد…"
          />
        </FormField>

        {fields.length > 0 && (
          <div className="border-t border-ink-900/5 pt-4 dark:border-white/5">
            <p className="mb-3 text-[13px] font-bold">فیلدهای سفارشی</p>
            <CustomFieldsGroup
              fields={fields}
              values={form.customValues}
              onChange={(key, value) =>
                setForm((f) => ({
                  ...f,
                  customValues: { ...f.customValues, [key]: value },
                }))
              }
              errors={errors}
            />
          </div>
        )}

        {/* Drag-anywhere drop zone */}
        {dragActive && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#6366f1] bg-white/85 backdrop-blur-[2px] dark:bg-ink-900/85">
            <Sparkles size={34} className="text-[#6366f1]" />
            <p className="text-[13px] font-bold">رها کنید تا با AI پر شود</p>
            <p className="text-[11px] text-ink-500 dark:text-ink-400">PDF یا عکس پاسپورت / تذکره / کارت شناسایی</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
