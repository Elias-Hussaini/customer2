/**
 * The at-rest image-compression marker (`opt`) must survive the FULL ZIP
 * round trip in both backup systems — so a restored archive never triggers
 * a pointless re-compression pass over images that are already lean.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/schema";
import type { AccDoc, AccParty } from "../../accounting/types";
import { buildFullZipBackup, parseZipBackup, applyZipRestore } from "../zipbackup";
import {
  applyAccZipRestore,
  buildFullAccZipBackup,
  parseAccZipBackup,
} from "../../accounting/zipbackup";

const T = Date.now();
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

async function wipeAll(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe("opt marker in the MAIN ZIP backup", () => {
  beforeEach(wipeAll);

  it("survives build → parse → replace-restore", async () => {
    await db.representatives.add({ id: "rep1", name: "نماینده", createdAt: T, updatedAt: T });
    await db.customers.add({
      id: "c1",
      firstName: "احمد",
      lastName: "کریمی",
      registrationDate: "2026-01-05",
      createdAt: T,
      updatedAt: T,
    });
    const webpBlob = new Blob([IMG], { type: "image/webp" });
    const jpegBlob = new Blob([IMG], { type: "image/jpeg" });
    await db.attachments.bulkAdd([
      {
        id: "att-opt",
        customerId: "c1",
        paymentId: null,
        kind: "passport",
        name: "optimized.jpg",
        mime: "image/webp",
        size: webpBlob.size,
        blob: webpBlob,
        createdAt: T,
        opt: 1700000000000,
      },
      {
        id: "att-raw",
        customerId: "c1",
        paymentId: null,
        kind: "other",
        name: "legacy.jpg",
        mime: "image/jpeg",
        size: jpegBlob.size,
        blob: jpegBlob,
        createdAt: T,
      },
    ]);

    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);

    // Metadata inside the archive carries the marker (and its absence).
    const metaOpt = parsed.backup.data.attachments?.find((a) => a.id === "att-opt");
    const metaRaw = parsed.backup.data.attachments?.find((a) => a.id === "att-raw");
    expect(metaOpt?.opt).toBe(1700000000000);
    expect(metaRaw?.opt).toBeUndefined();

    await applyZipRestore(parsed, "replace");
    const restored = await db.attachments.bulkGet(["att-opt", "att-raw"]);
    expect(restored[0]?.opt).toBe(1700000000000);
    expect(restored[1]?.opt).toBeUndefined();
    expect(restored[0]?.mime).toBe("image/webp");
  });
});

describe("opt marker in the ACCOUNTING ZIP backup", () => {
  beforeEach(wipeAll);

  it("survives build → parse → replace-restore", async () => {
    const party: AccParty = {
      id: "p1",
      code: "P-0001",
      type: "individual",
      name: "شرکت نمونه",
      phone: "",
      tags: [],
      photoDocId: null,
      active: true,
      createdAt: T,
      updatedAt: T,
    };
    const docBlob = new Blob([IMG], { type: "image/webp" });
    const doc: AccDoc = {
      id: "d1",
      partyId: "p1",
      transactionId: null,
      accountId: null,
      name: "قرارداد.webp",
      mime: "image/webp",
      size: docBlob.size,
      blob: docBlob,
      createdAt: T,
      opt: 1700000000001,
    };
    await db.accParties.add(party);
    await db.accDocs.add(doc);

    const built = await buildFullAccZipBackup();
    const parsed = await parseAccZipBackup(built.blob);
    expect(parsed.backup.data.docsMeta[0]?.opt).toBe(1700000000001);

    await applyAccZipRestore(parsed, "replace");
    const restored = await db.accDocs.get("d1");
    expect(restored?.opt).toBe(1700000000001);
    expect(restored?.mime).toBe("image/webp");
  });
});
