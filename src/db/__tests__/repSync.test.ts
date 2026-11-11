/**
 * Round 22 — profile→request representative sync:
 *
 *  - changing the customer's profile representative re-points their visa
 *    requests (updateCustomer returns how many followed),
 *  - requests whose rep was set BY HAND in the request form (repOverride)
 *    keep their rep,
 *  - editing a request re-evaluates the override (matching the profile again
 *    clears it),
 *  - a null profile rep never blanks requests,
 *  - the one-time backfill repairs every historical mismatch exactly once.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  createRequest,
  updateRequest,
  syncRequestsToCustomerRep,
  backfillRequestReps,
} from "../requests";
import { createCustomer, updateCustomer } from "../customers";
import { createRepresentative } from "../reps";
import { createList } from "../lists";
import { DEFAULT_PREFS } from "../prefs";

async function seed() {
  const repA = await createRepresentative({ name: "نماینده الف" });
  const repB = await createRepresentative({ name: "نماینده ب" });
  const repC = await createRepresentative({ name: "نماینده ج" });
  const list = await createList({ name: "لیست تست" });
  const customer = await createCustomer({
    firstName: "علی",
    lastName: "احمدی",
    representativeId: repA.id,
    listId: list.id,
    registrationDate: "2026-01-01",
  });
  return { repA, repB, repC, list, customer };
}

const baseInput = (customerId: string, representativeId: string, listId: string) => ({
  customerId,
  representativeId,
  listId,
  visaType: "توریستی",
  tags: [] as string[],
  registrationDate: "2026-01-05",
  issued: false,
});

beforeEach(async () => {
  await Promise.all([
    db.customers.clear(),
    db.requests.clear(),
    db.representatives.clear(),
    db.lists.clear(),
    db.activities.clear(),
    db.preferences.clear(),
  ]);
});

describe("createRequest — override stamping", () => {
  it("follows the customer's profile rep (no override flag)", async () => {
    const { repA, list, customer } = await seed();
    const r = await createRequest(baseInput(customer.id, repA.id, list.id));
    expect(r.representativeId).toBe(repA.id);
    expect(r.repOverride ?? false).toBe(false);
  });

  it("marks a request under a DIFFERENT rep as a manual override", async () => {
    const { repA, repB, list, customer } = await seed();
    const r = await createRequest(baseInput(customer.id, repB.id, list.id));
    expect(r.repOverride).toBe(true);
    void repA;
  });
});

describe("updateCustomer — profile rep change syncs requests", () => {
  it("re-points the customer's requests to the new rep", async () => {
    const { repA, repB, list, customer } = await seed();
    const r1 = await createRequest(baseInput(customer.id, repA.id, list.id));
    const r2 = await createRequest(baseInput(customer.id, repA.id, list.id));

    const res = await updateCustomer(customer.id, {
      firstName: "علی",
      lastName: "احمدی",
      representativeId: repB.id,
      listId: list.id,
      registrationDate: "2026-01-01",
    });

    expect(res.syncedRequests).toBe(2);
    expect((await db.requests.get(r1.id))?.representativeId).toBe(repB.id);
    expect((await db.requests.get(r2.id))?.representativeId).toBe(repB.id);
  });

  it("leaves manually overridden requests untouched", async () => {
    const { repA, repB, repC, list, customer } = await seed();
    const follow = await createRequest(baseInput(customer.id, repA.id, list.id));
    const manual = await createRequest(baseInput(customer.id, repC.id, list.id)); // repOverride

    const res = await updateCustomer(customer.id, {
      firstName: "علی",
      lastName: "احمدی",
      representativeId: repB.id,
      listId: list.id,
      registrationDate: "2026-01-01",
    });

    expect(res.syncedRequests).toBe(1);
    expect((await db.requests.get(follow.id))?.representativeId).toBe(repB.id);
    expect((await db.requests.get(manual.id))?.representativeId).toBe(repC.id);
  });

  it("never blanks request reps when the profile rep is removed", async () => {
    const { repA, list, customer } = await seed();
    const r = await createRequest(baseInput(customer.id, repA.id, list.id));

    const res = await updateCustomer(customer.id, {
      firstName: "علی",
      lastName: "احمدی",
      representativeId: null,
      listId: list.id,
      registrationDate: "2026-01-01",
    });

    expect(res.syncedRequests).toBe(0);
    expect((await db.requests.get(r.id))?.representativeId).toBe(repA.id);
  });

  it("only touches THIS customer's requests", async () => {
    const { repA, repB, list, customer } = await seed();
    const other = await createCustomer({
      firstName: "رضا",
      lastName: "کریمی",
      representativeId: repA.id,
      listId: list.id,
      registrationDate: "2026-01-02",
    });
    const mine = await createRequest(baseInput(customer.id, repA.id, list.id));
    const theirs = await createRequest(baseInput(other.id, repA.id, list.id));

    const res = await updateCustomer(customer.id, {
      firstName: "علی",
      lastName: "احمدی",
      representativeId: repB.id,
      listId: list.id,
      registrationDate: "2026-01-01",
    });

    expect(res.syncedRequests).toBe(1);
    expect((await db.requests.get(mine.id))?.representativeId).toBe(repB.id);
    expect((await db.requests.get(theirs.id))?.representativeId).toBe(repA.id);
  });

  it("logs an activity line when requests followed", async () => {
    const { repA, repB, list, customer } = await seed();
    await createRequest(baseInput(customer.id, repA.id, list.id));
    await updateCustomer(customer.id, {
      firstName: "علی",
      lastName: "احمدی",
      representativeId: repB.id,
      listId: list.id,
      registrationDate: "2026-01-01",
    });
    const acts = await db.activities.orderBy("ts").reverse().toArray();
    expect(
      acts.some((a) => a.entity === "request" && a.title.includes("به «نماینده ب» تغییر کرد")),
    ).toBe(true);
  });
});

describe("updateRequest — override re-evaluation", () => {
  it("clears the override when the rep is set back to the profile's", async () => {
    const { repA, repB, list, customer } = await seed();
    const r = await createRequest(baseInput(customer.id, repB.id, list.id));
    expect(r.repOverride).toBe(true);

    await updateRequest(r.id, baseInput(customer.id, repA.id, list.id));
    const after = await db.requests.get(r.id);
    expect(after?.representativeId).toBe(repA.id);
    expect(after?.repOverride).toBe(false);

    // Now a later profile change syncs it again.
    const repC = (await db.representatives.toArray()).find((x) => x.name === "نماینده ج")!;
    const n = await syncRequestsToCustomerRep(customer.id, repC.id);
    expect(n).toBe(1);
    expect((await db.requests.get(r.id))?.representativeId).toBe(repC.id);
  });

  it("keeps the override sticky while the rep differs from the profile", async () => {
    const { repA, repB, repC, list, customer } = await seed();
    const r = await createRequest(baseInput(customer.id, repB.id, list.id));
    // Edit again (untouched rep field) — stays an override.
    await updateRequest(r.id, { ...baseInput(customer.id, repB.id, list.id), notes: "بدون تغییر نماینده" });
    expect((await db.requests.get(r.id))?.repOverride).toBe(true);

    const n = await syncRequestsToCustomerRep(customer.id, repC.id);
    expect(n).toBe(0);
    expect((await db.requests.get(r.id))?.representativeId).toBe(repB.id);
    void repA;
  });
});

describe("backfillRequestReps — one-time historical repair", () => {
  it("repairs every stale row to the customer's current rep", async () => {
    const { repA, repB, list, customer } = await seed();
    await createRequest(baseInput(customer.id, repA.id, list.id)); // follows profile already
    await createRequest(baseInput(customer.id, repB.id, list.id)); // stale (legacy override unknown)

    const n = await backfillRequestReps();
    expect(n).toBe(1);
    const rows = await db.requests.toArray();
    expect(rows.every((r) => r.representativeId === repA.id)).toBe(true);
    expect(rows.every((r) => !r.repOverride)).toBe(true);
  });

  it("runs exactly once (prefs guard) and touches nothing on the second run", async () => {
    const { repA, repB, list, customer } = await seed();
    await createRequest(baseInput(customer.id, repB.id, list.id));

    expect(await backfillRequestReps()).toBe(1);
    // Sabotage: change a request back to the stale rep — a second run must
    // NOT repair it again (the flag is already set).
    const row = (await db.requests.toArray())[0];
    await db.requests.update(row.id, { representativeId: repB.id });
    expect(await backfillRequestReps()).toBe(0);
    expect((await db.requests.get(row.id))?.representativeId).toBe(repB.id);

    const prefs = await db.preferences.get("app");
    expect(prefs?.repSyncBackfilled).toBe(true);
    void repA;
  });

  it("leaves customers without a profile rep alone", async () => {
    const { repA, list } = await seed();
    const orphan = await createCustomer({
      firstName: "بی",
      lastName: "نماینده",
      representativeId: null,
      listId: list.id,
      registrationDate: "2026-01-03",
    });
    const r = await createRequest(baseInput(orphan.id, repA.id, list.id));
    expect(await backfillRequestReps()).toBe(0);
    expect((await db.requests.get(r.id))?.representativeId).toBe(repA.id);
  });

  it("seeds the prefs row when none exists", async () => {
    await seed();
    await backfillRequestReps();
    const prefs = await db.preferences.get("app");
    expect(prefs?.repSyncBackfilled).toBe(true);
    expect(prefs?.defaultCurrency).toBe(DEFAULT_PREFS.defaultCurrency);
  });
});
