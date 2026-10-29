import { db } from "./schema";
import { logActivity } from "./activities";
import type { Employer } from "../types";
import { uid } from "../utils/id";

/**
 * کارفرما (employers) — an OPTIONAL entity attached to customers.
 * Managed from Settings → کارفرماها; each customer may carry one or none
 * («بدون کارفرما»). Deleting an employer detaches its customers but never
 * touches them otherwise.
 */

export interface EmployerInput {
  name: string;
  phone?: string;
  notes?: string;
}

export async function createEmployer(input: EmployerInput): Promise<Employer> {
  const now = Date.now();
  const employer: Employer = {
    id: uid(),
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await db.employers.add(employer);
  await logActivity({
    type: "create",
    entity: "employer",
    entityId: employer.id,
    title: `کارفرما «${employer.name}» ثبت شد`,
  });
  return employer;
}

export async function updateEmployer(id: string, input: EmployerInput): Promise<void> {
  await db.employers.update(id, {
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "employer",
    entityId: id,
    title: `کارفرما «${input.name.trim()}» ویرایش شد`,
  });
}

export async function archiveEmployer(id: string, name: string): Promise<void> {
  await db.employers.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({
    type: "archive",
    entity: "employer",
    entityId: id,
    title: `کارفرما «${name}» بایگانی شد`,
  });
}

export async function restoreEmployer(id: string, name: string): Promise<void> {
  await db.employers.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({
    type: "restore",
    entity: "employer",
    entityId: id,
    title: `کارفرما «${name}» از آرشیو بازگردانده شد`,
  });
}

/**
 * Permanently delete an employer. Customers keep everything — they just
 * become «بدون کارفرما» again. The employer feature is optional by design,
 * so nothing financial or historical may ever depend on this row.
 */
export async function deleteEmployer(id: string, name: string): Promise<void> {
  await db.transaction("rw", db.employers, db.customers, async () => {
    await db.employers.delete(id);
    const linked = await db.customers.where("employerId").equals(id).toArray();
    await Promise.all(
      linked.map((c) => db.customers.update(c.id, { employerId: null, updatedAt: Date.now() })),
    );
  });
  await logActivity({
    type: "delete",
    entity: "employer",
    entityId: id,
    title: `کارفرما «${name}» حذف شد`,
    detail: "مشتری‌های مرتبط حفظ شدند و بدون کارفرما باقی ماندند.",
  });
}
