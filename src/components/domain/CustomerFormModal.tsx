import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { CustomFieldsGroup } from "../ui/CustomFields";
import { createCustomer, findDuplicatePassport, updateCustomer, customerFullName } from "../../db/customers";
import { useCustomFields } from "../../hooks/useData";
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
  registrationDate: null,
  customValues: {},
};

export function CustomerFormModal({ open, onClose, customer, onSaved }: Props) {
  const toast = useToast();
  const customFields = useCustomFields();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
          registrationDate: customer.registrationDate,
          customValues: { ...(customer.customValues ?? {}) },
        });
      } else {
        setForm({ ...EMPTY, registrationDate: todayIso() });
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
      subtitle="همه فیلدها اختیاری هستند — حتی فقط با یک نام ذخیره کنید"
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
          <FormField label="تاریخ تولد">
            <JalaliDatePicker
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
          <FormField label="تاریخ صدور پاسپورت">
            <JalaliDatePicker
              value={form.passportIssueDate}
              onChange={(iso) => setForm({ ...form, passportIssueDate: iso })}
            />
          </FormField>
          <FormField label="تاریخ انقضای پاسپورت">
            <JalaliDatePicker
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
