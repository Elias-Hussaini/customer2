import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { createList, updateList, moveList, isDescendant } from "../../db/lists";
import { useLists } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import type { ListFolder } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  list?: ListFolder;
  /** Default parent when CREATING (the folder the explorer is inside). */
  parentId?: string | null;
  onSaved?: (list: ListFolder) => void;
}

interface FormState {
  name: string;
  category: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
  parentId: string;
}

const EMPTY: FormState = { name: "", category: "", startDate: null, endDate: null, description: "", parentId: "" };

export function ListFormModal({ open, onClose, list, parentId, onSaved }: Props) {
  const toast = useToast();
  const lists = useLists(false);
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
              parentId: list.parentId ?? "",
            }
          : { ...EMPTY, parentId: parentId ?? "" },
      );
    }
  }, [open, list, parentId]);

  /** Candidate parents: every active folder except this one and its descendants. */
  const parentOptions = (lists ?? []).filter(
    (l) =>
      !l.archivedAt &&
      l.id !== list?.id &&
      !(list && isDescendant(lists ?? [], list.id, l.id)),
  );

  const save = async () => {
    if (!form.name.trim()) {
      setError("نام پوشه الزامی است");
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: form.name,
        category: form.category,
        startDate: form.startDate ?? undefined,
        endDate: form.endDate ?? undefined,
        description: form.description,
        parentId: form.parentId || null,
      };
      if (list) {
        await updateList(list.id, input);
        if ((list.parentId ?? "") !== (form.parentId || "")) {
          await moveList(list.id, form.parentId || null);
        }
        toast.success("پوشه ویرایش شد", { cause: "save" });
        onSaved?.({ ...list });
      } else {
        const created = await createList(input);
        toast.success(`پوشه «${created.name}» ساخته شد`, { cause: "save" });
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره پوشه", { cause: "save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={list ? "ویرایش پوشه" : "پوشه جدید"}
      subtitle="مثل پوشه ویندوز — می‌توانید داخل پوشه دیگری بسازید"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {list ? "ذخیره تغییرات" : "ساخت پوشه"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نام پوشه" required error={error}>
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
        <FormField label="محل پوشه" hint="داخل کدام پوشه ساخته شود">
          <select
            className="field"
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          >
            <option value="">خانه (بدون پوشه والد)</option>
            {parentOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
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
