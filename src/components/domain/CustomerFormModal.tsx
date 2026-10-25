import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { DatePicker } from "../ui/DatePicker";
import { SearchSelect } from "../ui/inputs";
import { CustomFieldsGroup } from "../ui/CustomFields";
import { createCustomer, findDuplicatePassport, updateCustomer, customerFullName } from "../../db/customers";
import { updatePrefs } from "../../db/prefs";
import { useCustomFields, useLists, usePrefs, useRepresentatives } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso } from "../../utils/jalali";
import type { Customer } from "../../types";

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
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        toast.success(`مشتری «${customerFullName(created)}» ثبت شد`);
        onSaved?.(created);
      }
      // Remember list & representative for the next quick entry.
      if (prefsRef.current.rememberLastSelections) {
        await updatePrefs({
          lastRepresentativeId: form.representativeId,
          lastListId: form.listId,
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
      <div className="flex flex-col gap-4">
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
      </div>
    </Modal>
  );
}
