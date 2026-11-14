import { db } from "./schema";
import { logActivity } from "./activities";
import { DEFAULT_PREFS } from "./prefs";
import { syncStageAfterRequestChange, syncStageAfterRequestCreate } from "./stages";
import type { VisaRequest } from "../types";
import { requestStatusFa } from "../types";
import { uid } from "../utils/id";
import { todayIso, formatJalali } from "../utils/jalali";
import { normalizeAmount } from "../utils/num";

export { requestStatusFa };
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
  rejected?: boolean;
  rejectedAt?: string | null;
  notes?: string;
  customValues?: Record<string, unknown>;
}

/** Options for createRequest.
 *
 * `advanceStage: false` is used by the NEW-customer registration flow
 * (CustomerFormModal): the simultaneous visa request is pure bookkeeping —
 * it must NOT push the fresh customer's journey to «ثبت شده برای ویزا».
 * The customer keeps the stage createCustomer gave them («مرحله اول», or
 * «دارای کد اختصاصی» when their code was filled in the same form). Only a
 * SEPARATE request creation (request form, AI agent, seed) advances the
 * stage. Default (no opts / true) keeps the legacy behavior. */
export interface CreateRequestOptions {
  advanceStage?: boolean;
}

export async function createRequest(
  input: RequestInput,
  opts: CreateRequestOptions = {},
): Promise<VisaRequest> {
  const now = Date.now();
  // A brand-new request typed in the form counts as a manual choice when it
  // does NOT match its customer's profile representative — otherwise it just
  // follows the profile (and later profile changes keep syncing it).
  const customer = await db.customers.get(input.customerId);
  const repOverride = input.representativeId !== (customer?.representativeId ?? null);
  const request: VisaRequest = {
    id: uid(),
    customerId: input.customerId,
    representativeId: input.representativeId,
    ...(repOverride ? { repOverride: true } : {}),
    listId: input.listId,
    visaType: input.visaType?.trim() || undefined,
    tags: input.tags,
    quotedAmount:
      input.quotedAmount != null && Number.isFinite(input.quotedAmount)
        ? normalizeAmount(input.quotedAmount, input.currency ?? "IRT")
        : undefined,
    currency: input.quotedAmount != null ? input.currency : undefined,
    registrationDate: input.registrationDate || todayIso(),
    // issued and rejected are mutually exclusive — issuing clears any rejection.
    issued: input.issued,
    issuedAt: input.issued ? input.issuedAt || todayIso() : null,
    rejected: input.issued ? false : input.rejected === true,
    rejectedAt: input.issued || !input.rejected ? null : input.rejectedAt || todayIso(),
    notes: input.notes?.trim() || undefined,
    customValues: input.customValues ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.requests.add(request);
  // Stage engine: a customer's first pending request advances them to
  // «ثبت شده برای ویزا»; an issued/rejected new request sets stage5/6 outright.
  // Skipped ONLY for the simultaneous new-customer registration — the fresh
  // customer stays at «مرحله اول» (round 24 user rule). Never touches
  // already-registered customers: no migration, no rewrite of stored stages.
  if (opts.advanceStage !== false) {
    await syncStageAfterRequestCreate(request.customerId);
  }
  await logActivity({
    type: "create",
    entity: "request",
    entityId: request.id,
    title: `درخواست ویزا ثبت شد${request.visaType ? ` — ${request.visaType}` : ""}`,
    detail: `تاریخ ثبت: ${formatJalali(request.registrationDate)}`,
  });
  return request;
}

export async function updateRequest(id: string, input: RequestInput): Promise<void> {
  // Sticky-manual rule (round 22): a representative chosen in the REQUEST form
  // only follows the customer's profile again once it matches it — any other
  // value marks this row as manually overridden.
  const customer = await db.customers.get(input.customerId);
  const repOverride = input.representativeId !== (customer?.representativeId ?? null);
  await db.requests.update(id, {
    customerId: input.customerId,
    representativeId: input.representativeId,
    ...(repOverride ? { repOverride: true } : { repOverride: false }),
    listId: input.listId,
    visaType: input.visaType?.trim() || undefined,
    tags: input.tags,
    quotedAmount:
      input.quotedAmount != null && Number.isFinite(input.quotedAmount)
        ? normalizeAmount(input.quotedAmount, input.currency ?? "IRT")
        : undefined,
    currency: input.quotedAmount != null ? input.currency : undefined,
    registrationDate: input.registrationDate,
    // issued and rejected are mutually exclusive — issuing clears any rejection.
    issued: input.issued,
    issuedAt: input.issued ? input.issuedAt || todayIso() : null,
    rejected: input.issued ? false : input.rejected === true,
    rejectedAt: input.issued || !input.rejected ? null : input.rejectedAt || todayIso(),
    notes: input.notes?.trim() || undefined,
    customValues: input.customValues ?? {},
    updatedAt: Date.now(),
  });
  // Stage engine: keep the customer's journey in step with the flags.
  await syncStageAfterRequestChange(
    input.customerId,
    input.issued,
    !input.issued && input.rejected === true,
  );
  await logActivity({
    type: "update",
    entity: "request",
    entityId: id,
    title: `درخواست ویزا ویرایش شد${input.visaType ? ` — ${input.visaType}` : ""}`,
  });
}

/** Round 22 — profile→request representative sync.
 *
 * The customer's profile representative changed (or is being repaired): every
 * visa request of that customer follows the new representative — EXCEPT rows
 * whose representative was manually overridden inside the request form
 * (`repOverride`) — those keep their hand-picked representative until the
 * request itself is edited again. A null/absent new representative never
 * blanks request rows (requests must always show a representative).
 *
 * Returns how many requests were updated. */
export async function syncRequestsToCustomerRep(
  customerId: string,
  newRepId: string | null | undefined,
): Promise<number> {
  if (!newRepId) return 0;
  const reqs = await db.requests.where("customerId").equals(customerId).toArray();
  const toSync = reqs.filter(
    (r) => !r.repOverride && r.representativeId !== newRepId,
  );
  if (toSync.length === 0) return 0;
  const now = Date.now();
  await db.transaction("rw", db.requests, async () => {
    await Promise.all(
      toSync.map((r) =>
        db.requests.update(r.id, { representativeId: newRepId, updatedAt: now }),
      ),
    );
  });
  return toSync.length;
}

/** Round 22 — one-time repair of ALL historical mismatches.
 *
 * For every customer whose current profile representative differs from (some
 * of) their visa requests' representatives, the stale request rows are synced
 * to the profile (manual overrides unknown in legacy data — the user asked for
 * the blanket fix). Guarded by a preferences flag so it runs exactly once. */
export async function backfillRequestReps(): Promise<number> {
  const prefs = await db.preferences.get("app");
  if (prefs?.repSyncBackfilled) return 0;
  const [customers, requests, reps] = await Promise.all([
    db.customers.toArray(),
    db.requests.toArray(),
    db.representatives.toArray(),
  ]);
  const repById = new Map(reps.map((r) => [r.id, r]));
  const repNameByCustomer = new Map(
    customers.filter((c) => c.representativeId).map((c) => [c.id, c.representativeId!]),
  );
  const now = Date.now();
  const updates: { id: string; repId: string }[] = [];
  for (const c of customers) {
    if (!c.representativeId) continue;
    for (const r of requests) {
      if (r.customerId === c.id && r.representativeId !== c.representativeId) {
        updates.push({ id: r.id, repId: c.representativeId });
      }
    }
  }
  if (updates.length > 0) {
    await db.transaction("rw", db.requests, async () => {
      await Promise.all(
        updates.map((u) =>
          db.requests.update(u.id, {
            representativeId: u.repId,
            repOverride: false,
            updatedAt: now,
          }),
        ),
      );
    });
    // One clear audit line so the repair is visible in the activity feed.
    const sampleRepId = repNameByCustomer.get(
      requests.find((r) => r.id === updates[0].id)?.customerId ?? "",
    );
    await logActivity({
      type: "update",
      entity: "request",
      title: `همگام‌سازی نمایندگان: ${updates.length.toLocaleString("fa-IR")} درخواست به نمایندهٔ فعلی مشتری‌ها به‌روز شد`,
      detail:
        sampleRepId && repById.get(sampleRepId)
          ? `درخواست‌هایی که نمایندهٔ قدیمی داشتند، به نمایندهٔ پروفایل مشتری رسیدند — نمونه: ${repById.get(sampleRepId)!.name}`
          : "درخواست‌هایی که نمایندهٔ قدیمی داشتند، به نمایندهٔ پروفایل مشتری رسیدند",
    });
  }
  await db.preferences.put({
    ...(prefs ?? DEFAULT_PREFS),
    id: "app",
    repSyncBackfilled: true,
    updatedAt: Date.now(),
  });
  return updates.length;
}

/** Toggle the "visa issued" flag with an audit entry. Issuing clears a rejection. */
export async function setRequestIssued(
  id: string,
  issued: boolean,
  issuedAt?: string | null,
): Promise<void> {
  const before = await db.requests.get(id);
  await db.requests.update(id, {
    issued,
    issuedAt: issued ? issuedAt || todayIso() : null,
    ...(issued ? { rejected: false, rejectedAt: null } : {}),
    updatedAt: Date.now(),
  });
  if (before) {
    await syncStageAfterRequestChange(before.customerId, issued, false);
  }
  await logActivity({
    type: issued ? "issue" : "unissue",
    entity: "request",
    entityId: id,
    title: issued ? "وضعیت به «صادر شده» تغییر کرد" : "وضعیت صدور لغو شد",
    detail: issued
      ? `تاریخ صدور: ${formatJalali(issuedAt || todayIso())}`
      : "وضعیت به «در حال کار» برگشت",
  });
}

/** Toggle the "application REJECTED" flag with an audit entry. Rejecting un-issues. */
export async function setRequestRejected(
  id: string,
  rejected: boolean,
  rejectedAt?: string | null,
): Promise<void> {
  const before = await db.requests.get(id);
  await db.requests.update(id, {
    rejected,
    rejectedAt: rejected ? rejectedAt || todayIso() : null,
    ...(rejected ? { issued: false, issuedAt: null } : {}),
    updatedAt: Date.now(),
  });
  if (before) {
    await syncStageAfterRequestChange(before.customerId, false, rejected);
  }
  await logActivity({
    type: rejected ? "reject" : "unreject",
    entity: "request",
    entityId: id,
    title: rejected ? "درخواست «رد شده» علامت خورد" : "وضعیت رد شدن لغو شد",
    detail: rejected
      ? `تاریخ رد: ${formatJalali(rejectedAt || todayIso())}`
      : "وضعیت به «در حال کار» برگشت",
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
