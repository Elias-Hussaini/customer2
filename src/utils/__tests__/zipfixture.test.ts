/**
 * Fixture generator for browser QA — runs the REAL zipbackup engine against a
 * seeded fake database and writes plain + encrypted backup archives that the
 * running app can then restore through its UI. Also doubles as an end-to-end
 * engine smoke test (build → parse → restore → verify).
 *
 * Output: /home/z/my-project/qa/fixture/backup-fixture.zip (+ .enc)
 */

import "fake-indexeddb/auto";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "../../db/schema";
import type { Attachment, Customer, Representative } from "../../types";
import {
  applyZipRestore,
  buildFullZipBackup,
  parseZipBackup,
} from "../zipbackup";

const OUT_DIR = "/home/z/my-project/qa/fixture";
const T = 1730000000000;

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3]);

async function seedFixture(): Promise<void> {
  const rep: Representative = { id: "rep-fx", name: "نماینده تست بکاپ", createdAt: T, updatedAt: T };
  const c1: Customer = {
    id: "c-fx1",
    firstName: "زیب‌النسا",
    lastName: "بی‌نظیر",
    passportNo: "FX1234567",
    representativeId: "rep-fx",
    listId: "list-fx",
    registrationDate: "2026-02-10",
    notes: "مشتری تست بازیابی ZIP",
    createdAt: T,
    updatedAt: T,
  };
  const c2: Customer = {
    id: "c-fx2",
    firstName: "غلام‌رسول",
    lastName: "فرهنگی",
    representativeId: "rep-fx",
    listId: "list-fx",
    registrationDate: "2026-02-11",
    createdAt: T,
    updatedAt: T,
  };
  await db.representatives.add(rep);
  await db.customers.bulkAdd([c1, c2]);
  await db.lists.add({ id: "list-fx", name: "لیست تست بکاپ", createdAt: T, updatedAt: T });
  await db.requests.add({
    id: "r-fx1",
    customerId: "c-fx1",
    representativeId: "rep-fx",
    listId: "list-fx",
    visaType: "vt-fx",
    tags: [],
    registrationDate: "2026-02-12",
    issued: false,
    quotedAmount: 700,
    currency: "USD",
    createdAt: T,
    updatedAt: T,
  });
  await db.visaTypes.add({ id: "vt-fx", name: "ویزای تست", createdAt: T, updatedAt: T });
  const att = (id: string, customerId: string, name: string, bytes: Uint8Array, mime: string): Attachment => ({
    id,
    customerId,
    paymentId: null,
    kind: "passport",
    name,
    mime,
    size: bytes.byteLength,
    blob: new Blob([bytes as unknown as BlobPart], { type: mime }),
    createdAt: T,
  });
  await db.attachments.bulkAdd([
    att("att-fx1", "c-fx1", "پاسپورت-زیب‌النسا.jpg", JPEG, "image/jpeg"),
    att("att-fx2", "c-fx2", "تذکره.pdf", PDF, "application/pdf"),
  ]);
}

describe("fixture generation + engine smoke (browser QA artifacts)", () => {
  it("builds, verifies and restores a full backup, then writes the fixtures", async () => {
    await db.delete();
    await db.open();
    await seedFixture();

    const plain = await buildFullZipBackup();
    const enc = await buildFullZipBackup({ password: "123456" });

    // Engine smoke: parse + full replace restore must succeed and be verified.
    const parsed = await parseZipBackup(plain.blob);
    const result = await applyZipRestore(parsed, "replace");
    expect(result.attachments).toBe(2);
    expect((await db.customers.get("c-fx1"))?.firstName).toBe("زیب‌النسا");
    const restored = await db.attachments.get("att-fx2");
    expect(restored?.mime).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await restored!.blob.arrayBuffer()))).toEqual(
      Array.from(PDF),
    );

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/backup-fixture.zip`, Buffer.from(await plain.blob.arrayBuffer()));
    writeFileSync(`${OUT_DIR}/backup-fixture-enc.zip.enc`, Buffer.from(await enc.blob.arrayBuffer()));
    console.log(`[fixture] wrote ${OUT_DIR}/backup-fixture.zip (${plain.blob.size} bytes)`);
    console.log(`[fixture] wrote ${OUT_DIR}/backup-fixture-enc.zip.enc (${enc.blob.size} bytes)`);
  });
});
