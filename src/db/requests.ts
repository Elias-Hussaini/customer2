import { db } from "./schema";
import { logActivity } from "./activities";
import type { VisaRequest } from "../types";
import { uid } from "../utils/id";
import { todayIso } from "../utils/jalali";
import { normalizeAmount } from "../utils/num";

export interface RequestInput {
  customerId: string;
  representativeId: string | null;
  listId: string | null;
  visaType?: string;
  tags: string[];
  quotedAmount?: number;
  currency?: VisaRequest["currency"];
  registrationDate: string;
  issued: boolean;
  issuedAt?: string | null;
  notes?: string;
  customValues?: Record<string, unknown>;
}

export async function createRequest(input: RequestInput): Promise<VisaRequest> {
  const now = Date.now();
  const request: VisaRequest = {
    id: uid(),
    customerId: input.customerId,
    representativeId: input.representativeId,
    listId: input.listId,
    visaType: input.visaType?.trim() || undefined,
    tags: input.tags,
    quotedAmount:
      input.quotedAmount != null && Number.isFinite(input.quotedAmount)
        ? normalizeAmount(input.quotedAmount, input.currency ?? "IRT")
        : undefined,
    currency: input.quotedAmount != null ? input.currency : undefined,
    registrationDate: input.registrationDate || todayIso(),
    issued: input.issued,
    issuedAt: input.issued ? input.issuedAt || todayIso() : null,
    notes: input.notes?.trim() || undefined,
    customValues: input.customValues ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.requests.add(request);
  await logActivity({
    type: "create",
    entity: "request",
    entityId: request.id,
    title: `درخواست ویزا ثبت شد${request.visaType ? ` — ${request.visaType}` : ""}`,
    detail: `تاریخ ثبت: ${request.registrationDate}`,
  });
  return request;
}

export async function updateRequest(id: string, input: RequestInput): Promise<void> {
  await db.requests.update(id, {
    customerId: input.customerId,
    representativeId: input.representativeId,
    listId: input.listId,
    visaType: input.visaType?.trim() || undefined,
    tags: input.tags,
    quotedAmount:
      input.quotedAmount != null && Number.isFinite(input.quotedAmount)
        ? normalizeAmount(input.quotedAmount, input.currency ?? "IRT")
        : undefined,
    currency: input.quotedAmount != null ? input.currency : undefined,
    registrationDate: input.registrationDate,
    issued: input.issued,
    issuedAt: input.issued ? input.issuedAt || todayIso() : null,
    notes: input.notes?.trim() || undefined,
    customValues: input.customValues ?? {},
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "request",
    entityId: id,
    title: `درخواست ویزا ویرایش شد${input.visaType ? ` — ${input.visaType}` : ""}`,
  });
}

/** Toggle the "visa issued" flag with an audit entry. */
export async function setRequestIssued(
  id: string,
  issued: boolean,
  issuedAt?: string | null,
): Promise<void> {
  await db.requests.update(id, {
    issued,
    issuedAt: issued ? issuedAt || todayIso() : null,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: issued ? "issue" : "unissue",
    entity: "request",
    entityId: id,
    title: issued ? "وضعیت به «صادر شده» تغییر کرد" : "وضعیت صدور لغو شد",
    detail: issued ? `تاریخ صدور: ${issuedAt || todayIso()}` : "وضعیت به «در حال کار» برگشت",
  });
}

export async function moveRequestsToList(requestIds: string[], listId: string | null): Promise<void> {
  await db.transaction("rw", db.requests, async () => {
    await Promise.all(
      requestIds.map((id) => db.requests.update(id, { listId, updatedAt: Date.now() })),
    );
  });
  await logActivity({
    type: "update",
    entity: "request",
    title: `${requestIds.length} درخواست جابه‌جا شد`,
    detail: listId ? "انتقال به لیست دیگر" : "حذف از لیست",
  });
}

export async function archiveRequest(id: string, visaType?: string): Promise<void> {
  await db.requests.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({
    type: "archive",
    entity: "request",
    entityId: id,
    title: `درخواست${visaType ? ` «${visaType}»` : ""} بایگانی شد`,
  });
}

export async function restoreRequest(id: string, visaType?: string): Promise<void> {
  await db.requests.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({
    type: "restore",
    entity: "request",
    entityId: id,
    title: `درخواست${visaType ? ` «${visaType}»` : ""} از آرشیو بازگردانده شد`,
  });
}

/** Permanently delete a request; linked payments are detached, not deleted. */
export async function deleteRequest(id: string, visaType?: string): Promise<void> {
  await db.transaction("rw", db.requests, db.payments, async () => {
    const pays = await db.payments.where("requestId").equals(id).toArray();
    await Promise.all(pays.map((p) => db.payments.update(p.id, { requestId: null })));
    await db.requests.delete(id);
  });
  await logActivity({
    type: "delete",
    entity: "request",
    entityId: id,
    title: `درخواست${visaType ? ` «${visaType}»` : ""} حذف شد`,
  });
}
