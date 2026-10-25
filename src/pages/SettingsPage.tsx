import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Coins,
  DatabaseBackup,
  FileImage,
  Keyboard,
  Layers,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  Settings2,
  Smartphone,
  Sun,
  Tag as TagIcon,
  Trash2,
  Plane as VisaIcon,
  Wand2,
} from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard, RadioSelect } from "../components/ui/inputs";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { FormField, Input, Checkbox, Toggle, Select } from "../components/ui/fields";
import { EmptyState } from "../components/ui/EmptyState";
import { useTheme, type Theme } from "../hooks/useTheme";
import { useCustomFields, usePrefs, useTags, useVisaTypes, useCustomers, useDocTypes } from "../hooks/useData";
import { updatePrefs } from "../db/prefs";
import {
  TAG_PALETTE,
  createCustomField,
  createTag,
  createVisaType,
  deleteCustomField,
  deleteTag,
  reorderCustomField,
  updateCustomField,
  updateTag,
  archiveTag,
  restoreTag,
  archiveVisaType,
  restoreVisaType,
  renameVisaType,
} from "../db/taxonomy";
import {
  createDocType,
  updateDocType,
  reorderDocType,
  deleteDocType,
} from "../db/docTypes";
import { seedDemoData } from "../db/seed";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { FIELD_TYPE_LABELS, type CustomFieldDef, type FieldEntity, type FieldType, type Tag } from "../types";
import { toPersianDigits } from "../utils/jalali";
import { slugify } from "../utils/normalize";

type SettingsSection =
  | "appearance"
  | "shortcuts"
  | "fields"
  | "tags"
  | "visaTypes"
  | "docTypes"
  | "currency"
  | "defaults"
  | "backup"
  | "data"
  | "pwa";

const SECTIONS: { key: SettingsSection; label: string; icon: typeof Palette }[] = [
  { key: "appearance", label: "ظاهر", icon: Palette },
  { key: "shortcuts", label: "کلیدهای میان‌بر", icon: Keyboard },
  { key: "fields", label: "فیلدهای سفارشی", icon: Layers },
  { key: "tags", label: "تگ‌ها", icon: TagIcon },
  { key: "visaTypes", label: "انواع ویزا", icon: VisaIcon },
  { key: "docTypes", label: "مدارک و تصاویر", icon: FileImage },
  { key: "currency", label: "واحد پول", icon: Coins },
  { key: "defaults", label: "پیش‌فرض‌های فرم", icon: Wand2 },
  { key: "backup", label: "پشتیبان‌گیری", icon: DatabaseBackup },
  { key: "data", label: "مدیریت داده", icon: Settings2 },
  { key: "pwa", label: "درباره PWA", icon: Smartphone },
];

export function SettingsPage() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as SettingsSection | null;
  const [section, setSection] = useState<SettingsSection>(
    tabParam && SECTIONS.some((s) => s.key === tabParam) ? tabParam : "appearance",
  );

  // Deep links like /settings?tab=shortcuts (opened by the "?" shortcut).
  useEffect(() => {
    if (tabParam && SECTIONS.some((s) => s.key === tabParam)) setSection(tabParam);
  }, [tabParam]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="تنظیمات" subtitle="برنامه را مطابق گردش کار دفتر خودتان تنظیم کنید" />
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`chip shrink-0 ${section === s.key ? "" : "chip-soft"}`}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="glass hidden h-fit flex-col gap-1 rounded-3xl p-2 lg:flex">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-right text-[13px] font-semibold transition-colors ${
                section === s.key
                  ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
                  : "text-ink-600 hover:bg-brand-500/6 dark:text-ink-300"
              }`}
              onClick={() => setSection(s.key)}
            >
              <s.icon size={16} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-4">
          {section === "appearance" && <AppearanceSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "fields" && <CustomFieldsSection />}
          {section === "tags" && <TagsSection />}
          {section === "visaTypes" && <VisaTypesSection />}
          {section === "docTypes" && <DocTypesSection />}
          {section === "currency" && <CurrencySection />}
          {section === "defaults" && <DefaultsSection />}
          {section === "backup" && <BackupSection />}
          {section === "data" && <DataSection />}
          {section === "pwa" && <PwaSection />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Appearance ------------------------------ */

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <SectionCard title="ظاهر برنامه" icon={<Palette size={15} className="text-brand-500" />}>
      <div className="grid grid-cols-3 gap-2.5">
        {(
          [
            { key: "light", label: "روشن", icon: Sun },
            { key: "dark", label: "تاریک", icon: Moon },
            { key: "system", label: "هم‌گام سیستم", icon: Monitor },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-[12px] font-bold transition-all ${
              theme === opt.key
                ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300"
                : "border-ink-900/10 text-ink-500 hover:border-brand-400 dark:border-white/10 dark:text-ink-400"
            }`}
            onClick={() => {
              if (opt.key === "system") {
                const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                setTheme(sys);
                try {
                  localStorage.removeItem("customer2-theme");
                } catch {
                  /* ignore */
                }
              } else {
                setTheme(opt.key as Theme);
              }
            }}
          >
            <opt.icon size={20} />
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        انتخاب شما در همین مرورگر ذخیره می‌شود.
      </p>
    </SectionCard>
  );
}

