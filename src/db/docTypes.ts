import { db } from "./schema";
import { logActivity } from "./activities";
import { DEFAULT_PREFS } from "./prefs";
import type { DocType } from "../types";
import { uid } from "../utils/id";

/**
 * User-definable document slots (Settings → مدارک و تصاویر).
 *
 * The three built-in slots keep the historical ids ("passport", "nidFront",
 * "nidBack") so attachments written by earlier app versions keep matching
 * without any data migration.
 */

export interface DocTypeInput {
  label: string;
}

export async function createDocType(input: DocTypeInput): Promise<DocType> {
  const now = Date.now();
  const count = await db.docTypes.count();
  const dt: DocType = {
    id: uid(),
    label: input.label.trim(),
    order: count,
    createdAt: now,
    updatedAt: now,
  };
  await db.docTypes.add(dt);
  await logActivity({
    type: "settings",
    entity: "settings",
    title: `مدرک «${dt.label}» به بخش مدارک اضافه شد`,
  });
  return dt;
}

export async function updateDocType(id: string, input: DocTypeInput): Promise<void> {
  await db.docTypes.update(id, {
    label: input.label.trim(),
    hint: undefined,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "settings",
    entity: "settings",
    title: `مدرک «${input.label.trim()}» ویرایش شد`,
  });
}

const BUILT_IN: { id: string; label: string; order: number }[] = [
  { id: "passport", label: "عکس پاسپورت", order: 0 },
  { id: "nidFront", label: "عکس روی تذکره", order: 1 },
  { id: "nidBack", label: "عکس پشت تذکره", order: 2 },
];

/**
 * Seed the built-in slots exactly once (guarded by a preferences flag so
 * user-deleted types are never resurrected on the next launch).
 */
export async function ensureDefaultDocTypes(): Promise<void> {
  const prefs = await db.preferences.get("app");
  if (prefs?.docTypesSeeded) return;
  const now = Date.now();
  const rows: DocType[] = BUILT_IN.map((b) => ({
    id: b.id,
    label: b.label,
    order: b.order,
    createdAt: now,
    updatedAt: now,
  }));
  // bulkPut is idempotent for the fixed ids (safe under StrictMode double-run).
  await db.docTypes.bulkPut(rows);
  const current = prefs ?? { ...DEFAULT_PREFS };
  await db.preferences.put({ ...current, id: "app", docTypesSeeded: true, updatedAt: now });
}

/**
 * One-time cleanup: the short-description (hint) field is retired — strip it
 * from existing rows so no stale text ever comes back.
 */
export async function stripLegacyDocHints(): Promise<void> {
  const prefs = await db.preferences.get("app");
  if (prefs?.docHintsStripped) return;
  const all = await db.docTypes.toArray();
  const withHints = all.filter((d) => d.hint != null);
  if (withHints.length > 0) {
    await Promise.all(withHints.map((d) => db.docTypes.update(d.id, { hint: undefined })));
  }
  await db.preferences.put({
    ...(prefs ?? DEFAULT_PREFS),
    id: "app",
    docHintsStripped: true,
    updatedAt: Date.now(),
  });
}

/**
 * One-time cleanup: the AI once created a bogus «کد ملی» document slot by
 * mis-reading the back of a تذکره (the app has no such field). Any slot
 * whose label mentions کد ملی is removed; its files move to «پشت تذکره»
 * (where those images came from) or, failing that, to «سایر مدارک».
 */
export async function purgeNationalIdDocTypes(): Promise<void> {
  const prefs = await db.preferences.get("app");
  if (prefs?.nidJunkPurged) return;
  const norm = (s: string) => s.replace(/[\s\u200c]+/g, "");
  const junk = (await db.docTypes.toArray()).filter(
    (d) => d.id !== "nidBack" && norm(d.label).includes("کدملی"),
  );
  if (junk.length > 0) {
    const backExists = (await db.docTypes.get("nidBack")) != null;
    const fallbackKind = backExists ? "nidBack" : "other";
    await db.transaction("rw", db.docTypes, db.attachments, async () => {
      for (const dt of junk) {
        const files = await db.attachments.where("kind").equals(dt.id).toArray();
        await Promise.all(files.map((f) => db.attachments.update(f.id, { kind: fallbackKind })));
        await db.docTypes.delete(dt.id);
      }
    });
    await logActivity({
      type: "settings",
      entity: "settings",
      title: `بخش «${junk.map((d) => d.label).join("، ")}» حذف شد`,
      detail: backExists
        ? "فایل‌های آن به «پشت تذکره» منتقل شد."
        : "فایل‌های آن به «سایر مدارک» منتقل شد.",
    });
  }
  await db.preferences.put({
    ...(prefs ?? DEFAULT_PREFS),
    id: "app",
    nidJunkPurged: true,
    updatedAt: Date.now(),
  });
}

export async function reorderDocType(id: string, direction: -1 | 1): Promise<void> {
  const all = (await db.docTypes.toArray()).sort((a, b) => a.order - b.order);
  const idx = all.findIndex((d) => d.id === id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= all.length) return;
  const other = all[swapIdx];
  const now = Date.now();
  await db.docTypes.update(id, { order: other.order, updatedAt: now });
  await db.docTypes.update(other.id, { order: all[idx].order, updatedAt: now });
}

/**
 * Delete a document slot. Its uploaded files are moved to «سایر مدارک»
 * (kind "other") so nothing is ever lost — attachments only change bucket.
 */
export async function deleteDocType(id: string, label: string): Promise<void> {
  await db.transaction("rw", db.docTypes, db.attachments, async () => {
    const files = await db.attachments.where("kind").equals(id).toArray();
    await Promise.all(files.map((f) => db.attachments.update(f.id, { kind: "other", paymentId: null })));
    await db.docTypes.delete(id);
  });
  await logActivity({
    type: "settings",
    entity: "settings",
    title: `مدرک «${label}» حذف شد`,
    detail: "فایل‌های این بخش به «سایر مدارک» منتقل شدند.",
  });
}
