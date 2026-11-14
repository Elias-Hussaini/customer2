/**
 * Customer journey engine («مرحله‌های ویزا») — derivation, auto-advance rules,
 * hover-hotkey actions with request sync, representative sync (profile →
 * requests, manual wins), the one-time legacy backfill and filter mapping.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  advanceCustomerStage,
  buildStageMap,
  deriveCustomerStage,
  rewindCustomerStage,
  setCustomerStage,
  syncStageAfterRequestChange,
  toggleCustomerIssued,
  toggleCustomerRejected,
} from "../stages";
import { createCustomer, updateCustomer } from "../customers";
import {
  createRequest,
  setRequestIssued,
  setRequestRejected,
} from "../requests";
import {
  CUSTOMER_STAGE_LABELS,
  DEFAULT_STAGE_COLORS,
  customerStageColor,
  customerStageLabel,
  nextStageOf,
  normalizeStageFilter,
  prevStageOf,
  type Customer,
  type CustomerStage,
  type VisaRequest,
} from "../../types";

const day = (offset: number) => {
  const d = new Date(2026, 0, 10 + offset);
  return d.toISOString().slice(0, 10);
};

async function seedCustomer(opts: Partial<Customer> = {}): Promise<Customer> {
  const c = await createCustomer({
    firstName: opts.firstName ?? "تست",
    lastName: opts.lastName ?? "مشتری",
    referrer: opts.referrer,
    representativeId: opts.representativeId ?? null,
    listId: opts.listId ?? null,
    registrationDate: day(0),
  });
  if (opts.stage) await db.customers.update(c.id, { stage: opts.stage });
  return (await db.customers.get(c.id))!;
}

function req(overrides: Partial<VisaRequest> = {}): Parameters<typeof createRequest>[0] {
  return {
    customerId: overrides.customerId ?? "c",
    representativeId: overrides.representativeId ?? null,
    listId: null,
    visaType: "تستی",
    tags: [],
    registrationDate: day(1),
    issued: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.customers.clear();
  await db.requests.clear();
  await db.activities.clear();
  await db.preferences.clear();
});

/* ------------------------------ pure helpers ------------------------------ */

