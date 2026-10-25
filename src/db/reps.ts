import { db } from "./schema";
import { logActivity } from "./activities";
import type { Representative } from "../types";
import { uid } from "../utils/id";

export interface RepresentativeInput {
  name: string;
  phone?: string;
  contactInfo?: string;
  notes?: string;
}

export async function createRepresentative(input: RepresentativeInput): Promise<Representative> {
  const now = Date.now();
  const rep: Representative = {
    id: uid(),
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    contactInfo: input.contactInfo?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.representatives.add(rep);
  await logActivity({
    type: "create",
    entity: "representative",
    entityId: rep.id,
    title: `نماینده «${rep.name}» ثبت شد`,
  });
  return rep;
}

export async function updateRepresentative(id: string, input: RepresentativeInput): Promise<void> {
  await db.representatives.update(id, {
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    contactInfo: input.contactInfo?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "representative",
    entityId: id,
    title: `نماینده «${input.name.trim()}» ویرایش شد`,
  });
}

export async function archiveRepresentative(id: string, name: string): Promise<void> {
  await db.representatives.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({
    type: "archive",
    entity: "representative",
    entityId: id,
    title: `نماینده «${name}» بایگانی شد`,
  });
}

export async function restoreRepresentative(id: string, name: string): Promise<void> {
  await db.representatives.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({
    type: "restore",
    entity: "representative",
    entityId: id,
    title: `نماینده «${name}» از آرشیو بازگردانده شد`,
  });
}

/**
 * Permanently delete a representative. Blocked while payments exist —
 * financial history must not be destroyed silently. Requests are detached
 * (kept without a representative).
 */
export async function deleteRepresentative(id: string, name: string): Promise<{ ok: boolean; reason?: string }> {
  const paymentCount = await db.payments.where("representativeId").equals(id).count();
  if (paymentCount > 0) {
    return {
      ok: false,
      reason: `این نماینده ${paymentCount} پرداخت ثبت‌شده دارد. ابتدا پرداخت‌ها را حذف کنید یا نماینده را بایگانی کنید.`,
    };
  }
  await db.transaction("rw", db.representatives, db.requests, async () => {
    await db.representatives.delete(id);
    const linked = await db.requests.where("representativeId").equals(id).toArray();
    await Promise.all(
      linked.map((r) =>
        db.requests.update(r.id, { representativeId: null, updatedAt: Date.now() }),
      ),
    );
  });
  await logActivity({
    type: "delete",
    entity: "representative",
    entityId: id,
    title: `نماینده «${name}» حذف شد`,
    detail: "درخواست‌های مرتبط حفظ شدند و بدون نماینده باقی ماندند.",
  });
  return { ok: true };
}
