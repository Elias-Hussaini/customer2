/**
 * کارفرما form — the full contact/ID/credentials record plus any custom
 * fields defined for the employer entity (Settings → فیلدهای سفارشی).
 * Duplicate detection (same name / same کد ملی) is non-blocking: it warns
 * once, then the button turns into «ذخیره به هر حال».
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { CustomFieldsGroup } from "../ui/CustomFields";
import {
  createEmployer,
  findEmployerDuplicates,
  updateEmployer,
  type EmployerInput,
} from "../../db/employers";
import { useCustomFields } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import type { Employer } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  employer?: Employer | null;
  onSaved?: (employer: Employer) => void;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  nationalId: string;
  username: string;
  password: string;
  address: string;
  postalCode: string;
  notes: string;
  customValues: Record<string, unknown>;
}

const EMPTY: FormState = {
  name: "",
  phone: "",
  email: "",
  nationalId: "",
  username: "",
  password: "",
  address: "",
  postalCode: "",
  notes: "",
  customValues: {},
};

export function EmployerFormModal({ open, onClose, employer, onSaved }: Props) {
  const toast = useToast();
  const allCustom = useCustomFields();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState("");
  const [dupWarnings, setDupWarnings] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
      setDupWarnings([]);
      setShowPassword(false);
      setForm(
        employer
          ? {
              name: employer.name,
              phone: employer.phone ?? "",
              email: employer.email ?? "",
              nationalId: employer.nationalId ?? "",
              username: employer.username ?? "",
              password: employer.password ?? "",
              address: employer.address ?? "",
              postalCode: employer.postalCode ?? "",
              notes: employer.notes ?? "",
              customValues: employer.customValues ?? {},
            }
          : EMPTY,
      );
    }
  }, [open, employer]);

  const employerCustomFields = useMemo(
    () =>
      (allCustom ?? [])
        .filter((f) => f.entity === "employer" && f.showInForm && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [allCustom],
  );

  const save = async (force = false) => {
    if (!form.name.trim()) {
      setError("نام کارفرما الزامی است");
      return;
    }
    setSaving(true);
    try {
      const input: EmployerInput = {
        ...form,
        customValues: form.customValues,
      };
      if (!force) {
        const warnings = await findEmployerDuplicates(input, employer?.id);
        if (warnings.length > 0) {
          setDupWarnings(warnings);
          setSaving(false);
          return;
        }
      }
      setDupWarnings([]);
      if (employer) {
        await updateEmployer(employer.id, input);
        toast.success("کارفرما ویرایش شد", { cause: "save" });
        onSaved?.({ ...employer, ...input, customValues: form.customValues });
      } else {
        const created = await createEmployer(input);
        toast.success(`کارفرما «${created.name}» ثبت شد`, { cause: "save" });
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره کارفرما", { cause: "save" });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={employer ? `ویرایش «${employer.name}»` : "کارفرمای جدید"}
      subtitle="اطلاعات تماس، هویتی و دسترسی‌ها"
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save(dupWarnings.length > 0)} loading={saving}>
            {employer ? "ذخیره تغییرات" : dupWarnings.length > 0 ? "ذخیره به هر حال" : "ثبت کارفرما"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {dupWarnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3.5 py-3 text-[12px] font-bold leading-6 text-amber-700 dark:text-amber-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {dupWarnings.map((w) => (
                <span key={w} className="block">
                  {w}
                </span>
              ))}
              «ذخیره به هر حال» را بزنید تا ادامه دهد.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="نام" required error={error} className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="مثلاً شرکت ساختمانی نیکان"
              autoFocus
            />
          </FormField>
          <FormField label="شماره تماس">
            <Input
              dir="ltr"
              className="text-left"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="07xx xxx xxxx"
            />
          </FormField>
          <FormField label="ایمیل">
            <Input
              dir="ltr"
              className="text-left"
              inputMode="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="info@example.com"
            />
          </FormField>
          <FormField label="کد ملی">
            <Input
              dir="ltr"
              className="num text-left"
              inputMode="numeric"
              value={form.nationalId}
              onChange={(e) => set("nationalId", e.target.value)}
              placeholder="۰۰۱۲۳۴۵۶۷۸"
            />
          </FormField>
          <FormField label="کد پستی">
            <Input
              dir="ltr"
              className="num text-left"
              inputMode="numeric"
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
            />
          </FormField>
          <FormField label="نام کاربری">
            <Input
              dir="ltr"
              className="text-left"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </FormField>
          <FormField label="رمز عبور" hint="فقط روی همین دستگاه ذخیره می‌شود">
            <div className="relative">
              <Input
                dir="ltr"
                className="pl-10 text-left"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-ink-400 transition-colors hover:text-brand-600 dark:hover:text-brand-300"
                title={showPassword ? "پنهان کردن" : "نمایش"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </FormField>
          <FormField label="آدرس" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="کابل، چهارراهی…"
            />
          </FormField>
        </div>

        {employerCustomFields.length > 0 && (
          <div className="rounded-3xl border border-ink-900/5 p-4 dark:border-white/10">
            <p className="mb-3 text-[12px] font-extrabold text-ink-600 dark:text-ink-300">فیلدهای سفارشی کارفرما</p>
            <CustomFieldsGroup
              fields={employerCustomFields}
              values={form.customValues}
              onChange={(key, value) =>
                set("customValues", { ...form.customValues, [key]: value })
              }
            />
          </div>
        )}

        <FormField label="یادداشت">
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  );
}
