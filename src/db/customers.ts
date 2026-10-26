import { db } from "./schema";
import { logActivity } from "./activities";
import type { Customer } from "../types";
import { uid } from "../utils/id";
import { todayIso } from "../utils/jalali";
import { normalizePassport } from "../utils/normalize";

export interface CustomerInput {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  passportNo?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  referrer?: string;
  notes?: string;
  /** Required in forms: every customer sits inside a list, under a representative. */
  representativeId?: string | null;
  listId?: string | null;
  registrationDate: string;
  customValues?: Record<string, unknown>;
}

export function customerFullName(c: Customer | Pick<Customer, "firstName" | "lastName">): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "بدون نام";
}

/** Find another customer with the same (normalized) passport number. */
export async function findDuplicatePassport(
  passportNo: string,
  excludeId?: string,
): Promise<Customer | null> {
  const norm = normalizePassport(passportNo);
  if (!norm) return null;
  const all = await db.customers.toArray();
  return (
    all.find(
      (c) => c.id !== excludeId && c.passportNo && normalizePassport(c.passportNo) === norm,
    ) ?? null
  );
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const now = Date.now();
  const customer: Customer = {
    id: uid(),
    firstName: input.firstName?.trim() || undefined,
    lastName: input.lastName?.trim() || undefined,
    birthDate: input.birthDate || undefined,
    passportNo: input.passportNo?.trim().toUpperCase() || undefined,
    passportIssueDate: input.passportIssueDate || undefined,
    passportExpiryDate: input.passportExpiryDate || undefined,
    referrer: input.referrer?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    representativeId: input.representativeId ?? null,
    listId: input.listId ?? null,
    registrationDate: input.registrationDate || todayIso(),
    customValues: input.customValues ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.customers.add(customer);
  await logActivity({
    type: "create",
    entity: "customer",
    entityId: customer.id,
    title: `مشتری «${customerFullName(customer)}» ثبت شد`,
    detail: customer.passportNo ? `شماره پاسپورت: ${customer.passportNo}` : undefined,
  });
  return customer;
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<void> {
  await db.customers.update(id, {
    firstName: input.firstName?.trim() || undefined,
    lastName: input.lastName?.trim() || undefined,
    birthDate: input.birthDate || undefined,
    passportNo: input.passportNo?.trim().toUpperCase() || undefined,
    passportIssueDate: input.passportIssueDate || undefined,
    passportExpiryDate: input.passportExpiryDate || undefined,
    referrer: input.referrer?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    representativeId: input.representativeId ?? null,
    listId: input.listId ?? null,
    registrationDate: input.registrationDate,
    customValues: input.customValues ?? {},
    updatedAt: Date.now(),
  });
  const updated = await db.customers.get(id);
  await logActivity({
    type: "update",
    entity: "customer",
    entityId: id,
    title: `مشتری «${updated ? customerFullName(updated) : ""}» ویرایش شد`,
  });
}

export async function archiveCustomer(id: string, name: string): Promise<void> {
  await db.customers.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({ type: "archive", entity: "customer", entityId: id, title: `مشتری «${name}» بایگانی شد` });
}

export async function restoreCustomer(id: string, name: string): Promise<void> {
  await db.customers.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({ type: "restore", entity: "customer", entityId: id, title: `مشتری «${name}» بازگردانده شد` });
}

/** Permanently delete a customer along with their requests, attachments and linked payments. */
export async function deleteCustomer(id: string, name: string): Promise<void> {
  await db.transaction(
    "rw",
    db.customers,
    db.requests,
    db.attachments,
    db.payments,
    async () => {
      await db.customers.delete(id);
      const reqs = await db.requests.where("customerId").equals(id).toArray();
      await db.requests.bulkDelete(reqs.map((r) => r.id));
      const atts = await db.attachments.where("customerId").equals(id).toArray();
      await db.attachments.bulkDelete(atts.map((a) => a.id));
      for (const r of reqs) {
        const pays = await db.payments.where("requestId").equals(r.id).toArray();
        await Promise.all(pays.map((p) => db.payments.update(p.id, { requestId: null })));
      }
    },
  );
  await logActivity({
    type: "delete",
    entity: "customer",
    entityId: id,
    title: `مشتری «${name}» به همراه درخواست‌ها و مدارکش حذف شد`,
  });
}