describe("stage helpers", () => {
  it("labels and colors cover all six stages", () => {
    for (const s of ["stage1", "stage2", "stage3", "stage4", "stage5", "stage6"] as const) {
      expect(customerStageLabel(s)).toBeTruthy();
      expect(DEFAULT_STAGE_COLORS[s]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(customerStageLabel("stage5")).toBe("صادر شده");
    expect(customerStageLabel("stage2")).toBe("ثبت شده برای کد اختصاصی");
  });

  it("resolves color overrides", () => {
    expect(customerStageColor("stage1")).toBe(DEFAULT_STAGE_COLORS.stage1);
    expect(customerStageColor("stage1", { stage1: "#123456" })).toBe("#123456");
    expect(customerStageColor(null)).toBe(DEFAULT_STAGE_COLORS.stage1);
  });

  it("pipeline next/prev: rejected re-enters at «ثبت شده برای ویزا»", () => {
    expect(nextStageOf("stage1")).toBe("stage2");
    expect(nextStageOf("stage2")).toBe("stage3");
    expect(nextStageOf("stage3")).toBe("stage4");
    expect(nextStageOf("stage4")).toBe("stage5");
    expect(nextStageOf("stage5")).toBe("stage5"); // terminal
    expect(nextStageOf("stage6")).toBe("stage4");
    expect(prevStageOf("stage1")).toBe("stage1"); // terminal
    expect(prevStageOf("stage5")).toBe("stage4");
    expect(prevStageOf("stage6")).toBe("stage4");
  });

  it("maps legacy status filters onto the new stage keys", () => {
    expect(normalizeStageFilter("issued")).toBe("stage5");
    expect(normalizeStageFilter("pending")).toBe("stage4");
    expect(normalizeStageFilter("rejected")).toBe("stage6");
    expect(normalizeStageFilter("none")).toBe("none");
    expect(normalizeStageFilter("")).toBe("");
    expect(normalizeStageFilter("stage3")).toBe("stage3");
    expect(normalizeStageFilter("garbage")).toBe("");
  });
});

/* ------------------------------- derivation ------------------------------- */

describe("deriveCustomerStage", () => {
  const base = { id: "c1", createdAt: 1, registrationDate: day(0) } as Customer;

  it("fresh customer without a code → مرحله اول", () => {
    expect(deriveCustomerStage(base, [])).toBe("stage1");
  });

  it("special code filled → دارای کد اختصاصی", () => {
    expect(deriveCustomerStage({ ...base, referrer: "K-99" }, [])).toBe("stage3");
  });

  it("has a request → ثبت شده برای ویزا", () => {
    expect(deriveCustomerStage(base, [req({ customerId: "c1" }) as unknown as VisaRequest])).toBe(
      "stage4",
    );
  });

  it("issued request wins → صادر شده", () => {
    const r = { customerId: "c1", issued: true } as VisaRequest;
    expect(deriveCustomerStage(base, [r])).toBe("stage5");
  });

  it("rejected request → رد شده", () => {
    const r = { customerId: "c1", rejected: true } as VisaRequest;
    expect(deriveCustomerStage(base, [r])).toBe("stage6");
  });

  it("archived requests are ignored", () => {
    const r = { customerId: "c1", issued: true, archivedAt: 5 } as VisaRequest;
    expect(deriveCustomerStage(base, [r])).toBe("stage1");
  });

  it("stored stage always wins over derivation", () => {
    const r = { customerId: "c1", issued: true } as VisaRequest;
    expect(deriveCustomerStage({ ...base, stage: "stage2" }, [r])).toBe("stage2");
  });
});

describe("buildStageMap", () => {
  it("maps every active customer (stored or derived)", async () => {
    const withCode = await seedCustomer({ referrer: "K-1" });
    const issued = await seedCustomer({ firstName: "صادر" });
    const r = await createRequest(req({ customerId: issued.id, issued: true, issuedAt: day(2) }));
    expect(r.issued).toBe(true);

    const map = buildStageMap(await db.customers.toArray(), await db.requests.toArray());
    expect(map.get(withCode.id)).toBe("stage3");
    expect(map.get(issued.id)).toBe("stage5");
  });
});

/* ------------------------------ auto-advance ------------------------------ */

describe("auto-advance rules", () => {
  it("new customer starts at مرحله اول — or دارای کد اختصاصی when the code is known", async () => {
    const plain = await seedCustomer();
    expect(plain.stage).toBe("stage1");
    const coded = await seedCustomer({ referrer: "K-7" });
    expect(coded.stage).toBe("stage3");
  });

  it("filling the code moves stage1/stage2 → stage3; clearing never demotes", async () => {
    const c = await seedCustomer();
    await updateCustomer(c.id, {
      firstName: c.firstName,
      lastName: c.lastName,
      referrer: "K-8",
      representativeId: null,
      listId: null,
      registrationDate: day(0),
    });
    expect((await db.customers.get(c.id))!.stage).toBe("stage3");

    // Clearing the code keeps the stage (going back is Alt's job).
    await updateCustomer(c.id, {
      firstName: c.firstName,
      lastName: c.lastName,
      referrer: undefined,
      representativeId: null,
      listId: null,
      registrationDate: day(0),
    });
    expect((await db.customers.get(c.id))!.stage).toBe("stage3");
  });

  it("a manual stage2 customer jumps to stage3 when the code arrives", async () => {
    const c = await seedCustomer();
    await db.customers.update(c.id, { stage: "stage2" });
    await updateCustomer(c.id, {
      firstName: c.firstName,
      lastName: c.lastName,
      referrer: "K-9",
      representativeId: null,
      listId: null,
      registrationDate: day(0),
    });
    expect((await db.customers.get(c.id))!.stage).toBe("stage3");
  });

  it("creating the first request advances to ثبت شده برای ویزا (never past 5/6)", async () => {
    const c = await seedCustomer({ referrer: "K-1" });
    await createRequest(req({ customerId: c.id }));
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");

    const issued = await seedCustomer({ firstName: "صادره" });
    await createRequest(req({ customerId: issued.id, issued: true, issuedAt: day(2) }));
    expect((await db.customers.get(issued.id))!.stage).toBe("stage5");
  });

  it("round 24: the simultaneous request of a NEW customer does NOT jump the stage", async () => {
    // The CustomerFormModal path: createCustomer → createRequest(…, { advanceStage: false }).
    const fresh = await seedCustomer(); // no code → مرحله اول
    expect((await db.customers.get(fresh.id))!.stage).toBe("stage1");
    const r = await createRequest(req({ customerId: fresh.id }), { advanceStage: false });
    // The request exists (bookkeeping) but the journey did NOT advance.
    expect(await db.requests.get(r.id)).toBeTruthy();
    expect((await db.requests.get(r.id))!.issued).toBe(false);
    expect((await db.customers.get(fresh.id))!.stage).toBe("stage1");

    // Code filled in the same form → دارای کد اختصاصی (kept, not overwritten).
    const withCode = await seedCustomer({ referrer: "K-7" });
    expect((await db.customers.get(withCode.id))!.stage).toBe("stage3");
    await createRequest(req({ customerId: withCode.id }), { advanceStage: false });
    expect((await db.customers.get(withCode.id))!.stage).toBe("stage3");

    // Already-registered customers are NEVER rewritten by this path.
    const existing = await seedCustomer({ stage: "stage4" });
    await createRequest(req({ customerId: existing.id }), { advanceStage: false });
    expect((await db.customers.get(existing.id))!.stage).toBe("stage4");
    const existingIssued = await seedCustomer({ stage: "stage5" });
    await createRequest(req({ customerId: existingIssued.id }), { advanceStage: false });
    expect((await db.customers.get(existingIssued.id))!.stage).toBe("stage5");

    // Real-world progress afterwards still syncs (issue → صادر شده).
    await setRequestIssued(r.id, true, day(3));
    expect((await db.customers.get(fresh.id))!.stage).toBe("stage5");
    await setRequestIssued(r.id, false);
    expect((await db.customers.get(fresh.id))!.stage).toBe("stage4");
  });

  it("request issue/reject sync the customer stage both ways", async () => {
    const c = await seedCustomer();
    const r = await createRequest(req({ customerId: c.id }));
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");

    await setRequestIssued(r.id, true, day(3));
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");

    await setRequestIssued(r.id, false);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");

    await setRequestRejected(r.id, true, day(4));
    expect((await db.customers.get(c.id))!.stage).toBe("stage6");

    await setRequestRejected(r.id, false);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
  });

  it("another pending request keeps the journey sane when one is un-issued", async () => {
    const c = await seedCustomer();
    const r1 = await createRequest(req({ customerId: c.id }));
    const r2 = await createRequest(req({ customerId: c.id }));
    await setRequestIssued(r1.id, true, day(3));
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");
    // r2 must NOT be touched as a side effect of issuing r1.
    expect((await db.requests.get(r2.id))!.issued).toBe(false);

    await setRequestIssued(r1.id, false);
    // Nothing keeps stage5 any more — falls back into the pipeline.
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
  });
});

/* ------------------------------ hotkey actions ---------------------------- */

describe("hover hotkey actions", () => {
  it("Ctrl: walks the pipeline forward, terminal at stage5", async () => {
    const c = await seedCustomer();
    await advanceCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage2");
    await advanceCustomerStage(c.id);
    await advanceCustomerStage(c.id);
    await advanceCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");
    await advanceCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");
  });

  it("Alt: walks back, stops at stage1; rejected falls back into the pipeline", async () => {
    const c = await seedCustomer();
    await db.customers.update(c.id, { stage: "stage4" });
    await rewindCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage3");
    await rewindCustomerStage(c.id);
    await rewindCustomerStage(c.id);
    await rewindCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage1");

    await db.customers.update(c.id, { stage: "stage6" });
    await rewindCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
  });

  it("Ctrl on a rejected customer re-enters at ثبت شده برای ویزا", async () => {
    const c = await seedCustomer();
    await db.customers.update(c.id, { stage: "stage6" });
    await advanceCustomerStage(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
  });

  it("Shift: toggles صادر شده and syncs the carrier request", async () => {
    const c = await seedCustomer();
    const r = await createRequest(req({ customerId: c.id }));

    await toggleCustomerIssued(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");
    expect((await db.requests.get(r.id))!.issued).toBe(true);

    await toggleCustomerIssued(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
    expect((await db.requests.get(r.id))!.issued).toBe(false);
  });

  it("Alt+Shift: toggles رد شده and syncs the carrier request", async () => {
    const c = await seedCustomer();
    const r = await createRequest(req({ customerId: c.id }));

    await toggleCustomerRejected(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage6");
    expect((await db.requests.get(r.id))!.rejected).toBe(true);
    expect((await db.requests.get(r.id))!.issued).toBe(false);

    await toggleCustomerRejected(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage4");
    expect((await db.requests.get(r.id))!.rejected).toBe(false);
  });

  it("works for customers without any request (stage-only)", async () => {
    const c = await seedCustomer();
    await toggleCustomerIssued(c.id);
    expect((await db.customers.get(c.id))!.stage).toBe("stage5");
    const count = await db.requests.count();
    expect(count).toBe(0);
  });

  it("issue-then-reject through hotkeys clears the issued flag on the carrier", async () => {
    const c = await seedCustomer();
    const r = await createRequest(req({ customerId: c.id }));
    await toggleCustomerIssued(c.id);
    await toggleCustomerRejected(c.id);
    const row = await db.requests.get(r.id);
    expect(row!.issued).toBe(false);
    expect(row!.rejected).toBe(true);
  });

  it("setCustomerStage logs an activity (audit trail)", async () => {
    const c = await seedCustomer();
    await setCustomerStage(c.id, "stage2");
    const acts = await db.activities.toArray();
    expect(acts.some((a) => a.title.includes(CUSTOMER_STAGE_LABELS.stage2))).toBe(true);
  });
});

/* --------------------------- misc engine details --------------------------- */

describe("syncStageAfterRequestChange guards", () => {
  it("silently ignores unknown customers", async () => {
    await expect(syncStageAfterRequestChange("ghost", false, false)).resolves.toBeUndefined();
  });
});