/* ------------------------------ Shortcuts ------------------------------- */

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-brand-500/6 px-4 py-3">
      <span className="text-[12.5px] font-semibold">{label}</span>
      <span className="flex shrink-0 items-center gap-1" dir="ltr">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[10px] font-bold text-ink-400">+</span>}
            <kbd className="kbd">{k}</kbd>
          </span>
        ))}
      </span>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <>
      <SectionCard title="کلیدهای میان‌بر" icon={<Keyboard size={15} className="text-brand-500" />}>
        <div className="flex flex-col gap-2">
          <p className="mb-1 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            برای سرعت بیشتر، همه‌جا می‌توانید با کیبورد کار کنید — ثبت و ذخیره با یک کلید، باز
            کردن فرم‌ها با دو بار فشردن یک حرف. این راهنما را با کلید <kbd className="kbd">?</kbd> هم
            می‌توانید باز کنید.
          </p>
          <ShortcutRow keys={["Enter"]} label="ذخیره / تأیید فرم باز" />
          <ShortcutRow keys={["Ctrl", "S"]} label="ذخیره فرم فعال (همین صفحه)" />
          <ShortcutRow keys={["Shift", "Enter"]} label="خط جدید در متن چندخطی" />
          <ShortcutRow keys={["Ctrl", "Enter"]} label="ذخیره از داخل متن چندخطی" />
          <ShortcutRow keys={["Esc"]} label="بستن پنجره / منوی باز" />
        </div>
      </SectionCard>

      <SectionCard
        title="میان‌برهای دوبل (سریع)"
        icon={<Wand2 size={15} className="text-brand-500" />}
      >
        <div className="flex flex-col gap-2">
          <p className="mb-1 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            هر حرف را دو بار پشت‌سرهم (با فاصله کمتر از یک ثانیه) بزنید. وقتی داخل فیلد تایپ
            هستید یا پنجره‌ای باز است، این میان‌برها اجرا نمی‌شوند تا مزاحم تایپ شما نشوند.
          </p>
          <ShortcutRow keys={["F", "F"]} label="فرم درخواست ویزای جدید" />
          <ShortcutRow keys={["C", "C"]} label="مشتری جدید" />
          <ShortcutRow keys={["P", "P"]} label="ثبت پرداخت جدید" />
          <ShortcutRow keys={["S", "S"]} label="پریدن به جستجوی سراسری" />
          <ShortcutRow keys={["R", "R"]} label="گزارش‌ها" />
          <ShortcutRow keys={["D", "D"]} label="داشبورد" />
          <p className="mt-1 text-[11px] leading-5 text-ink-400">
            میان‌برهای دوبل بر اساس جای فیزیکی کلیدها کار می‌کنند؛ یعنی حتی وقتی کیبورد فارسی
            است، همان کلیدِ F (که حرف «ب» می‌نویسد) را دو بار بزنید و فرم درخواست باز می‌شود.
          </p>
        </div>
      </SectionCard>
    </>
  );
}

/* ---------------------------- Custom fields ----------------------------- */

interface FieldFormState {
  label: string;
  key: string;
  type: FieldType;
  entity: FieldEntity;
  required: boolean;
  searchable: boolean;
  showInForm: boolean;
  showInDetails: boolean;
  includeInExport: boolean;
  disabled: boolean;
  optionsText: string;
}

