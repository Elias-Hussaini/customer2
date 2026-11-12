import { db } from "./schema";
import { logActivity } from "./activities";
import type { Customer, CustomerStage, VisaRequest } from "../types";
import {
  customerStageLabel,
  nextStageOf,
  prevStageOf,
} from "../types";

/**
 * Customer journey engine («مرحله‌های ویزا»).
 *
 * The stage lives on the Customer record. When absent (old data / restored
 * legacy backups) it is DERIVED from the customer's requests and their
 * special-code field, so the feature lights up everywhere without a migration:
 *
 *   any issued request      → صادر شده        (stage5)
 *   any rejected request    → رد شده          (stage6)
 *   any request at all      → ثبت شده برای ویزا (stage4)
 *   special code filled     → دارای کد اختصاصی  (stage3)
 *   otherwise               → مرحله اول        (stage1)
 *
 * Auto-advance rules (always forward, never backward):
 *   - creating a customer WITH a special code → stage3, otherwise stage1
 *   - filling the special code while at stage1/stage2 → stage3
 *   - creating a visa request while at stage1..3 → stage4
 *   - issuing a request → stage5 · rejecting → stage6
 *
 * Stage changes made from the keyboard shortcuts also keep the customer's
 * latest active request in sync (issue/un-issue/reject/un-reject) so reports,
 * exports and request tables stay consistent.
 */

/** Effective stage of a customer — stored value wins, else derived. */
export function deriveCustomerStage(
  customer: Customer,
  requests: VisaRequest[],
): CustomerStage {
  if (customer.stage) return customer.stage;
  const mine = requests.filter((r) => r.customerId === customer.id && !r.archivedAt);
  if (mine.some((r) => r.issued)) return "stage5";
  if (mine.some((r) => r.rejected)) return "stage6";
  if (mine.length > 0) return "stage4";
  if (customer.referrer?.trim()) return "stage3";
  return "stage1";
}

/** Stage for a brand-new customer: having a code already = having it. */
export function initialStage(referrer: string | undefined | null): CustomerStage {
  return referrer?.trim() ? "stage3" : "stage1";
}

/**
 * The stage to persist after a special-code edit — fills jump stage1/stage2 to
 * «دارای کد اختصاصی»; clearing the code never demotes (use Alt to go back).
 */
export function stageAfterCodeEdit(
  current: CustomerStage | null | undefined,
  referrer: string | undefined | null,
): CustomerStage | null | undefined {
  if (!referrer?.trim()) return current ?? null;
  if (!current || current === "stage1" || current === "stage2") return "stage3";
  return current;
}

export interface StageChangeResult {
  customerId: string;
  from: CustomerStage;
  to: CustomerStage;
  customerName: string;
}

function customerFullNameOf(c: Customer): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "بدون نام";
}

function todayLocalIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Persist a customer's stage. With `syncCarrier` (default, hotkey path) the
 * customer's latest active request follows the stage: entering stage5 issues
 * it, leaving un-issues it (same for stage6). Request-driven syncs pass
 * syncCarrier:false — the request already changed its own flags.
 * `silent` skips the activity log (automatic syncs log their own entry).
 */
export async function setCustomerStage(
  customerId: string,
  to: CustomerStage,
  opts?: { silent?: boolean; syncCarrier?: boolean },
): Promise<StageChangeResult | null> {
  const customer = await db.customers.get(customerId);
  if (!customer) return null;
  const all = await db.requests.where("customerId").equals(customerId).toArray();
  return applyStageChange(customer, all, to, opts);
}

