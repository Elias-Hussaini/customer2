import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { createRepresentative, updateRepresentative } from "../../db/reps";
import { useToast } from "../../hooks/useToast";
import type { Representative } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  representative?: Representative;
  onSaved?: (rep: Representative) => void;
}

interface FormState {
  name: string;
  phone: string;
  contactInfo: string;
  notes: string;
}

const EMPTY: FormState = { name: "", phone: "", contactInfo: "", notes: "" };

export function RepresentativeFormModal({ open, onClose, representative, onSaved }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
      setForm(
        representative
          ? {
              name: representative.name,
              phone: representative.phone ?? "",
              contactInfo: representative.contactInfo ?? "",
              notes: representative.notes ?? "",
            }
          : EMPTY,
      );
    }
  }, [open, representative]);

  const save = async () => {
    if (!form.name.trim()) {
      setError("نام نماینده الزامی است");
      return;
    }
    setSaving(true);
    try {
      if (representative) {
        await updateRepresentative(representative.id, form);
        toast.success("نماینده ویرایش شد", { cause: "save" });
        onSaved?.({ ...representative, ...form });
      } else {
        const created = await createRepresentative(form);
        toast.success(`نماینده «${created.name}» ثبت شد`, { cause: "save" });
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره نماینده", { cause: "save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={representative ? "ویرایش نماینده" : "نماینده جدید"}
      subtitle="نماینده‌ها سفارش‌های ویزا ارسال می‌کنند"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {representative ? "ذخیره تغییرات" : "ثبت نماینده"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نام و نام خانوادگی" required error={error}>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="مثلاً علی رضایی"
          />
        </FormField>
        <FormField label="شماره تماس">
          <Input
            dir="ltr"
            className="text-left"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="09121234567"
          />
        </FormField>
        <FormField label="راه‌های ارتباطی دیگر" hint="مثل آیدی تلگرام یا واتساپ">
          <Input
            value={form.contactInfo}
            onChange={(e) => setForm({ ...form, contactInfo: e.target.value })}
          />
        </FormField>
        <FormField label="یادداشت">
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </FormField>
      </div>
    </Modal>
  );
}
