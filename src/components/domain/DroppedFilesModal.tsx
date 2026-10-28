import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Save } from "lucide-react";
import { saveAttachment } from "../../db/attachments";
import { getDocTypesForCustomer } from "../../db/docTypes";
import { FilterSelect } from "../ui/inputs";
import { Modal } from "../ui/Modal";
import { fileKindIcon } from "../ui/DropZone";
import { useToast } from "../../hooks/useToast";
import { toPersianDigits } from "../../utils/jalali";
import { formatNumber } from "../../utils/num";

/**
 * Slot picker for files dropped anywhere on a customer profile: each file gets
 * a destination selector (default «سایر مدارک») and one save button files the
 * whole batch. Compression at rest is applied automatically by saveAttachment.
 */
export function DroppedFilesModal({
  files,
  customerId,
  onClose,
}: {
  files: File[] | null;
  customerId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const docTypes = useLiveQuery(() => getDocTypesForCustomer(customerId), [customerId]);
  const [slotByIndex, setSlotByIndex] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset per-batch selections whenever a fresh batch arrives.
  useEffect(() => {
    setSlotByIndex({});
  }, [files]);

  const list = files ?? [];
  const kindFor = (i: number) => slotByIndex[i] ?? "other";

  const save = async () => {
    if (list.length === 0 || saving) return;
    setSaving(true);
    let ok = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        await saveAttachment(customerId, kindFor(i), list[i]);
        ok++;
      }
      toast.success(
        ok > 1 ? `${toPersianDigits(ok)} فایل در پرونده ذخیره شد` : "فایل در پرونده ذخیره شد",
      );
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("ذخیره فایل‌ها با خطا مواجه شد");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={files != null && list.length > 0}
      onClose={saving ? () => undefined : onClose}
      title={`ذخیره ${toPersianDigits(list.length)} فایل در پرونده`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-glass btn-sm" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
            <Save size={14} />
            {saving ? "در حال ذخیره…" : `ذخیره ${toPersianDigits(list.length)} فایل`}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-[11.5px] leading-5 text-ink-500 dark:text-ink-400">
          برای هر فایل بخش مقصد را انتخاب کنید (پیش‌فرض: «سایر مدارک») — عکس‌ها به‌صورت خودکار
          بهینه می‌شوند.
        </p>
        <ul className="flex flex-col gap-2">
          {list.map((f, i) => {
            const Icon = fileKindIcon(f);
            return (
              <li key={`${f.name}-${i}`} className="glass-soft flex items-center gap-3 rounded-2xl px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold" title={f.name}>
                    {f.name}
                  </span>
                  <span className="num text-[11px] text-ink-400">
                    {formatNumber(Math.round(f.size / 1024))} کیلوبایت
                  </span>
                </span>
                <span className="w-[150px] shrink-0">
                  <FilterSelect
                    ariaLabel={`بخش مقصد ${f.name}`}
                    value={kindFor(i)}
                    onChange={(v) => setSlotByIndex((s) => ({ ...s, [i]: v }))}
                    options={[
                      { value: "other", label: "سایر مدارک" },
                      ...(docTypes ?? []).map((d) => ({ value: d.id, label: d.label })),
                    ]}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        <p className="flex items-center gap-1.5 text-[11px] text-[#0b9e6e] dark:text-[#3ddc9a]">
          <Check size={13} className="shrink-0" />
          فایل‌ها بلافاصله پس از ذخیره در پشتیبان‌گیری ZIP هم قرار می‌گیرند.
        </p>
      </div>
    </Modal>
  );
}