/** Core stage transition — customer + requests already read by the caller. */
async function applyStageChange(
  customer: Customer,
  all: VisaRequest[],
  to: CustomerStage,
  opts?: { silent?: boolean; syncCarrier?: boolean },
): Promise<StageChangeResult | null> {
  const customerId = customer.id;
  const from = deriveCustomerStage(customer, all);
  if (from === to && customer.stage === to) {
    // Already there — but still normalize the stored value when it was derived.
    if (customer.stage !== to) {
      await db.customers.update(customerId, { stage: to, updatedAt: Date.now() });
    }
    return { customerId, from, to, customerName: customerFullNameOf(customer) };
  }

  const active = all.filter((r) => !r.archivedAt);
  const carrier =
    opts?.syncCarrier === false
      ? null
      : active.length === 0
        ? null
        : active.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
  const now = Date.now();

  if (carrier) {
    if (to === "stage5" && !carrier.issued) {
      await db.requests.update(carrier.id, {
        issued: true,
        rejected: false,
        rejectedAt: null,
        issuedAt: carrier.issuedAt ?? todayLocalIso(),
        updatedAt: now,
      });
    } else if (to !== "stage5" && carrier.issued) {
      // Leaving «صادر شده» — un-issue the carrier (other requests untouched).
      await db.requests.update(carrier.id, { issued: false, issuedAt: null, updatedAt: now });
    }
    if (to === "stage6" && !carrier.rejected) {
      await db.requests.update(carrier.id, {
        rejected: true,
        issued: false,
        issuedAt: null,
        rejectedAt: carrier.rejectedAt ?? todayLocalIso(),
        updatedAt: now,
      });
    } else if (to !== "stage6" && carrier.rejected) {
      await db.requests.update(carrier.id, { rejected: false, rejectedAt: null, updatedAt: now });
    }
  }

  await db.customers.update(customerId, { stage: to, updatedAt: now });

  if (!opts?.silent) {
    await logActivity({
      type: "update",
      entity: "customer",
      entityId: customerId,
      title: `مرحله «${customerFullNameOf(customer)}» به «${customerStageLabel(to)}» تغییر کرد`,
      detail: `از «${customerStageLabel(from)}»`,
    });
  }
  return { customerId, from, to, customerName: customerFullNameOf(customer) };
}

/** One read pass for a customer + their requests (hotkey fast path). */
async function loadCustomerContext(customerId: string): Promise<{
  customer: Customer;
  all: VisaRequest[];
} | null> {
  const customer = await db.customers.get(customerId);
  if (!customer) return null;
  const all = await db.requests.where("customerId").equals(customerId).toArray();
  return { customer, all };
}

/** Ctrl while hovering — next stage (rejected re-enters the pipeline). */
export async function advanceCustomerStage(customerId: string): Promise<StageChangeResult | null> {
  return db.transaction("rw", db.customers, db.requests, db.activities, async () => {
    const ctx = await loadCustomerContext(customerId);
    if (!ctx) return null;
    const current = deriveCustomerStage(ctx.customer, ctx.all);
    return applyStageChange(ctx.customer, ctx.all, nextStageOf(current));
  });
}

/** Alt while hovering — previous stage (rejected falls back into the pipeline). */
export async function rewindCustomerStage(customerId: string): Promise<StageChangeResult | null> {
  return db.transaction("rw", db.customers, db.requests, db.activities, async () => {
    const ctx = await loadCustomerContext(customerId);
    if (!ctx) return null;
    const current = deriveCustomerStage(ctx.customer, ctx.all);
    return applyStageChange(ctx.customer, ctx.all, prevStageOf(current));
  });
}

/** Shift while hovering — toggle «صادر شده». */
export async function toggleCustomerIssued(customerId: string): Promise<StageChangeResult | null> {
  return db.transaction("rw", db.customers, db.requests, db.activities, async () => {
    const ctx = await loadCustomerContext(customerId);
    if (!ctx) return null;
    const current = deriveCustomerStage(ctx.customer, ctx.all);
    return applyStageChange(ctx.customer, ctx.all, current === "stage5" ? "stage4" : "stage5");
  });
}

