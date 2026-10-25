import { db } from "./schema";
import { logActivity } from "./activities";
import type { CustomFieldDef, Tag, VisaType, FieldEntity, FieldType } from "../types";
import { uid } from "../utils/id";
import { slugify } from "../utils/normalize";

/* ------------------------------- Tags ---------------------------------- */

export const TAG_PALETTE = [
  "#635bff",
  "#8b5cf6",
  "#3b82f6",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
  "#a855f7",
];

export interface TagInput {
  name: string;
  color: string;
  isUrgent: boolean;
}

export async function createTag(input: TagInput): Promise<Tag> {
  const now = Date.now();
  const tag: Tag = {
    id: uid(),
    name: input.name.trim(),
    color: input.color,
    isUrgent: input.isUrgent,
    createdAt: now,
    updatedAt: now,
  };
  await db.tags.add(tag);
  await logActivity({ type: "create", entity: "tag", entityId: tag.id, title: `تگ «${tag.name}» ساخته شد` });
  return tag;
}

export async function updateTag(id: string, input: TagInput): Promise<void> {
  await db.tags.update(id, {
    name: input.name.trim(),
    color: input.color,
    isUrgent: input.isUrgent,
    updatedAt: Date.now(),
  });
  await logActivity({ type: "update", entity: "tag", entityId: id, title: `تگ «${input.name.trim()}» ویرایش شد` });
}

export async function archiveTag(id: string, name: string): Promise<void> {
  await db.tags.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({ type: "archive", entity: "tag", entityId: id, title: `تگ «${name}» بایگانی شد` });
}

export async function restoreTag(id: string, name: string): Promise<void> {
  await db.tags.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({ type: "restore", entity: "tag", entityId: id, title: `تگ «${name}» بازگردانده شد` });
}

/** Delete a tag and strip it from every request that carries it. */
export async function deleteTag(id: string, name: string): Promise<void> {
  await db.transaction("rw", db.tags, db.requests, async () => {
    const all = await db.requests.toArray();
    await Promise.all(
      all
        .filter((r) => r.tags.includes(id))
        .map((r) => db.requests.update(r.id, { tags: r.tags.filter((t) => t !== id) })),
    );
    await db.tags.delete(id);
  });
  await logActivity({ type: "delete", entity: "tag", entityId: id, title: `تگ «${name}» حذف شد` });
}

/* ----------------------------- Visa types ------------------------------- */

export async function createVisaType(name: string): Promise<VisaType> {
  const now = Date.now();
  const vt: VisaType = { id: uid(), name: name.trim(), createdAt: now, updatedAt: now };
  await db.visaTypes.add(vt);
  return vt;
}

export async function renameVisaType(id: string, name: string): Promise<void> {
  await db.visaTypes.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function archiveVisaType(id: string): Promise<void> {
  await db.visaTypes.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
}

export async function restoreVisaType(id: string): Promise<void> {
  await db.visaTypes.update(id, { archivedAt: null, updatedAt: Date.now() });
}

export async function deleteVisaType(id: string): Promise<void> {
  await db.visaTypes.delete(id);
}

/* ---------------------------- Custom fields ----------------------------- */

export interface CustomFieldInput {
  key?: string;
  label: string;
  type: FieldType;
  entity: FieldEntity;
  required: boolean;
  defaultValue?: CustomFieldDef["defaultValue"];
  options?: string[];
  searchable: boolean;
  showInForm: boolean;
  showInDetails: boolean;
  includeInExport: boolean;
  order?: number;
  disabled: boolean;
}

async function ensureUniqueKey(key: string, excludeId?: string): Promise<string> {
  const existing = await db.customFields.toArray();
  const taken = new Set(existing.filter((f) => f.id !== excludeId).map((f) => f.key));
  if (!taken.has(key)) return key;
  let i = 2;
  while (taken.has(`${key}-${i}`)) i++;
  return `${key}-${i}`;
}

export async function createCustomField(input: CustomFieldInput): Promise<CustomFieldDef> {
  const now = Date.now();
  const key = await ensureUniqueKey(input.key?.trim() || slugify(input.label));
  const count = await db.customFields.where("entity").equals(input.entity).count();
  const field: CustomFieldDef = {
    id: uid(),
    key,
    label: input.label.trim(),
    type: input.type,
    entity: input.entity,
    required: input.required,
    defaultValue: input.defaultValue ?? null,
    options:
      input.type === "select" || input.type === "multiselect"
        ? (input.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined,
    searchable: input.searchable,
    showInForm: input.showInForm,
    showInDetails: input.showInDetails,
    includeInExport: input.includeInExport,
    order: input.order ?? count,
    disabled: input.disabled,
    createdAt: now,
    updatedAt: now,
  };
  await db.customFields.add(field);
  await logActivity({
    type: "settings",
    entity: "settings",
    title: `فیلد سفارشی «${field.label}» ایجاد شد`,
  });
  return field;
}

export async function updateCustomField(id: string, input: CustomFieldInput): Promise<void> {
  const existing = await db.customFields.get(id);
  if (!existing) return;
  // key stays stable once created — stored values keep matching.
  await db.customFields.update(id, {
    label: input.label.trim(),
    type: input.type,
    entity: input.entity,
    required: input.required,
    defaultValue: input.defaultValue ?? null,
    options:
      input.type === "select" || input.type === "multiselect"
        ? (input.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined,
    searchable: input.searchable,
    showInForm: input.showInForm,
    showInDetails: input.showInDetails,
    includeInExport: input.includeInExport,
    order: input.order ?? existing.order,
    disabled: input.disabled,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "settings",
    entity: "settings",
    title: `فیلد سفارشی «${input.label.trim()}» ویرایش شد`,
  });
}

export async function reorderCustomField(id: string, direction: -1 | 1): Promise<void> {
  const field = await db.customFields.get(id);
  if (!field) return;
  const siblings = (await db.customFields.where("entity").equals(field.entity).toArray()).sort(
    (a, b) => a.order - b.order,
  );
  const idx = siblings.findIndex((f) => f.id === id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  const now = Date.now();
  await db.customFields.update(id, { order: other.order, updatedAt: now });
  await db.customFields.update(other.id, { order: field.order, updatedAt: now });
}

/**
 * Deleting a definition keeps stored values on records (they are simply no
 * longer rendered). We warn about this in the UI before calling.
 */
export async function deleteCustomField(id: string): Promise<void> {
  const field = await db.customFields.get(id);
  await db.customFields.delete(id);
  if (field) {
    await logActivity({
      type: "settings",
      entity: "settings",
      title: `فیلد سفارشی «${field.label}» حذف شد`,
      detail: "مقادیر ذخیره‌شده روی رکوردها حفظ شدند.",
    });
  }
}
