/** Create / edit an accounting party (individual or company). */

import { useEffect, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Checkbox, Input, Textarea } from "../../components/ui/fields";
import { FormField } from "../../components/ui/fields";
import { RadioSelect } from "../../components/ui/inputs";
import { useToast } from "../../hooks/useToast";
import { createParty, findPartyDuplicates, updateParty, type PartyInput } from "../repo";
import { PARTY_TYPE_LABELS, type AccParty, type PartyType } from "../types";

interface PartyFormModalProps {
  open: boolean;
  onClose: () => void;
  editParty?: AccParty | null;
  /** Pre-filled name (e.g. from a quick-create flow). */
  defaultName?: string;
  onCreated?: (party: AccParty) => void;
}

const EMPTY: PartyInput = {
  type: "individual",
  name: "",
  phone: "",
  email: "",
  address: "",
  idNumber: "",
  regNumber: "",
  notes: "",
  tags: [],
  active: true,
};

export function PartyFormModal({ open, onClose, editParty, defaultName, onCreated }: PartyFormModalProps) {
  const toast = useToast();
  const [form, setForm] = useState<PartyInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setWarnings([]);
    if (editParty) {
      setForm({
        type: editParty.type,
        name: editParty.name,
        phone: editParty.phone ?? "",
        email: editParty.email ?? "",
        address: editParty.address ?? "",
        idNumber: editParty.idNumber ?? "",
        regNumber: editParty.regNumber ?? "",
        notes: editParty.notes ?? "",
        tags: editParty.tags ?? [],
        active: editParty.active,
      });
    } else {
      setForm({ ...EMPTY, name: defaultName ?? "" });
    }
  }, [open, editParty, defaultName]);

  const set = <K extends keyof PartyInput>(key: K, value: PartyInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Live duplicate warnings (non-blocking).
  useEffect(() => {
    if (!open || !form.name.trim()) {
      setWarnings([]);
      return;
    }
    let cancelled = false;
    void findPartyDuplicates(form, editParty?.id).then((w) => {
      if (!cancelled) setWarnings(w);
    });
    return () => {
      cancelled = true;
    };
  }, [form, open, editParty]);

  const save = async () => {
    if (busy) return;
    if (!form.name.trim()) {
      toast.error("نام طرف حساب الزامی است.");
      return;
    }
    setBusy(true);
    try {
      if (editParty) {
        await updateParty(editParty.id, form);
        toast.success(`حساب ${editParty.code} به‌روزرسانی شد`);
      } else {
        const party = await createParty(form);
        toast.success(`حساب ${party.code} برای «${party.name}» ایجاد شد`);
        onCreated?.(party);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editParty ? `ویرایش حساب ${editParty.code}` : "طرف حساب جدید"}
      subtitle="شخص حقیقی یا شرکت — کد حساب به‌طور خودکار ساخته می‌شود"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {editParty ? "ذخیره تغییرات" : "ایجاد حساب"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نوع حساب" required>
          <RadioSelect
            options={[
              { value: "individual", label: PARTY_TYPE_LABELS.individual },
              { value: "company", label: PARTY_TYPE_LABELS.company },
            ]}
            value={form.type}
            onChange={(v) => set("type", v as PartyType)}
          />
        </FormField>

        <FormField label={form.type === "company" ? "نام شرکت" : "نام کامل"} required>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.type === "company" ? "مثلاً: شرکت سفر_parsian" : "مثلاً: علی رضایی"}
          />
        </FormField>

        {warnings.length > 0 && (
          <div className="rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3 text-xs font-semibold leading-6 text-[#c77d0a] dark:text-[#f5b84f]">
            {warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
            <p className="mt-1 font-medium">اگر مطمئنید حساب تکراری نیست، ادامه دهید.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="شماره تلفن">
            <Input dir="ltr" className="text-left" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="09…" />
          </FormField>
          <FormField label="ایمیل">
            <Input dir="ltr" className="text-left" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@mail.com" />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={form.type === "company" ? "شناسه ملی شرکت" : "کد ملی / شماره شناسنامه"}
            hint="اختیاری — فقط اگر لازم دارید"
          >
            <Input dir="ltr" className="text-left" value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} placeholder="—" />
          </FormField>
          {form.type === "company" && (
            <FormField label="شماره ثبت">
              <Input dir="ltr" className="text-left" value={form.regNumber} onChange={(e) => set("regNumber", e.target.value)} placeholder="—" />
            </FormField>
          )}
        </div>

        <FormField label="نشانی">
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="—" />
        </FormField>

        <FormField label="یادداشت">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="توضیحات، شرایط همکاری و…" />
        </FormField>

        <Checkbox checked={form.active} onChange={(v) => set("active", v)} label="حساب فعال باشد" />
      </div>
    </Modal>
  );
}
