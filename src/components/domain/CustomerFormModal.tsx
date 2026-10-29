import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Loader2,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
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
  ACCEPTED_MIME,
  AiAllWorkersFailedError,
  aiChat,
  buildExtractionMessages,
  CORE_FIELD_KEYS,
  fieldEnabled,
  isIsoDate,
  parseExtractionReply,
  prepareFilesForAi,
  validateAiFile,
  useAiSettings,
  useAiWorkers,
  type ExtractionPayload,
} from "../../lib/ai";
import { createCustomer, findDuplicatePassport, updateCustomer, customerFullName } from "../../db/customers";
import { createRequest } from "../../db/requests";
import { createVisaType } from "../../db/taxonomy";
import { updatePrefs } from "../../db/prefs";
import { saveAttachment } from "../../db/attachments";
import { useCustomFields, useLists, usePrefs, useRepresentatives, useVisaTypes, useEmployers } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso, toPersianDigits } from "../../utils/jalali";
import type { Currency, CustomFieldDef, Customer } from "../../types";

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
  /** Optional employer (کارفرما) — "" or null = بدون کارفرما. */
  employerId: string | null;
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
  employerId: null,
  registrationDate: null,
  customValues: {},
};

/** Identity fields the AI can fill — used for the per-field badges. */
type AiField =
  | "firstName"
  | "lastName"
  | "passportNo"
  | "birthDate"
  | "passportIssueDate"
  | "passportExpiryDate";

/** Live progress of the AI request pipeline. */
interface AiStageInfo {
  label: string;
  percent: number;
}