function CustomFieldsSection() {
  const fields = useCustomFields();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [entityFilter, setEntityFilter] = useState<FieldEntity>("customer");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [form, setForm] = useState<FieldFormState | null>(null);
  const [error, setError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setError("");
    setForm({
      label: "",
      key: "",
      type: "text",
      entity: entityFilter,
      required: false,
      searchable: true,
      showInForm: true,
      showInDetails: true,
      includeInExport: true,
      disabled: false,
      optionsText: "",
    });
    setEditOpen(true);
  };

  const openEdit = (field: CustomFieldDef) => {
    setEditing(field);
    setError("");
    setForm({
      label: field.label,
      key: field.key,
      type: field.type,
      entity: field.entity,
      required: field.required,
      searchable: field.searchable,
      showInForm: field.showInForm,
      showInDetails: field.showInDetails,
      includeInExport: field.includeInExport,
      disabled: field.disabled,
      optionsText: (field.options ?? []).join("\n"),
    });
    setEditOpen(true);
  };

  const save = async () => {
    if (!form) return;
    if (!form.label.trim()) {
      setError("عنوان فیلد الزامی است");
      return;
    }
    if ((form.type === "select" || form.type === "multiselect") && !form.optionsText.trim()) {
      setError("برای فیلد انتخابی، حداقل یک گزینه وارد کنید");
      return;
    }
    const options = form.optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    const input = {
      key: form.key.trim() || undefined,
      label: form.label,
      type: form.type,
      entity: form.entity,
      required: form.required,
      searchable: form.searchable,
      showInForm: form.showInForm,
      showInDetails: form.showInDetails,
      includeInExport: form.includeInExport,
      disabled: form.disabled,
      options,
    };
    if (editing) {
      await updateCustomField(editing.id, input);
      toast.success("فیلد ویرایش شد");
    } else {
      await createCustomField(input);
      toast.success("فیلد جدید ساخته شد");
    }
    setEditOpen(false);
  };

  const list = useMemo(
    () =>
      (fields ?? [])
        .filter((f) => f.entity === entityFilter)
        .sort((a, b) => a.order - b.order),
    [fields, entityFilter],
  );

  return (
    <>
      <SectionCard
        title="فیلدهای سفارشی"
        icon={<Layers size={15} className="text-brand-500" />}
        action={
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> فیلد جدید
          </button>
        }
      >
        <div className="mb-3">
          <RadioSelect
            options={[
              { value: "customer", label: "فیلدهای مشتری" },
              { value: "request", label: "فیلدهای درخواست" },
            ]}
            value={entityFilter}
            onChange={(v) => setEntityFilter(v as FieldEntity)}
          />
        </div>
        {list.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="فیلدی تعریف نشده"
            compact
            description="بدون کدنویسی، فیلد جدید به فرم مشتری یا درخواست اضافه کنید — مثل «شماره پرونده» یا «آدرس»"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((field) => (
              <li key={field.id} className="glass-soft flex items-center gap-2 rounded-2xl p-3">
                <div className="flex flex-col gap-1">
                  <button
                    className="icon-btn !h-6 !w-6"
                    aria-label="انتقال به بالا"
                    disabled={field.order === 0}
                    onClick={() => void reorderCustomField(field.id, -1)}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    className="icon-btn !h-6 !w-6"
                    aria-label="انتقال به پایین"
                    onClick={() => void reorderCustomField(field.id, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">
                    {field.label}
                    {field.required && <span className="mr-1 text-[#ef4444]">*</span>}
                    {field.disabled && <span className="chip-soft mr-2 text-[10px]">غیرفعال</span>}
                  </p>
                  <p className="ltr text-[10.5px] text-ink-400">
                    {field.key} • {FIELD_TYPE_LABELS[field.type]}
                  </p>
                </div>
                <div className="hidden gap-1 text-[10px] text-ink-400 sm:flex">
                  {field.searchable && <span className="chip-soft rounded-full px-2 py-0.5">جستجو</span>}
                  {field.includeInExport && <span className="chip-soft rounded-full px-2 py-0.5">خروجی</span>}
                </div>
                <button className="icon-btn !h-8 !w-8" aria-label="ویرایش" onClick={() => openEdit(field)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                  aria-label="حذف"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `حذف فیلد «${field.label}»`,
                      message: "مقادیر ذخیره‌شده روی رکوردها حفظ می‌شوند اما دیگر نمایش داده نمی‌شوند.",
                      danger: true,
                    });
                    if (ok) {
                      await deleteCustomField(field.id);
                      toast.info("فیلد حذف شد");
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editing ? "ویرایش فیلد سفارشی" : "فیلد سفارشی جدید"}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              انصراف
            </button>
            <Button variant="primary" onClick={() => void save()}>
              ذخیره
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="عنوان فیلد" required error={error}>
                <Input
                  value={form.label}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      label: e.target.value,
                      key: editing ? form.key : slugify(e.target.value),
                    })
                  }
                  placeholder="مثلاً شماره پرونده"
                />
              </FormField>
              <FormField label="شناسه فیلد" hint="انگلیسی و بدون فاصله — بعداً تغییر نکند">
                <Input
                  dir="ltr"
                  className="text-left"
                  value={form.key}
                  disabled={Boolean(editing)}
                  onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^a-zA-Z0-9-]/g, "") })}
                />
              </FormField>
              <FormField label="نوع فیلد">
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as FieldType })}
                >
                  {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="مربوط به">
                <Select
                  value={form.entity}
                  disabled={Boolean(editing)}
                  onChange={(e) => setForm({ ...form, entity: e.target.value as FieldEntity })}
                >
                  <option value="customer">فرم مشتری</option>
                  <option value="request">فرم درخواست ویزا</option>
                </Select>
              </FormField>
            </div>
            {(form.type === "select" || form.type === "multiselect") && (
              <FormField label="گزینه‌ها" hint="هر خط، یک گزینه">
                <textarea
                  className="field min-h-[90px]"
                  value={form.optionsText}
                  onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
                  placeholder={"توریستی\nتحصیلی\nعمره"}
                />
              </FormField>
            )}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-ink-900/8 p-3.5 dark:border-white/10">
              <Checkbox
                label="الزامی"
                checked={form.required}
                onChange={(v) => setForm({ ...form, required: v })}
              />
              <Checkbox
                label="در جستجو"
                checked={form.searchable}
                onChange={(v) => setForm({ ...form, searchable: v })}
              />
              <Checkbox
                label="در فرم نمایش داده شود"
                checked={form.showInForm}
                onChange={(v) => setForm({ ...form, showInForm: v })}
              />
              <Checkbox
                label="در صفحه جزئیات"
                checked={form.showInDetails}
                onChange={(v) => setForm({ ...form, showInDetails: v })}
              />
              <Checkbox
                label="در خروجی‌ها"
                checked={form.includeInExport}
                onChange={(v) => setForm({ ...form, includeInExport: v })}
              />
              <Checkbox
                label="فعال"
                checked={!form.disabled}
                onChange={(v) => setForm({ ...form, disabled: !v })}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* --------------------------------- Tags --------------------------------- */

function TagsSection() {
  const tags = useTags();
  const allTags = useTags(false);
  const archived = (allTags ?? []).filter((t) => t.archivedAt);
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_PALETTE[0]);
  const [isUrgent, setIsUrgent] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(TAG_PALETTE[(allTags?.length ?? 0) % TAG_PALETTE.length]);
    setIsUrgent(false);
    setEditOpen(true);
  };

  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color);
    setIsUrgent(tag.isUrgent);
    setEditOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    if (editing) {
      await updateTag(editing.id, { name, color, isUrgent });
      toast.success("تگ ویرایش شد");
    } else {
      await createTag({ name, color, isUrgent });
      toast.success("تگ ساخته شد");
    }
    setEditOpen(false);
  };

  return (
    <>
      <SectionCard
        title="تگ‌ها"
        icon={<TagIcon size={15} className="text-brand-500" />}
        action={
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> تگ جدید
          </button>
        }
      >
        <p className="mb-3 text-[12px] leading-5 text-ink-500 dark:text-ink-400">
          تگ «فوری» در شمارنده‌های داشبورد و گزارش‌ها لحاظ می‌شود.
        </p>
        {(tags ?? []).length === 0 ? (
          <EmptyState icon={TagIcon} title="تگی تعریف نشده" compact description="تگ‌ها مثل «فوری»، «عادی» یا «مدارک ناقص»" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(tags ?? []).map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3"
                style={{ background: `${tag.color}1c` }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                <span className="text-[12px] font-bold" style={{ color: tag.color }}>
                  {tag.name}
                  {tag.isUrgent ? " (فوری)" : ""}
                </span>
                <button className="icon-btn !h-6 !w-6" aria-label="ویرایش تگ" onClick={() => openEdit(tag)}>
                  <Pencil size={11} />
                </button>
                <button
                  className="icon-btn !h-6 !w-6 hover:!text-[#ef4444]"
                  aria-label="بایگانی تگ"
                  onClick={async () => {
                    await archiveTag(tag.id, tag.name);
                    toast.info("تگ بایگانی شد");
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <div className="mt-4 border-t border-ink-900/5 pt-3 dark:border-white/5">
            <p className="mb-2 text-[11px] font-bold text-ink-400">بایگانی‌شده</p>
            <div className="flex flex-wrap gap-2">
              {archived.map((tag) => (
                <button
                  key={tag.id}
                  className="chip-soft inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]"
                  onClick={async () => {
                    await restoreTag(tag.id, tag.name);
                    toast.success("تگ بازگردانی شد");
                  }}
                >
                  <TagIcon size={11} />
                  {tag.name} — بازگردانی
                </button>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editing ? "ویرایش تگ" : "تگ جدید"}
        size="sm"
        footer={
          <div className="flex justify-between gap-2">
            {editing ? (
              <button
                className="btn btn-danger-soft"
                onClick={async () => {
                  await deleteTag(editing.id, editing.name);
                  toast.info("تگ حذف شد");
                  setEditOpen(false);
                }}
              >
                <Trash2 size={14} /> حذف
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>
                انصراف
              </button>
              <Button variant="primary" onClick={() => void save()}>
                ذخیره
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label="نام تگ" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً فوری" />
          </FormField>
          <FormField label="رنگ">
            <div className="flex flex-wrap gap-2">
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    color === c ? "scale-110 border-ink-900 dark:border-white" : "border-transparent"
                  }`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`رنگ ${c}`}
                />
              ))}
            </div>
          </FormField>
          <div className="flex items-center justify-between rounded-2xl bg-[#ef4444]/6 px-4 py-3">
            <div>
              <p className="text-[13px] font-bold">تگ فوری</p>
              <p className="text-[11px] text-ink-500 dark:text-ink-400">در شمارنده‌های داشبورد لحاظ شود</p>
            </div>
            <Toggle checked={isUrgent} onChange={setIsUrgent} />
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------ Visa types ------------------------------ */

function VisaTypesSection() {
  const visaTypes = useVisaTypes();
  const allTypes = useVisaTypes(false);
  const archived = (allTypes ?? []).filter((v) => v.archivedAt);
  const toast = useToast();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <SectionCard title="انواع ویزا" icon={<VisaIcon size={15} className="text-brand-500" />}>
      <div className="mb-3 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="مثلاً ویزای توریستی"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && name.trim()) {
              await createVisaType(name);
              setName("");
              toast.success("نوع ویزا اضافه شد");
            }
          }}
        />
        <Button
          variant="primary"
          icon={Plus}
          disabled={!name.trim()}
          onClick={async () => {
            if (!name.trim()) return;
            await createVisaType(name);
            setName("");
            toast.success("نوع ویزا اضافه شد");
          }}
        >
          افزودن
        </Button>
      </div>
      {(visaTypes ?? []).length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-400">
          هنوز نوعی ثبت نشده — هنگام ثبت درخواست هم می‌توانید نوع جدید بسازید
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(visaTypes ?? []).map((vt) => (
            <li key={vt.id} className="glass-soft flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
              {editingId === vt.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      if (editName.trim()) await renameVisaType(vt.id, editName);
                      setEditingId(null);
                    }}
                  >
                    ذخیره
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[13px] font-semibold">{vt.name}</span>
                  <button
                    className="icon-btn !h-8 !w-8"
                    aria-label="ویرایش"
                    onClick={() => {
                      setEditingId(vt.id);
                      setEditName(vt.name);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                    aria-label="بایگانی"
                    onClick={async () => {
                      await archiveVisaType(vt.id);
                      toast.info("بایگانی شد");
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-900/5 pt-3 dark:border-white/5">
          {archived.map((vt) => (
            <button
              key={vt.id}
              className="chip-soft inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px]"
              onClick={async () => {
                await restoreVisaType(vt.id);
                toast.success("بازگردانی شد");
              }}
            >
              {vt.name} — بازگردانی
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------------------- Document types ----------------------------- */

interface DocTypeFormState {
  label: string;
  hint: string;
}

function DocTypesSection() {
  const docTypes = useDocTypes();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DocTypeFormState | null>(null);
  const [error, setError] = useState("");

  const list = docTypes ?? [];

  const openCreate = () => {
    setEditingId(null);
    setError("");
    setForm({ label: "", hint: "" });
    setEditOpen(true);
  };

  const openEdit = (id: string) => {
    const dt = list.find((d) => d.id === id);
    if (!dt) return;
    setEditingId(id);
    setError("");
    setForm({ label: dt.label, hint: dt.hint ?? "" });
    setEditOpen(true);
  };

  const save = async () => {
    if (!form) return;
    if (!form.label.trim()) {
      setError("عنوان مدرک الزامی است");
      return;
    }
    if (editingId) {
      await updateDocType(editingId, form);
      toast.success("مدرک ویرایش شد");
    } else {
      await createDocType(form);
      toast.success("مدرک جدید اضافه شد");
    }
    setEditOpen(false);
  };

  return (
    <>
      <SectionCard
        title="مدارک و تصاویر"
        icon={<FileImage size={15} className="text-brand-500" />}
        action={
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> مدرک جدید
          </button>
        }
      >
        <p className="mb-3 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          نوع مدارک پرونده مشتری را مثل «عکس ویزه» یا «عکس سند» اضافه، ویرایش یا جابه‌جا کنید.
          این اسلات‌ها در صفحه هر مشتری، بخش «مدارک و تصاویر» نمایش داده می‌شوند.
        </p>
        {list.length === 0 ? (
          <EmptyState
            icon={FileImage}
            title="مدرکی تعریف نشده"
            compact
            description="مثل «عکس پاسپورت» — چند نمونه آماده هم به‌صورت خودکار موجود است"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((dt, i) => (
              <li key={dt.id} className="glass-soft flex items-center gap-2 rounded-2xl p-3">
                <div className="flex flex-col gap-1">
                  <button
                    className="icon-btn !h-6 !w-6"
                    aria-label="انتقال به بالا"
                    disabled={i === 0}
                    onClick={() => void reorderDocType(dt.id, -1)}
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    className="icon-btn !h-6 !w-6"
                    aria-label="انتقال به پایین"
                    disabled={i === list.length - 1}
                    onClick={() => void reorderDocType(dt.id, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{dt.label}</p>
                  <p className="truncate text-[10.5px] text-ink-400">
                    {dt.hint || "بدون توضیح"}
                  </p>
                </div>
                <button className="icon-btn !h-8 !w-8" aria-label="ویرایش" onClick={() => openEdit(dt.id)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                  aria-label="حذف"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `حذف «${dt.label}»`,
                      message:
                        "فایل‌های بارگذاری‌شدهٔ این بخش حذف نمی‌شوند؛ به «سایر مدارک» منتقل می‌شوند.",
                      danger: true,
                      confirmLabel: "حذف",
                    });
                    if (ok) {
                      await deleteDocType(dt.id, dt.label);
                      toast.info("مدرک حذف شد");
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editingId ? "ویرایش مدرک" : "مدرک جدید"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              انصراف
            </button>
            <Button variant="primary" onClick={() => void save()}>
              ذخیره
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            <FormField label="عنوان" required error={error}>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="مثلاً عکس ویزه"
                autoFocus
              />
            </FormField>
            <FormField label="توضیح کوتاه" hint="اختیاری — زیر عنوان نمایش داده می‌شود">
              <Input
                value={form.hint}
                onChange={(e) => setForm({ ...form, hint: e.target.value })}
                placeholder="مثلاً صفحه ویزه پاسپورت"
              />
            </FormField>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ------------------------- Currency and defaults ------------------------- */

function CurrencySection() {
  const prefs = usePrefs();
  return (
    <SectionCard title="واحد پول پیش‌فرض" icon={<Coins size={15} className="text-brand-500" />}>
      <p className="mb-3 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
        هنگام ثبت درخواست یا پرداخت جدید، این واحد به‌صورت پیش‌فرض انتخاب می‌شود. مبالغ
        دلار و تومان همیشه جداگانه جمع و نمایش داده می‌شوند و هرگز با هم ترکیب نمی‌شوند.
      </p>
      <RadioSelect
        options={[
          { value: "IRT", label: "تومان" },
          { value: "USD", label: "دلار" },
        ]}
        value={prefs.defaultCurrency}
        onChange={(v) => void updatePrefs({ defaultCurrency: v as "IRT" | "USD" })}
      />
    </SectionCard>
  );
}

function DefaultsSection() {
  const prefs = usePrefs();
  const visaTypes = useVisaTypes();
  return (
    <SectionCard title="پیش‌فرض‌های فرم" icon={<Wand2 size={15} className="text-brand-500" />}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-2xl bg-brand-500/6 px-4 py-3">
          <div>
            <p className="text-[13px] font-bold">یادآوری آخرین انتخاب‌ها</p>
            <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
              آخرین نماینده و لیستی که انتخاب کردید، در فرم درخواست و فرم مشتری بعدی خودکار انتخاب می‌شود
            </p>
          </div>
          <Toggle
            checked={prefs.rememberLastSelections}
            onChange={(v) => void updatePrefs({ rememberLastSelections: v })}
          />
        </div>
        <FormField label="نوع ویزای پیش‌فرض">
          <Select
            value={prefs.defaultVisaType ?? ""}
            onChange={(e) => void updatePrefs({ defaultVisaType: e.target.value || undefined })}
          >
            <option value="">بدون پیش‌فرض</option>
            {(visaTypes ?? []).map((vt) => (
              <option key={vt.id} value={vt.name}>
                {vt.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="border-t border-ink-900/5 pt-4 dark:border-white/5">
          <FormField
            label="تقویم تاریخ تولد و پاسپورت"
            hint="تاریخ تولد، تاریخ صدور و انقضای پاسپورت با این تقویم وارد و نمایش داده می‌شود"
          >
            <RadioSelect
              options={[
                { value: "gregorian", label: "میلادی (2024/05/13)" },
                { value: "jalali", label: "شمسی (۱۴۰۳/۰۲/۲۴)" },
              ]}
              value={prefs.passportDateCalendar ?? "gregorian"}
              onChange={(v) =>
                void updatePrefs({ passportDateCalendar: v as "gregorian" | "jalali" })
              }
            />
          </FormField>
        </div>
        <p className="text-[11px] leading-5 text-ink-400">
          تاریخ ثبت مشتری و درخواست، همیشه امروزِ شمسی است و همان موقع قابل تغییر.
        </p>
      </div>
    </SectionCard>
  );
}

function BackupSection() {
  return (
    <SectionCard title="پشتیبان‌گیری و بازیابی" icon={<DatabaseBackup size={15} className="text-brand-500" />}>
      <p className="mb-3 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
        خروجی JSON کامل (بدون تصاویر)، بایگانی ZIP تصاویر، بازیابی با پیش‌نمایش و پشتیبان
        رمزنگاری‌شده — همه در صفحه پشتیبان‌گیری.
      </p>
      <Link to="/backup" className="btn btn-primary btn-sm w-fit">
        <DatabaseBackup size={14} /> رفتن به صفحه پشتیبان‌گیری
      </Link>
    </SectionCard>
  );
}

/* ------------------------------ Data / demo ------------------------------ */

function DataSection() {
  const customers = useCustomers();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [seeding, setSeeding] = useState(false);

  return (
    <SectionCard title="مدیریت داده" icon={<Settings2 size={15} className="text-brand-500" />}>
      <div className="flex flex-col gap-4">
        <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          داده نمونه فقط برای آشنایی با امکانات برنامه است و با داده واقعی قاطی نمی‌شود؛
          فقط وقتی می‌توانید بارگذاری‌اش کنید که هیچ رکوردی نداشته باشید.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="glass"
            icon={Wand2}
            loading={seeding}
            disabled={(customers?.length ?? 0) > 0}
            onClick={async () => {
              const ok = await confirm({
                title: "بارگذاری داده نمونه؟",
                message: "چند مشتری، نماینده، لیست، تگ، درخواست و پرداخت نمونه ساخته می‌شود.",
              });
              if (!ok) return;
              setSeeding(true);
              try {
                await seedDemoData();
                toast.success("داده نمونه بارگذاری شد");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "خطا در بارگذاری");
              } finally {
                setSeeding(false);
              }
            }}
          >
            بارگذاری داده نمونه
          </Button>
          <Link to="/backup" className="btn btn-danger-soft btn-sm">
            پاک کردن داده‌ها (از صفحه پشتیبان)
          </Link>
        </div>
        <p className="text-[11px] text-ink-400">
          تعداد مشتریان فعلی: {toPersianDigits(customers?.length ?? 0)}
        </p>
      </div>
    </SectionCard>
  );
}

/* ---------------------------------- PWA ---------------------------------- */

function PwaSection() {
  const [installable, setInstallable] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [storage, setStorage] = useState<string>("");

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __installPrompt?: Event }).__installPrompt = e;
      setInstallable(true);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void navigator.storage?.estimate?.().then((est) => {
      if (est.usage != null && est.quota != null) {
        setStorage(`${(est.usage / 1024 / 1024).toFixed(1)} از ${(est.quota / 1024 / 1024 / 1024).toFixed(1)} گیگابایت`);
      }
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  return (
    <SectionCard title="نصب و حالت آفلاین (PWA)" icon={<Smartphone size={15} className="text-brand-500" />}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-2xl bg-brand-500/6 px-4 py-3 text-[12px]">
          <span>وضعیت اتصال</span>
          <b className={online ? "text-[#0b9e6e]" : "text-[#dc3535]"}>
            {online ? "آنلاین" : "آفلاین"}
          </b>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-brand-500/6 px-4 py-3 text-[12px]">
          <span>حالت نصب‌شده</span>
          <b>{standalone ? "نصب شده به‌عنوان برنامه" : "در حال اجرا در مرورگر"}</b>
        </div>
        {storage && (
          <div className="flex items-center justify-between rounded-2xl bg-brand-500/6 px-4 py-3 text-[12px]">
            <span>فضای ذخیره‌سازی مرورگر</span>
            <b className="num">{storage}</b>
          </div>
        )}
        {installable && !standalone && (
          <button
            className="btn btn-primary btn-sm w-fit"
            onClick={async () => {
              const evt = (window as unknown as { __installPrompt?: { prompt: () => Promise<void> } }).__installPrompt;
              await evt?.prompt();
              setInstallable(false);
            }}
          >
            <Smartphone size={14} /> نصب برنامه
          </button>
        )}
        <div className="flex flex-col gap-2 rounded-2xl border border-ink-900/8 p-4 dark:border-white/10">
          <p className="text-[12px] font-bold">این برنامه را روی گوشی یا کامپیوتر نصب کنید</p>
          <p className="text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
            <b>کروم / اج دسکتاپ:</b> روی آیکون نصب (نماد صفحه‌نمایش با علامت +) در انتهای نوار
            آدرس کلیک کنید، یا از منوی سه‌نقطه گزینه «Install / نصب» را بزنید.
          </p>
          <p className="text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
            <b>اندروید (کروم):</b> منوی سه‌نقطه ⋮ ← «Add to Home screen / افزودن به صفحه اصلی»
            یا «نصب برنامه». آیکون برنامه مثل بقیه اپ‌ها روی صفحه اصلی گوشی می‌نشیند.
          </p>
          <p className="text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
            <b>آیفون / آیپد (سافاری):</b> دکمه اشتراک‌گذاری (Share) ← «Add to Home Screen /
            افزودن به صفحه اصلی». در iOS نصب فقط از طریق سافاری انجام می‌شود.
          </p>
          <p className="text-[11px] leading-5 text-ink-400">
            نصب فقط روی آدرس امن HTTPS امکان‌پذیر است — آدرس GitHub Pages برنامه همین حالا
            HTTPS است، پس آیکون نصب بعد از اولین بازدید ظاهر می‌شود.
          </p>
        </div>
        <p className="text-[11px] leading-5 text-ink-400">
          بعد از اولین بازدید، فایل‌های برنامه کش می‌شوند و برنامه بدون اینترنت باز می‌شود.
          داده‌ها فقط روی همین دستگاه و همین مرورگر هستند و بین دستگاه‌ها هم‌گام‌سازی
          نمی‌شوند — برای انتقال، از پشتیبان JSON استفاده کنید.
        </p>
      </div>
    </SectionCard>
  );
}
