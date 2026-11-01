import { db } from "./schema";
import { logActivity } from "./activities";
import type { Employer } from "../types";
import { uid } from "../utils/id";

/**
 * کارفرما (employers) — a FULL entity like customers & representatives:
 * its own section, rich profile (contact, ID, credentials, address, photo,
 * custom fields) and its own document archive.
 *
 * Customers may still carry one or none («بدون کارفرما»). Deleting an
 * employer detaches its customers (they keep everything) and removes the
 * employer's OWN documents.
 */

export interface EmployerInput {
  name: string;
  phone?: string;
  email?: string;
  nationalId?: string;
  username?: string;
  password?: string;
  address?: string;
  postalCode?: string;
  notes?: string;
  customValues?: Record<string, unknown>;
}

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function toRecord(input: EmployerInput) {
  return {
    name: input.name.trim(),
    phone: clean(input.phone),
    email: clean(input.email),
    nationalId: clean(input.nationalId),
    username: clean(input.username),
    password: clean(input.password),
    address: clean(input.address),
    postalCode: clean(input.postalCode),
    notes: clean(input.notes),
    customValues: input.customValues ?? {},
  };
}

export async function createEmployer(input: EmployerInput): Promise<Employer> {
  if (!input.name.trim()) throw new Error("نام کارفرما الزامی است.");
  const now = Date.now();
  const employer: Employer = {
    id: uid(),
    ...toRecord(input),
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
  if (!input.name.trim()) throw new Error("نام کارفرما الزامی است.");
  await db.employers.update(id, { ...toRecord(input), updatedAt: Date.now() });
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
 * become «بدون کارفرما» again. The employer's OWN documents are removed
 * together with the record.
 */
export async function deleteEmployer(id: string, name: string): Promise<void> {
  await db.transaction("rw", db.employers, db.customers, db.attachments, async () => {
    await db.employers.delete(id);
    const linked = await db.customers.where("employerId").equals(id).toArray();
    await Promise.all(
      linked.map((c) => db.customers.update(c.id, { employerId: null, updatedAt: Date.now() })),
    );
    const ownDocs = await db.attachments.where("employerId").equals(id).toArray();
    if (ownDocs.length > 0) {
      await db.attachments.bulkDelete(ownDocs.map((a) => a.id));
    }
  });
  await logActivity({
    type: "delete",
    entity: "employer",
    entityId: id,
    title: `کارفرما «${name}» حذف شد`,
    detail: "مشتری‌های مرتبط حفظ شدند و بدون کارفرما باقی ماندند.",
  });
}

/** Duplicate warning (non-blocking): same name, or same nationalId among actives. */
export async function findEmployerDuplicates(input: EmployerInput, ignoreId?: string): Promise<string[]> {
  const all = await db.employers.toArray();
  const warnings: string[] = [];
  const name = input.name.trim();
  if (name) {
    const sameName = all.find((e) => e.id !== ignoreId && e.name.trim() === name);
    if (sameName) warnings.push(`کارفرمایی با نام «${name}» از قبل وجود دارد.`);
  }
  if (input.nationalId?.trim()) {
    const nid = input.nationalId.trim();
    const sameNid = all.find((e) => e.id !== ignoreId && e.nationalId?.trim() === nid);
    if (sameNid) warnings.push(`کد ملی قبلاً برای «${sameNid.name}» ثبت شده است.`);
  }
  return warnings;
}