/** Smart-fill engine state (Cloudflare AI workers). */
type AiState =
  | { t: "idle" }
  | { t: "busy"; stage: AiStageInfo | null }
  | { t: "done"; filled: number; review: number; files: string }
  | { t: "error"; message: string; needsSetup?: boolean; canRetry?: boolean };

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
 * Light name sanitizer — Persian letters (or Latin A-Z) survive, stray
 * symbols and doubled spaces don't. The AI returns clean names; this is
 * just belt-and-braces before anything lands in the customer record.
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
  const employers = useEmployers();
  const lists = useLists();
  const visaTypes = useVisaTypes();
  const workers = useAiWorkers();
  const aiSettings = useAiSettings();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- AI quick-fill (user's Cloudflare workers → fixed JSON → this form) ----
  const [ai, setAi] = useState<AiState>({ t: "idle" });
  const [aiMarks, setAiMarks] = useState<Partial<Record<AiField, "ok" | "review">>>({});
  const [aiRun, setAiRun] = useState(0); // bump → identity grid re-mounts with the flash sweep
  /** Fields currently owned by the AI (the operator typing releases a slot). */
  const aiOwned = useRef<Set<AiField>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [smartFiles, setSmartFiles] = useState<File[]>([]); // auto-attached to the customer's documents
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Retry plumbing: last files, prepared images, cancel flag + aborter. */
  const aiFilesRef = useRef<File[]>([]);
  const aiPrepRef = useRef<{ images: string[]; summary: string } | null>(null);
  const aiCancelledRef = useRef(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiStateRef = useRef<AiState>({ t: "idle" });
  aiStateRef.current = ai;

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
  const employersRef = useRef(employers);
  employersRef.current = employers;

  const calMode = prefs.passportDateCalendar ?? "gregorian";

  /** کارفرما field is optional — the settings toggle hides it entirely. */
  const employerFieldOn = prefs.employerFieldEnabled !== false;

  const fields = useMemo(
    () =>
      (customFields ?? [])
        .filter((f) => f.entity === "customer" && f.showInForm && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [customFields],
  );

  // Mirror the latest form/fields so the async AI response always merges
  // into fresh state (the operator may keep typing while the model runs).
  const formRef = useRef(form);
  formRef.current = form;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const hasWorker = (workers ?? []).some((w) => w.enabled && w.url.trim() && w.key.trim());

  useEffect(() => {
    if (open) {
      setDupWarning(null);
      setErrors({});
      setAi({ t: "idle" });
      setAiMarks({});
      aiOwned.current = new Set();
      setAiRun(0);
      setDragActive(false);
      setSmartFiles([]);
      aiFilesRef.current = [];
      aiPrepRef.current = null;
      aiCancelledRef.current = false;
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
          employerId: customer.employerId ?? null,
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
        const lastEmployer =
          p.rememberLastSelections &&
          p.lastEmployerId &&
          (employersRef.current ?? []).some((e) => e.id === p.lastEmployerId)
            ? p.lastEmployerId
            : null;
        setForm({
          ...EMPTY,
          representativeId: lastRep,
          listId: lastList,
          employerId: lastEmployer,
          registrationDate: todayIso(),
        });
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
   * ownership of it, so its AI badge is dropped and no later extraction
   * can overwrite what the operator decided.
   */
  const touch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setAiMarks((m) => {
      if (m[key as AiField] == null) return m;
      const next = { ...m };
      delete next[key as AiField];
      return next;
    });
    aiOwned.current.delete(key as AiField);
  };

  /** Fixed payload key → form slot (the six identity fields the AI fills). */
  const FORM_SLOTS: Array<{
    key: string;
    field: AiField;
    kind: "name" | "passport" | "date";
  }> = [
    { key: "first_name", field: "firstName", kind: "name" },
    { key: "last_name", field: "lastName", kind: "name" },
    { key: "passport_number", field: "passportNo", kind: "passport" },
    { key: "date_of_birth", field: "birthDate", kind: "date" },
    { key: "issue_date", field: "passportIssueDate", kind: "date" },
    { key: "expiry_date", field: "passportExpiryDate", kind: "date" },
  ];

  /** Coerce a custom-field value the AI returned, or null when it doesn't
   *  fit the field type (never force garbage into a typed slot). */
  const customFieldValue = (
    field: CustomFieldDef,
    raw: unknown,
  ): string | number | null => {
    if (typeof raw !== "string") return null;
    const v = raw.trim();
    if (!v) return null;
    switch (field.type) {
      case "number":
        return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
      case "date":
        return isIsoDate(v) ? v : null;
      case "select":
        return (field.options ?? []).includes(v) ? v : null;
      case "text":
      case "textarea":
      case "url":
        return v.slice(0, 300);
      default:
        return null;
    }
  };

  /**
   * Write the fixed-schema payload into the form.
   *  • an empty slot takes any value;
   *  • a slot the AI filled earlier is refreshed by the new answer;
   *  • a slot the operator typed is never touched (aiOwned tracks this).
   * Custom fields (including ones added later) are filled the same way,
   * and document extras land in the notes.
   */
  const applyPayload = (payload: ExtractionPayload): { filled: number; review: number; customFilled: number } => {
    const uncertain = new Set(payload.uncertain);
    const toggles = aiSettings.fieldToggles;
    const current = formRef.current;
    const next: FormState = { ...current, customValues: { ...current.customValues } };
    const marks: Partial<Record<AiField, "ok" | "review">> = {};
    let filled = 0;
    let review = 0;

    for (const slot of FORM_SLOTS) {
      if (!fieldEnabled(toggles, slot.key)) continue; // switched off in settings
      const raw = payload[slot.key];
      if (typeof raw !== "string" || !raw.trim()) continue;
      let value: string | null = raw.trim();
      if (slot.kind === "name") value = safePersonName(raw);
      else if (slot.kind === "passport") value = raw.trim().toUpperCase().replace(/\s+/g, "");
      else if (slot.kind === "date" && !isIsoDate(raw)) continue; // skip malformed dates
      if (!value) continue;
      const existing = next[slot.field] as string | null;
      const isEmpty = existing == null || existing === "";
      if (!isEmpty && !aiOwned.current.has(slot.field)) continue; // operator typed — hands off
      (next as Record<AiField, string | null>)[slot.field] = value;
      aiOwned.current.add(slot.field);
      filled++;
      marks[slot.field] = uncertain.has(slot.key) ? "review" : "ok";
      if (uncertain.has(slot.key)) review++;
    }

    // Custom fields — filled only when empty, never over the operator.
    // Matching is tolerant: the model may mangle keys ("father_name" vs
    // "fathername") or echo the Persian label — normalize and match anyway.
    const norm = (s: string) => s.replace(/[\s_\-.]/g, "").toLowerCase();
    const payloadByNormKey = new Map<string, unknown>();
    for (const [k, v] of Object.entries(payload)) {
      if ((CORE_FIELD_KEYS as readonly string[]).includes(k)) continue;
      payloadByNormKey.set(norm(k), v);
    }
    let customFilled = 0;
    for (const field of fieldsRef.current) {
      if (!fieldEnabled(toggles, field.key)) continue; // switched off in settings
      const raw = payloadByNormKey.get(norm(field.key)) ?? payloadByNormKey.get(norm(field.label));
      if (raw == null) continue;
      const existing = next.customValues[field.key];
      const isEmpty = existing == null || existing === "" || (Array.isArray(existing) && existing.length === 0);
      if (!isEmpty) continue;
      const value = customFieldValue(field, raw);
      if (value == null) continue;
      next.customValues[field.key] = value;
      customFilled++;
    }

    // Document extras → a compact note line (only the switched-on ones).
    const extrasNote = [
      fieldEnabled(toggles, "nationality") && payload.nationality && `ملیت: ${payload.nationality}`,
      fieldEnabled(toggles, "place_of_birth") && payload.place_of_birth && `محل تولد: ${payload.place_of_birth}`,
      fieldEnabled(toggles, "sex") && payload.sex === "M" && "جنسیت: مرد",
      fieldEnabled(toggles, "sex") && payload.sex === "F" && "جنسیت: زن",
      fieldEnabled(toggles, "document_type") && payload.document_type && `نوع مدرک: ${payload.document_type}`,
    ]
      .filter(Boolean)
      .join(" — ");
    if (extrasNote) {
      next.notes = !next.notes
        ? extrasNote
        : next.notes.includes(extrasNote)
          ? next.notes
          : `${next.notes} — ${extrasNote}`;
    }

    setForm(next);
    if (Object.keys(marks).length > 0) setAiMarks(marks);
    return { filled, review, customFilled };
  };

  /** Shared error formatting for the smart-fill flow. */
  const aiErrorFrom = (e: unknown): AiState => {
    if (e instanceof AiAllWorkersFailedError) {
      return {
        t: "error",
        message:
          e.attempts.length === 0
            ? "هیچ ورکر فعالی تنظیم نشده است."
            : `همه حساب‌ها ناموفق بودند:\n${e.attempts
                .map((a) => `• ${a.label}: ${a.message}`)
                .join("\n")}`,
        needsSetup: e.attempts.length === 0,
        canRetry: e.attempts.length > 0,
      };
    }
    return {
      t: "error",
      message: e instanceof Error ? e.message : "خواندن فایل با خطا متوقف شد — دستی پر کنید.",
      canRetry: true,
    };
  };

  /** The AI step itself — re-runnable on the already-prepared images. */
  const classifyAndApply = async (images: string[]): Promise<void> => {
    const messages = buildExtractionMessages(images, {
      customFields: fieldsRef.current
        .filter((f) => fieldEnabled(aiSettings.fieldToggles, f.key))
        .map((f) => ({ key: f.key, label: f.label })),
    });
    aiAbortRef.current = new AbortController();
    const { text } = await aiChat(messages, {
      maxTokens: 2048,
      temperature: 0.1,
      signal: aiAbortRef.current.signal,
      onAttempt: ({ worker, index, total }) =>
        setAi((cur) =>
          cur.t === "busy"
            ? {
                t: "busy",
                stage: {
                  label:
                    total > 1 && index > 0
                      ? `حساب قبلی خطا داد — تلاش با «${worker.label}»…`
                      : `ارسال به هوش مصنوعی (${worker.label})…`,
                  percent: 65,
                },
              }
            : cur,
        ),
    });
    if (aiCancelledRef.current) return;
    setAi((cur) => (cur.t === "busy" ? { t: "busy", stage: { label: "خواندن پاسخ…", percent: 90 } } : cur));
    const payload = parseExtractionReply(text);
    const { filled, review } = applyPayload(payload);
    if (filled === 0) {
      throw new Error("هوش مصنوعی هیچ فیلدی از این مدرک نخواند — فرم را دستی پر کنید.");
    }
    setAiRun((n) => n + 1);
    setAi({
      t: "done",
      filled,
      review,
      files: aiPrepRef.current?.summary ?? "",
    });
    if (payload.passport_number) void checkDuplicate(payload.passport_number.toUpperCase());
  };

  const runAi = async (files: File[]) => {
    if (files.length === 0) return;
    if (!hasWorker) {
      setAi({
        t: "error",
        message: "هوش مصنوعی هنوز تنظیم نشده — اول ورکر Cloudflare را در تنظیمات اضافه کنید.",
        needsSetup: true,
      });
      return;
    }
    for (const f of files) {
      const err = validateAiFile(f);
      if (err) {
        setAi({ t: "error", message: err });
        return;
      }
    }
    aiCancelledRef.current = false;
    aiFilesRef.current = files;
    aiPrepRef.current = null;
    setAi({ t: "busy", stage: { label: "آماده‌سازی تصاویر…", percent: 5 } });
    setAiMarks({});
    // NOTE: aiOwned is deliberately NOT reset here — slots the previous upload
    // filled stay AI-owned so a re-upload can refresh them; only the operator
    // typing in a field releases it (touch()).
    setSmartFiles(files);
    try {
      const prep = await prepareFilesForAi(files, (s) =>
        setAi((cur) => (cur.t === "busy" ? { t: "busy", stage: s } : cur)),
      );
      if (aiCancelledRef.current) return;
      if (prep.images.length === 0) {
        setAi({ t: "error", message: "از این فایل هیچ تصویری ساخته نشد — فایل دیگری امتحان کنید." });
        return;
      }
      aiPrepRef.current = {
        images: prep.images,
        summary: prep.summary + (prep.truncated ? " (فقط ۶ تصویر اول ارسال شد)" : ""),
      };
      await classifyAndApply(prep.images);
    } catch (e) {
      if (aiCancelledRef.current) return;
      setAi(aiErrorFrom(e));
    }
  };

  /** «تلاش دوباره» — reuses the prepared images, so the PDF conversion and
   *  upload steps are never redone after a CORS/JSON/network error. */
  const retryAi = async () => {
    if (aiStateRef.current.t === "busy") return;
    if (!hasWorker) {
      setAi({
        t: "error",
        message: "هوش مصنوعی هنوز تنظیم نشده — اول ورکر Cloudflare را در تنظیمات اضافه کنید.",
        needsSetup: true,
      });
      return;
    }
    aiCancelledRef.current = false;
    const prep = aiPrepRef.current;
    if (prep && prep.images.length > 0) {
      setAi({ t: "busy", stage: { label: "تلاش دوباره…", percent: 65 } });
      try {
        await classifyAndApply(prep.images);
      } catch (e) {
        if (aiCancelledRef.current) return;
        setAi(aiErrorFrom(e));
      }
    } else if (aiFilesRef.current.length > 0) {
      await runAi(aiFilesRef.current);
    }
  };

  const cancelAi = () => {
    aiCancelledRef.current = true;
    aiAbortRef.current?.abort();
    setAi({ t: "idle" });
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
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void runAi(files);
  };

  // ---- paste images (screenshots) straight into the form ----
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      if (aiStateRef.current.t === "busy") return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return; // plain text paste stays untouched
      e.preventDefault();
      void runAi(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, runAi]);

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
        employerId: form.employerId || null,
        registrationDate: form.registrationDate || todayIso(),
        customValues: form.customValues,
      };
      if (customer) {
        await updateCustomer(customer.id, input);
        toast.success("مشتری ویرایش شد", { cause: "save" });
        onSaved?.({ ...customer, ...input });
      } else {
        const created = await createCustomer(input);
        // Save the source documents into the customer's document slots.
        if (smartFiles.length > 0) {
          let failed = 0;
          for (const file of smartFiles) {
            try {
              await saveAttachment(created.id, "passport", file);
            } catch {
              failed++;
            }
          }
          if (failed > 0) toast.error("ذخیرهٔ بعضی مدارک ناموفق بود (مشتری ثبت شد)");
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
            rejected: false,
            rejectedAt: null,
          });
          toast.success(`مشتری «${customerFullName(created)}» با درخواست «${reqVisaType}» ثبت شد`, { cause: "save" });
        } else {
          toast.success(`مشتری «${customerFullName(created)}» ثبت شد`, { cause: "save" });
        }
        onSaved?.(created);
      }
      // Remember list, representative, employer and visa type for the next entry.
      if (prefsRef.current.rememberLastSelections) {
        await updatePrefs({
          lastRepresentativeId: form.representativeId,
          lastListId: form.listId,
          lastEmployerId: form.employerId || null,
          defaultVisaType: !customer && withRequest && reqVisaType ? reqVisaType : prefsRef.current.defaultVisaType,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره مشتری", { cause: "save" });
    } finally {
      setSaving(false);
    }
  };

  const liveFilled = Object.keys(aiMarks).length;
  const stageText =
    ai.t === "busy" && ai.stage
      ? `${ai.stage.label}${liveFilled > 0 ? ` — ${toPersianDigits(liveFilled)} فیلد پر شد` : ""}`
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
              {hasWorker ? (
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
              ) : (
                <Link
                  to="/settings?tab=ai"
                  className="group inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-lg shadow-[#6366f1]/35 transition-all hover:shadow-[#6366f1]/55 hover:brightness-110 active:scale-95"
                >
                  <Settings2 size={15} />
                  فعال‌سازی هوش مصنوعی
                </Link>
              )}
              {busy && (
                <button
                  type="button"
                  className="btn btn-glass btn-sm shrink-0"
                  onClick={cancelAi}
                >
                  <X size={13} /> لغو
                </button>
              )}
              <p className="hidden min-w-0 text-[11px] leading-4 text-ink-500 sm:block dark:text-ink-400">
                {hasWorker
                  ? busy
                    ? stageText
                    : "چند عکس یا PDF مدرک را همزمان بدهید — همین فرم خودکار پر می‌شود"
                  : "اول ورکر Cloudflare خود را در تنظیمات اضافه کنید"}
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
                style={{ width: `${Math.max(5, (ai as { stage: AiStageInfo | null }).stage?.percent ?? 5)}%` }}
              />
            </div>
          )}
          {!busy && ai.t === "done" && (
            <p className="relative mt-2 truncate text-[10.5px] leading-4 text-ink-500 dark:text-ink-400">
              از {ai.files} — نشان‌ها را سریع چک کنید و نماینده/لیست/نوع ویزا را انتخاب کنید
            </p>
          )}
          {!busy && ai.t === "error" && (
            <div className="relative mt-2 flex flex-col gap-1.5">
              <p className="flex items-start gap-1.5 text-[11px] leading-5 text-rose-600 dark:text-rose-400">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0 whitespace-pre-line">{ai.message}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {ai.canRetry && (
                  <button type="button" className="btn btn-glass btn-sm w-fit" onClick={() => void retryAi()}>
                    <RotateCcw size={13} /> تلاش دوباره
                  </button>
                )}
                {ai.needsSetup && (
                  <Link to="/settings?tab=ai" className="btn btn-glass btn-sm w-fit">
                    <Settings2 size={13} /> رفتن به تنظیمات هوش مصنوعی
                  </Link>
                )}
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPTED_MIME}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void runAi(files);
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

        {/* کارفرما — always OPTIONAL; «بدون کارفرما» is a first-class choice.
            Hidden entirely when the feature is switched off in Settings. */}
        {employerFieldOn && (
          <FormField
            label="کارفرما"
            hint={
              (employers ?? []).length === 0
                ? "اختیاری — کارفرماها را از تنظیمات ← کارفرماها اضافه کنید"
                : "اختیاری — می‌توانید «بدون کارفرما» را انتخاب کنید"
            }
          >
            <SearchSelect
              items={[
                { id: "", title: "بدون کارفرما" },
                ...(employers ?? []).map((e) => ({
                  id: e.id,
                  title: e.name,
                  subtitle: e.phone,
                })),
              ]}
              value={form.employerId ?? ""}
              onSelect={(v) => setForm({ ...form, employerId: v || null })}
              placeholder="انتخاب کارفرما…"
              clearable={false}
            />
          </FormField>
        )}

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
                    currencies={["IRT", "USD"]}
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
            <p className="text-[11px] text-ink-500 dark:text-ink-400">
              یک یا چند فایل — عکس یا PDF پاسپورت / تذکره / کارت شناسایی
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
