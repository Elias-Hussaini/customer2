import type { CustomFieldDef } from "../../types";
import { FormField, Input, Textarea, Checkbox } from "./fields";
import { JalaliDatePicker } from "./JalaliDatePicker";
import { toLatinDigits } from "../../utils/jalali";

/** Renders the matching input control for one custom-field definition. */
export function CustomFieldControl({
  field,
  value,
  onChange,
  invalid,
}: {
  field: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid?: boolean;
}) {
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          value={String(value ?? "")}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          dir="ltr"
          className="num text-right"
          inputMode="decimal"
          value={value == null ? "" : String(value)}
          invalid={invalid}
          onChange={(e) => {
            const t = toLatinDigits(e.target.value).replace(/[^0-9.\-]/g, "");
            onChange(t === "" ? null : Number(t));
          }}
        />
      );
    case "date":
      return (
        <JalaliDatePicker
          value={typeof value === "string" ? value : null}
          onChange={(iso) => onChange(iso)}
        />
      );
    case "select":
      return (
        <select
          className={`field ${invalid ? "field-error" : ""}`}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— انتخاب کنید —</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2 rounded-[0.85rem] border border-ink-900/10 bg-white/50 p-2.5 dark:border-white/10 dark:bg-white/5">
          {(field.options ?? []).map((opt) => {
            const checked = arr.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  checked
                    ? "bg-brand-500 text-white"
                    : "bg-ink-500/10 text-ink-600 hover:bg-ink-500/15 dark:text-ink-300"
                }`}
                onClick={() =>
                  onChange(checked ? arr.filter((v) => v !== opt) : [...arr, opt])
                }
              >
                {opt}
              </button>
            );
          })}
          {(field.options ?? []).length === 0 && (
            <span className="text-xs text-ink-400">گزینه‌ای تعریف نشده — از تنظیمات اضافه کنید</span>
          )}
        </div>
      );
    }
    case "checkbox":
      return (
        <Checkbox
          checked={value === true}
          onChange={(checked) => onChange(checked)}
          label={value === true ? "بله" : "فعال نیست"}
        />
      );
    case "url":
      return (
        <Input
          dir="ltr"
          className="text-left"
          placeholder="https://…"
          value={String(value ?? "")}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          value={String(value ?? "")}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Renders a group of custom fields inside a form, from local configuration. */
export function CustomFieldsGroup({
  fields,
  values,
  onChange,
  errors,
}: {
  fields: CustomFieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <FormField
          key={field.key}
          label={field.label}
          required={field.required}
          error={errors?.[field.key]}
          className={field.type === "textarea" ? "sm:col-span-2" : ""}
        >
          <CustomFieldControl
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            invalid={Boolean(errors?.[field.key])}
          />
        </FormField>
      ))}
    </div>
  );
}

/** Read-only value display for details pages. */
export function CustomFieldValue({ field, value }: { field: CustomFieldDef; value: unknown }) {
  if (value == null || value === "" || value === false) {
    return <span className="text-ink-400">—</span>;
  }
  if (field.type === "date") {
    return <span className="num">{value as string}</span>;
  }
  if (field.type === "checkbox") {
    return <span>{value === true ? "بله" : "—"}</span>;
  }
  if (Array.isArray(value)) {
    return <span>{value.join("، ")}</span>;
  }
  if (field.type === "url") {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        className="ltr text-brand-600 hover:underline dark:text-brand-300"
      >
        {String(value)}
      </a>
    );
  }
  return <span>{String(value)}</span>;
}
