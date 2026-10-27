/**
 * Per-customer document slots (AI smart filing) — scoping rules, customer-page
 * visibility, delete cascade, ZIP backup round trip and the page-filter
 * persistence helper.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

// Node test environment has no localStorage — minimal in-memory shim for the
// page-filter persistence tests.
const memStore = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
}

import { db } from "../schema";
import {
  createDocType,
  deleteDocType,
  getDocTypesForCustomer,
  scopeDocTypesToOwners,
} from "../docTypes";
import { deleteCustomer } from "../customers";
import { buildFullZipBackup, applyZipRestore, parseZipBackup } from "../../utils/zipbackup";
import { loadPageFilter, savePageFilter } from "../../utils/pageFilters";
import type { Attachment, Customer, DocType } from "../../types";

const T = Date.now();

function mkCustomer(id: string, first: string): Customer {
  return {
    id,
    firstName: first,
    lastName: "تست",
    registrationDate: "2026-01-05",
    createdAt: T,
    updatedAt: T,
  };
}

function mkAttachment(id: string, customerId: string, kind: string): Attachment {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
  return {
    id,
    customerId,
    paymentId: null,
    kind,
    name: `${id}.jpg`,
    mime: "image/jpeg",
    size: blob.size,
    blob,
    createdAt: T,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

describe("per-customer document slots", () => {
  it("creates scoped slots: global stays global, AI slots carry customerId", async () => {
    await db.customers.bulkAdd([mkCustomer("c1", "احمد"), mkCustomer("c2", "مریم")]);
    const global = await createDocType({ label: "عکس ویزه" });
    const forC1 = await createDocType({ label: "گواهی نامه", customerId: "c1" });
    expect(global.customerId).toBeUndefined();
    expect(forC1.customerId).toBe("c1");

    const c1Slots = await getDocTypesForCustomer("c1");
    const c2Slots = await getDocTypesForCustomer("c2");
    expect(c1Slots.map((d) => d.id).sort()).toEqual([global.id, forC1.id].sort());
    expect(c2Slots.map((d) => d.id)).toEqual([global.id]);
  });

  it("keeps each profile's own ordering: global first, then the customer's", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    const g1 = await createDocType({ label: "عکس پاسپورت" });
    const g2 = await createDocType({ label: "عکس روی تذکره" });
    const p1 = await createDocType({ label: "بخش اول", customerId: "c1" });
    const p2 = await createDocType({ label: "بخش دوم", customerId: "c1" });
    const slots = await getDocTypesForCustomer("c1");
    expect(slots.map((d) => d.id)).toEqual([g1.id, g2.id, p1.id, p2.id]);
  });

  it("deleting the customer removes their slots but never the global ones", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    const global = await createDocType({ label: "عکس ویزه" });
    const own = await createDocType({ label: "گواهی نامه", customerId: "c1" });
    await db.attachments.add(mkAttachment("a1", "c1", own.id));

    await deleteCustomer("c1", "احمد تست");

    expect(await db.docTypes.get(global.id)).toBeDefined();
    expect(await db.docTypes.get(own.id)).toBeUndefined();
    expect(await db.attachments.get("a1")).toBeUndefined();
  });

  it("deleting a per-customer slot from the customer page moves its files to سایر مدارک", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    const own = await createDocType({ label: "گواهی نامه", customerId: "c1" });
    await db.attachments.add(mkAttachment("a1", "c1", own.id));

    await deleteDocType(own.id, own.label);

    expect(await db.docTypes.get(own.id)).toBeUndefined();
    const moved = await db.attachments.get("a1");
    expect(moved?.kind).toBe("other");
  });

  it("survives a full ZIP backup → replace-restore with the customerId intact", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    await createDocType({ label: "عکس پاسپورت" });
    const own = await createDocType({ label: "گواهی نامه", customerId: "c1" });
    await db.attachments.add(mkAttachment("a1", "c1", own.id));

    const built = await buildFullZipBackup();
    // Wipe everything, then restore the very same bytes.
    await db.delete();
    await db.open();
    const parsed = await parseZipBackup(built.blob);
    await applyZipRestore(parsed, "replace");

    const restored = await db.docTypes.get(own.id);
    expect(restored?.customerId).toBe("c1");
    expect((await getDocTypesForCustomer("c1")).map((d) => d.id)).toContain(own.id);
    expect((await getDocTypesForCustomer("other-customer")).map((d) => d.id)).not.toContain(own.id);
    expect(await db.attachments.get("a1")).toBeDefined();
  });

  it("warns (non-fatally) when an archive carries a slot for a missing customer", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    // Slot points at a customer that is NOT part of the backup.
    await createDocType({ label: "بخش یتیم", customerId: "ghost" });
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);
    expect(parsed.warnings.some((w) => w.includes("بخش مدارک مخصوص"))).toBe(true);
  });
});

describe("page filter persistence", () => {
  it("round-trips values and falls back on corrupt storage", () => {
    expect(loadPageFilter("p", "k", "default", () => true)).toBe("default");
    savePageFilter("p", "k", "newest");
    expect(loadPageFilter("p", "k", "default", () => true)).toBe("newest");
    // A different key on the same page does not leak.
    expect(loadPageFilter("p", "other", "default", () => true)).toBe("default");
    // Invalid values (per the caller's guard) are ignored.
    savePageFilter("p", "k", "bogus");
    expect(loadPageFilter("p", "k", "default", (v) => v === "newest" || v === "oldest")).toBe("default");
    // Empty value clears the key.
    savePageFilter("p", "k", "newest");
    savePageFilter("p", "k", "");
    expect(loadPageFilter("p", "k", "default", () => true)).toBe("default");
    // Corrupt JSON never throws.
    localStorage.setItem("customer2-filter-p", "{not json");
    expect(loadPageFilter("p", "k", "default", () => true)).toBe("default");
  });
});

describe("scopeDocTypesToOwners (one-time legacy re-scope)", () => {
  /** A legacy SHARED slot exactly as older app versions stored it. */
  async function addLegacySlot(id: string, label: string): Promise<void> {
    const dt: DocType = {
      id,
      label,
      customerId: null,
      order: 50,
      createdAt: T,
      updatedAt: T,
    };
    await db.docTypes.add(dt);
  }

  it("re-scopes a legacy AI slot whose files all belong to ONE customer", async () => {
    await db.customers.bulkAdd([mkCustomer("c1", "احمد"), mkCustomer("c2", "مریم")]);
    await addLegacySlot("ai1", "کارت واکسن کرونا");
    await db.attachments.bulkAdd([
      mkAttachment("a1", "c1", "ai1"),
      mkAttachment("a2", "c1", "ai1"),
    ]);
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("ai1"))?.customerId).toBe("c1");
    // And it is now invisible on the other profile.
    expect((await getDocTypesForCustomer("c2")).some((d) => d.id === "ai1")).toBe(false);
    expect((await getDocTypesForCustomer("c1")).some((d) => d.id === "ai1")).toBe(true);
  });

  it("keeps a slot global when its files belong to SEVERAL customers", async () => {
    await db.customers.bulkAdd([mkCustomer("c1", "احمد"), mkCustomer("c2", "مریم")]);
    await addLegacySlot("ai2", "عکس شناسنامه");
    await db.attachments.bulkAdd([
      mkAttachment("a1", "c1", "ai2"),
      mkAttachment("a2", "c2", "ai2"),
    ]);
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("ai2"))?.customerId ?? null).toBeNull();
  });

  it("keeps an empty slot global (a fresh Settings slot is never stolen)", async () => {
    await addLegacySlot("user1", "عکس ویزه");
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("user1"))?.customerId ?? null).toBeNull();
  });

  it("never touches the built-in slots, even with one owner's files", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    await db.docTypes.add({
      id: "passport",
      label: "عکس پاسپورت",
      customerId: null,
      order: 0,
      createdAt: T,
      updatedAt: T,
    });
    await db.attachments.add(mkAttachment("a1", "c1", "passport"));
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("passport"))?.customerId ?? null).toBeNull();
  });

  it("runs only once (guarded by the preferences flag)", async () => {
    await db.customers.add(mkCustomer("c1", "احمد"));
    await addLegacySlot("ai3", "کارت واکسن");
    await db.attachments.add(mkAttachment("a1", "c1", "ai3"));
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("ai3"))?.customerId).toBe("c1");
    // Anything added afterwards is NOT re-scoped by a second launch.
    await addLegacySlot("user2", "عکس سند");
    await db.attachments.add(mkAttachment("a2", "c1", "user2"));
    await scopeDocTypesToOwners();
    expect((await db.docTypes.get("user2"))?.customerId ?? null).toBeNull();
    const prefs = await db.preferences.get("app");
    expect(prefs?.docOwnerScoped).toBe(true);
  });
});
