import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FilePlus2, ScanSearch, PencilLine } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea, Toggle } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { DatePicker } from "../ui/DatePicker";
import { SearchSelect } from "../ui/inputs";
import { MoneyInput } from "../ui/MoneyInput";
import { CustomFieldsGroup } from "../ui/CustomFields";
import { SmartExtract, type SmartExtractOutcome } from "./SmartExtract";
import { createCustomer, findDuplicatePassport, updateCustomer, customerFullName } from "../../db/customers";
import { createRequest } from "../../db/requests";
import { createVisaType } from "../../db/taxonomy";
import { updatePrefs } from "../../db/prefs";
import { saveAttachment } from "../../db/attachments";
import { useCustomFields, useLists, usePrefs, useRepresentatives, useVisaTypes } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso } from "../../utils/jalali";
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

  // Smart-extraction mode (create only): "smart" shows the document reader
  // first; "manual" is the classic form. The last *chosen* mode is remembered
  // (switching to the form view after applying extraction does not count).
  const [mode, setMode] = useState<"smart" | "manual">("smart");
  const [chosenMode, setChosenMode] = useState<"smart" | "manual">("smart");
  const [smartFile, setSmartFile] = useState<File | null>(null);

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
      setDupWarning(null);
      setErrors({});
      setSmartFile(null);
      // Remember the last *chosen* mode (smart extraction vs manual entry).
      const initial = prefsRef.current.lastCustomerFormMode ?? "smart";
      setMode(initial);
      setChosenMode(initial);
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
      const v = form.customValues[field.key];
      const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
      if (field.required && empty) {
        next[field.key] = "این فیلد الزامی است";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const applySmart = (o: SmartExtractOutcome) => {
    setForm((f) => ({
      ...f,
      firstName: o.firstName || f.firstName,
      lastName: o.lastName || f.lastName,
      passportNo: o.passportNo || f.passportNo,
      birthDate: o.birthDate ?? f.birthDate,
      passportIssueDate: o.passportIssueDate ?? f.passportIssueDate,
      passportExpiryDate: o.passportExpiryDate ?? f.passportExpiryDate,
      notes:
        [o.extras.nationalId && `شماره ملی/تذکره: ${o.extras.nationalId}`, o.extras.placeOfBirth && `محل تولد: ${o.extras.placeOfBirth}`, o.extras.fatherName && `نام پدر: ${o.extras.fatherName}`, o.extras.nationality && `ملیت: ${o.extras.nationality}`, o.extras.sex && `جنسیت: ${o.extras.sex === "M" ? "مرد" : o.extras.sex === "F" ? "زن" : o.extras.sex}`]
          .filter(Boolean)
          .join(" — ") || f.notes,
    }));
    setSmartFile(o.attachFile);
    setMode("manual");
    void checkDuplicate(o.passportNo);
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
      // Remember list, representative, mode and visa type for the next entry.
      if (prefsRef.current.rememberLastSelections) {
        await updatePrefs({
          lastRepresentativeId: form.representativeId,
          lastListId: form.listId,
          lastCustomerFormMode: chosenMode,
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
        mode === "smart" && !customer ? (
          <div className="flex items-center justify-end">
            <button className="btn btn-ghost" onClick={onClose}>
              انصراف
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
              انصراف
            </button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              {customer ? "ذخیره تغییرات" : "ثبت مشتری"}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {/* Mode switch — create mode only. Last choice is remembered. */}
        {!customer && (
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-ink-900/5 p-1.5 dark:bg-white/8">
            {([
              { id: "smart", label: "دستیار هوشمند", icon: ScanSearch, hint: "از روی مدرک بخوان" },
              { id: "manual", label: "ورود دستی", icon: PencilLine, hint: "خودم می‌نویسم" },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  setChosenMode(m.id);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-bold transition-all ${
                  mode === m.id
                    ? "bg-white text-brand-600 shadow-sm dark:bg-ink-800 dark:text-brand-300"
                    : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100"
                }`}
              >
                <m.icon size={15} />
                {m.label}
                <span className="text-[10px] font-normal opacity-70">{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* Smart extraction step (create mode, before the form fills). */}
        {!customer && mode === "smart" ? (
          <SmartExtract
            onApply={applySmart}
            onSkip={() => setMode("manual")}
          />
        ) : (
          <>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="نام" error={errors.firstName}>
            <Input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              placeholder="مثلاً زهرا"
            />
          </FormField>
          <FormField label="نام خانوادگی">
            <Input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              placeholder="مثلاً موسوی"
            />
          </FormField>
          <FormField label="شماره پاسپورت" hint="در صورت تکراری بودن، هشدار می‌گیرید">
            <Input
              dir="ltr"
              className="text-left"
              value={form.passportNo}
              onChange={(e) => setForm({ ...form, passportNo: e.target.value.toUpperCase() })}
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
          <FormField label="تاریخ تولد" hint={calMode === "gregorian" ? "میلادی" : "شمسی"}>
            <DatePicker
              calendar={calMode}
              value={form.birthDate}
              onChange={(iso) => setForm({ ...form, birthDate: iso })}
            />
          </FormField>
          <FormField label="تاریخ ثبت">
            <JalaliDatePicker
              value={form.registrationDate}
              onChange={(iso) => setForm({ ...form, registrationDate: iso })}
              clearable={false}
            />
          </FormField>
          <FormField label="تاریخ صدور پاسپورت" hint={calMode === "gregorian" ? "میلادی" : "شمسی"}>
            <DatePicker
              calendar={calMode}
              value={form.passportIssueDate}
              onChange={(iso) => setForm({ ...form, passportIssueDate: iso })}
            />
          </FormField>
          <FormField label="تاریخ انقضای پاسپورت" hint={calMode === "gregorian" ? "میلادی" : "شمسی"}>
            <DatePicker
              calendar={calMode}
              value={form.passportExpiryDate}
              onChange={(iso) => setForm({ ...form, passportExpiryDate: iso })}
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
          </>
        )}
      </div>
    </Modal>
  );
}
