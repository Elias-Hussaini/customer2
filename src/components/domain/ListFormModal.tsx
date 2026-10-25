import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { createList, updateList } from "../../db/lists";
import { useToast } from "../../hooks/useToast";
import type { ListFolder } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  list?: ListFolder;
  onSaved?: (list: ListFolder) => void;
}

interface FormState {
  name: string;
  category: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
}

const EMPTY: FormState = { name: "", category: "", startDate: null, endDate: null, description: "" };

export function ListFormModal({ open, onClose, list, onSaved }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
      setForm(
        list
          ? {
              name: list.name,
              category: list.category ?? "",
              startDate: list.startDate ?? null,
              endDate: list.endDate ?? null,
              description: list.description ?? "",
            }
          : EMPTY,
      );
    }
  }, [open, list]);

  const save = async () => {
    if (!form.name.trim()) {
      setError("نام لیست الزامی است");
      return;
    }
    setSaving(true);
    try {
      if (list) {
        await updateList(list.id, {
          name: form.name,
          category: form.category,
          startDate: form.startDate ?? undefined,
          endDate: form.endDate ?? undefined,
          description: form.description,
        });
        toast.success("لیست ویرایش شد");
        onSaved?.({ ...list });
      } else {
        const created = await createList({
          name: form.name,
          category: form.category,
          startDate: form.startDate ?? undefined,
          endDate: form.endDate ?? undefined,
          description: form.description,
        });
        toast.success(`لیست «${created.name}» ساخته شد`);
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره لیست");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={list ? "ویرایش لیست" : "لیست جدید"}
      subtitle="مثل «ویزای داخله» یا «درخواست‌های مهر — آبان»"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {list ? "ذخیره تغییرات" : "ساخت لیست"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نام لیست" required error={error}>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="مثلاً درخواست‌های آبان"
          />
        </FormField>
        <FormField label="دسته‌بندی" hint="اختیاری — مثل داخلی، فوری، تکمیل‌شده">
          <Input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="مثلاً داخلی"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="از تاریخ">
            <JalaliDatePicker
              value={form.startDate}
              onChange={(iso) => setForm({ ...form, startDate: iso })}
            />
          </FormField>
          <FormField label="تا تاریخ">
            <JalaliDatePicker
              value={form.endDate}
              onChange={(iso) => setForm({ ...form, endDate: iso })}
            />
          </FormField>
        </div>
        <FormField label="توضیحات">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
      </div>
    </Modal>
  );
}