/** Alt+Shift while hovering — toggle «رد شده». */
export async function toggleCustomerRejected(customerId: string): Promise<StageChangeResult | null> {
  return db.transaction("rw", db.customers, db.requests, db.activities, async () => {
    const ctx = await loadCustomerContext(customerId);
    if (!ctx) return null;
    const current = deriveCustomerStage(ctx.customer, ctx.all);
    return applyStageChange(ctx.customer, ctx.all, current === "stage6" ? "stage4" : "stage6");
  });
}

/**
 * Keep a customer's stage in step with their requests after a request-level
 * issue/reject change (the table toggles). The request already carries the
 * new flags — only the customer's stored stage follows, no carrier sync.
 */
export async function syncStageAfterRequestChange(
  customerId: string,
  nowIssued: boolean,
  nowRejected: boolean,
): Promise<void> {
  const customer = await db.customers.get(customerId);
  if (!customer) return;
  const all = await db.requests.where("customerId").equals(customerId).toArray();
  const current = deriveCustomerStage(customer, all);

  if (nowIssued) {
    if (current !== "stage5") {
      await setCustomerStage(customerId, "stage5", { silent: true, syncCarrier: false });
    }
    return;
  }
  if (nowRejected) {
    if (current !== "stage6") {
      await setCustomerStage(customerId, "stage6", { silent: true, syncCarrier: false });
    }
    return;
  }
  // Un-issued / un-rejected: fall back into the pipeline unless another
  // request of theirs still carries the flag.
  const stillIssued = all.some((r) => r.issued && !r.archivedAt);
  const stillRejected = all.some((r) => r.rejected && !r.archivedAt);
  if (current === "stage5" && !stillIssued) {
    await setCustomerStage(customerId, "stage4", { silent: true, syncCarrier: false });
  } else if (current === "stage6" && !stillRejected) {
    await setCustomerStage(customerId, "stage4", { silent: true, syncCarrier: false });
  }
}

/**
 * Align a customer's stage after a NEW request is created: an issued/rejected
 * request sets stage5/6 outright; a pending request advances stage1..3 to
 * «ثبت شده برای ویزا». Never downgrades stage4/5/6.
 */
export async function syncStageAfterRequestCreate(customerId: string): Promise<void> {
  const customer = await db.customers.get(customerId);
  if (!customer) return;
  const all = await db.requests.where("customerId").equals(customerId).toArray();
  const active = all.filter((r) => !r.archivedAt);
  if (active.some((r) => r.issued)) {
    if (customer.stage !== "stage5") {
      await setCustomerStage(customerId, "stage5", { silent: true, syncCarrier: false });
    }
    return;
  }
  if (active.some((r) => r.rejected)) {
    if (customer.stage !== "stage6") {
      await setCustomerStage(customerId, "stage6", { silent: true, syncCarrier: false });
    }
    return;
  }
  const s = customer.stage;
  if (!s || s === "stage1" || s === "stage2" || s === "stage3") {
    await setCustomerStage(customerId, "stage4", { silent: true, syncCarrier: false });
  }
}

/** customerId → effective stage, for list rendering. */
export function buildStageMap(
  customers: Customer[],
  requests: VisaRequest[],
): Map<string, CustomerStage> {
  const byCustomer = new Map<string, VisaRequest[]>();
  for (const r of requests) {
    if (r.archivedAt) continue;
    const arr = byCustomer.get(r.customerId);
    if (arr) arr.push(r);
    else byCustomer.set(r.customerId, [r]);
  }
  const map = new Map<string, CustomerStage>();
  for (const c of customers) {
    if (c.stage) {
      map.set(c.id, c.stage);
      continue;
    }
    const mine = byCustomer.get(c.id) ?? [];
    if (mine.some((r) => r.issued)) map.set(c.id, "stage5");
    else if (mine.some((r) => r.rejected)) map.set(c.id, "stage6");
    else if (mine.length > 0) map.set(c.id, "stage4");
    else if (c.referrer?.trim()) map.set(c.id, "stage3");
    else map.set(c.id, "stage1");
  }
  return map;
}
