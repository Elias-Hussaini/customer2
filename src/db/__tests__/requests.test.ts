/**
 * Visa-request status engine — «رد شده» (rejected) state:
 * mutual exclusion with issued, DB toggles, status labels and backup round trip.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  createRequest,
  setRequestIssued,
  setRequestRejected,
  updateRequest,
  requestStatusFa,
} from "../requests";
import { buildFullZipBackup, applyZipRestore, parseZipBackup } from "../../utils/zipbackup";
import { requestStatusFa as statusFromTypes } from "../../types";

const baseInput = {
  customerId: "c1",
  representativeId: "r1",
  listId: "l1",
  visaType: "تستی",
  tags: [] as string[],
  registrationDate: "2026-02-10",
  issued: false,
};

beforeEach(async () => {
  await db.requests.clear();
  await db.activities.clear();
});

describe("requestStatusFa", () => {
  it("maps the three states", () => {
    expect(statusFromTypes({ issued: false })).toBe("در حال کار");
    expect(statusFromTypes({ issued: true })).toBe("صادر شده");
    expect(statusFromTypes({ issued: false, rejected: true })).toBe("رد شده");
    // issued wins when both flags are (invalidly) set — matches StatusPill logic.
    expect(statusFromTypes({ issued: true, rejected: true })).toBe("صادر شده");
    // legacy rows without the field behave as before
    expect(statusFromTypes({ issued: false, rejected: undefined })).toBe("در حال کار");
  });
});

describe("createRequest / updateRequest rejection handling", () => {
  it("persists rejected + rejectedAt", async () => {
    const r = await createRequest({
      ...baseInput,
      rejected: true,
      rejectedAt: "2026-02-20",
    });
    expect(r.rejected).toBe(true);
    expect(r.rejectedAt).toBe("2026-02-20");
    expect(r.issued).toBe(false);
  });

  it("issuing clears the rejection (mutual exclusion)", async () => {
    const r = await createRequest({ ...baseInput, rejected: true });
    const upd = await createRequest({ ...baseInput }); // separate row, sanity
    expect(upd.id).not.toBe(r.id);

    await updateRequest(r.id, { ...baseInput, issued: true, rejectedAt: null });
    const after = await db.requests.get(r.id);
    expect(after?.issued).toBe(true);
    expect(after?.rejected).toBe(false);
    expect(after?.rejectedAt).toBeNull();
  });

  it("rejected defaults to today when no date is provided", async () => {
    const r = await createRequest({ ...baseInput, rejected: true, rejectedAt: null });
    expect(r.rejectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("setRequestRejected / setRequestIssued toggles", () => {
  it("marks rejected and un-issues in one step", async () => {
    const r = await createRequest({ ...baseInput, issued: true });
    await setRequestRejected(r.id, true, "2026-03-01");
    const after = await db.requests.get(r.id);
    expect(after?.rejected).toBe(true);
    expect(after?.rejectedAt).toBe("2026-03-01");
    expect(after?.issued).toBe(false);
    expect(after?.issuedAt).toBeNull();
  });

  it("issuing after a rejection clears the rejected flag", async () => {
    const r = await createRequest({ ...baseInput, rejected: true });
    await setRequestIssued(r.id, true, "2026-03-05");
    const after = await db.requests.get(r.id);
    expect(after?.issued).toBe(true);
    expect(after?.rejected).toBe(false);
    expect(after?.rejectedAt).toBeNull();
  });

  it("logs reject / unreject activities", async () => {
    const r = await createRequest({ ...baseInput });
    await setRequestRejected(r.id, true);
    await setRequestRejected(r.id, false);
    const acts = await db.activities.orderBy("ts").reverse().toArray();
    const types = acts.map((a) => a.type);
    expect(types).toContain("reject");
    expect(types).toContain("unreject");
  });
});

describe("ZIP backup round trip keeps the rejected fields", () => {
  it("rejected + rejectedAt survive a full archive restore", async () => {
    await createRequest({ ...baseInput, rejected: true, rejectedAt: "2026-02-20" });
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);
    await applyZipRestore(parsed, "replace");

    const rows = await db.requests.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].rejected).toBe(true);
    expect(rows[0].rejectedAt).toBe("2026-02-20");
    expect(requestStatusFa(rows[0])).toBe("رد شده");
  });
});
