/**
 * ZIP full-backup engine tests — lossless round trip, encryption envelope,
 * corruption detection, version guards, atomic restore with rollback, and
 * legacy-JSON compatibility through the unified entry point.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { db } from "../../db/schema";
import type { Attachment, Customer, Representative } from "../../types";
import {
  applyRestore,
  buildBackup,
} from "../backup";
import {
  applyAnyRestore,
  applyZipRestore,
  backupFilename,
  BackupCancelledError,
  buildFullZipBackup,
  buildUnifiedPreview,
  decryptZipBlob,
  encryptZipBytes,
  parseZipBackup,
  readAnyBackupFile,
  sniffBackupFile,
  type ParsedZipBackup,
} from "../zipbackup";

const T = Date.now();

function mkRep(id: string, name: string): Representative {
  return { id, name, createdAt: T, updatedAt: T };
}

function mkCustomer(id: string, first: string, last: string): Customer {
  return {
    id,
    firstName: first,
    lastName: last,
    registrationDate: "2026-01-05",
    representativeId: "rep1",
    listId: "list1",
    createdAt: T,
    updatedAt: T,
  };
}

function mkAttachment(
  id: string,
  customerId: string | null,
  name: string,
  bytes: Uint8Array,
  mime = "image/jpeg",
  paymentId: string | null = null,
): Attachment {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return {
    id,
    customerId,
    paymentId,
    kind: "passport",
    name,
    mime,
    size: blob.size,
    blob,
    createdAt: T,
  };
}

const IMG_A = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const IMG_B = new Uint8Array(
  Array.from({ length: 512 }, (_, i) => i % 251),
);
const PDF_DOC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 99, 42, 7]);

async function seedFullDataset(): Promise<void> {
  await db.representatives.bulkAdd([
    mkRep("rep1", "علی رضایی"),
    mkRep("rep2", "سمیه کاویانی 🌟"),
  ]);
  await db.customers.bulkAdd([
    {
      ...mkCustomer("c1", "احمد", "کریمی"),
      photo: "data:image/jpeg;base64,/9j/4AAQ",
      notes: "یادداشت تست — unicode ✅",
    },
    mkCustomer("c2", "مریم", "حسینی"),
  ]);
  await db.requests.bulkAdd([
    {
      id: "r1",
      customerId: "c1",
      representativeId: "rep1",
      listId: "list1",
      visaType: "vt1",
      tags: ["tag1"],
      registrationDate: "2026-01-06",
      issued: true,
      issuedAt: "2026-02-01",
      quotedAmount: 500,
      currency: "USD",
      createdAt: T,
      updatedAt: T,
    },
  ]);
  await db.lists.bulkAdd([{ id: "list1", name: "لیست تابستان", createdAt: T, updatedAt: T }]);
  await db.payments.bulkAdd([
    {
      id: "p1",
      representativeId: "rep1",
      requestId: "r1",
      amount: 150,
      currency: "USD",
      date: "2026-01-10",
      createdAt: T,
      updatedAt: T,
    },
  ]);
  await db.tags.bulkAdd([
    { id: "tag1", name: "فوری", color: "#ef4444", isUrgent: true, createdAt: T, updatedAt: T },
  ]);
  await db.visaTypes.bulkAdd([{ id: "vt1", name: "ویزای داخله", createdAt: T, updatedAt: T }]);
  await db.docTypes.bulkAdd([
    { id: "passport", label: "پاسپورت", order: 1, createdAt: T, updatedAt: T },
  ]);
  await db.activities.bulkAdd([
    { id: "a1", ts: T, type: "create", entity: "customer", entityId: "c1", title: "ثبت شد" },
    { id: "a2", ts: T + 1, type: "update", entity: "request", entityId: "r1", title: "تغییر" },
  ]);
  await db.preferences.put({
    id: "app",
    defaultCurrency: "USD",
    passportDateCalendar: "gregorian",
    rememberLastSelections: true,
    updatedAt: T,
  });
  await db.attachments.bulkAdd([
    // Two attachments with the SAME filename but different ids must both survive.
    mkAttachment("att1", "c1", "scan.jpg", IMG_A),
    mkAttachment("att2", "c1", "scan.jpg", IMG_B),
    // Persian + emoji filename, PDF content, and a payment receipt.
    mkAttachment("att3", "c2", "تذکره-پشت ✅.pdf", PDF_DOC, "application/pdf"),
    mkAttachment("att4", null, "رسید.jpg", IMG_B, "image/jpeg", "p1"),
  ]);
  await db.aiWorkers.bulkAdd([
    {
      id: "w1",
      label: "اکانت ۱",
      url: "https://worker.example",
      key: "secret-key-123",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      enabled: true,
      priority: 1,
      createdAt: T,
      updatedAt: T,
    },
  ]);
}

async function seedOtherDataset(): Promise<void> {
  await db.representatives.bulkAdd([mkRep("repX", "نماینده دیگر")]);
  await db.customers.bulkAdd([mkCustomer("cX", "زبهر", "دشتی")]);
  await db.attachments.bulkAdd([mkAttachment("attX", "cX", "other.jpg", IMG_A)]);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/* ------------------------------- round trip ------------------------------- */

describe("ZIP full backup round trip", () => {
  it("preserves every record, key, filename, mime type and binary byte", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    expect(built.encrypted).toBe(false);
    expect(built.filename).toMatch(/^emanagement-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
    expect(built.counts.attachments).toBe(4);
    // Plain build never carries AI keys.
    const rawZip = new JSZip();
    await rawZip.loadAsync(await built.blob.arrayBuffer());
    const dbJson = await rawZip.file("data/database.json")!.async("string");
    expect(dbJson).not.toContain("secret-key-123");

    const parsed = await parseZipBackup(built.blob);
    expect(parsed.manifest.counts.customers).toBe(2);
    expect(parsed.manifest.counts.attachments).toBe(4);
    expect(parsed.assets.size).toBe(4);

    // Records deep-equal.
    expect(parsed.backup.data.representatives.map((r) => r.id)).toEqual(["rep1", "rep2"]);
    expect(parsed.backup.data.customers[0].notes).toBe("یادداشت تست — unicode ✅");
    expect(parsed.backup.data.customers[0].photo).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(parsed.backup.data.requests[0].issuedAt).toBe("2026-02-01");
    expect(parsed.backup.data.preferences?.defaultCurrency).toBe("USD");
    expect(parsed.backup.data.activities).toHaveLength(2);
    expect(parsed.backup.data.aiWorkers).toBeUndefined();

    // Attachment metadata + bytes exact.
    const meta1 = parsed.backup.data.attachments!.find((a) => a.id === "att1")!;
    const meta3 = parsed.backup.data.attachments!.find((a) => a.id === "att3")!;
    expect(meta1.name).toBe("scan.jpg");
    expect(meta3.name).toBe("تذکره-پشت ✅.pdf");
    expect(meta3.mime).toBe("application/pdf");
    expect(meta3.customerId).toBe("c2");
    const meta4 = parsed.backup.data.attachments!.find((a) => a.id === "att4")!;
    expect(meta4.paymentId).toBe("p1");
    expect(meta4.customerId).toBeNull();

    const bytes1 = new Uint8Array(await parsed.assets.get("att1")!.arrayBuffer());
    const bytes3 = new Uint8Array(await parsed.assets.get("att3")!.arrayBuffer());
    expect(Array.from(bytes1)).toEqual(Array.from(IMG_A));
    expect(Array.from(bytes3)).toEqual(Array.from(PDF_DOC));
  });

  it("restores a replace round trip byte-for-byte into a different database state", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);

    // Simulate a different device: wipe and seed unrelated data.
    await db.transaction(
      "rw",
      [db.representatives, db.customers, db.requests, db.lists, db.payments, db.tags, db.visaTypes, db.customFields, db.docTypes, db.activities, db.preferences, db.attachments],
      async () => {
        for (const t of [db.representatives, db.customers, db.requests, db.lists, db.payments, db.tags, db.visaTypes, db.customFields, db.docTypes, db.activities, db.preferences, db.attachments]) {
          await t.clear();
        }
      },
    );
    await seedOtherDataset();

    const result = await applyZipRestore(parsed, "replace");
    expect(result.attachments).toBe(4);
    expect(result.inserted).toBeGreaterThan(0);

    // Everything from the backup is back, the foreign record is gone.
    const c1 = await db.customers.get("c1");
    expect(c1?.lastName).toBe("کریمی");
    expect(await db.customers.get("cX")).toBeUndefined();
    expect(await db.representatives.get("repX")).toBeUndefined();

    const atts = await db.attachments.toArray();
    expect(atts).toHaveLength(4);
    const att3 = atts.find((a) => a.id === "att3")!;
    expect(att3.name).toBe("تذکره-پشت ✅.pdf");
    expect(att3.mime).toBe("application/pdf");
    expect(Array.from(new Uint8Array(await att3.blob.arrayBuffer()))).toEqual(
      Array.from(PDF_DOC),
    );
    const att4 = atts.find((a) => a.id === "att4")!;
    expect(att4.paymentId).toBe("p1");
    // Two same-named files both present and distinct.
    const scans = atts.filter((a) => a.name === "scan.jpg");
    expect(scans).toHaveLength(2);
    expect(scans[0].id).not.toBe(scans[1].id);
  });

  it("merge keeps local-only records and upserts overlapping ids (backup wins)", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);

    await seedOtherDataset();
    // Overlapping record that the backup should overwrite.
    await db.customers.put({
      ...mkCustomer("c1", "نام-قدیمی", "خانواده-قدیمی"),
      notes: "local edit",
    });

    const result = await applyZipRestore(parsed, "merge");
    expect(await db.customers.get("c1")).toMatchObject({ firstName: "احمد", lastName: "کریمی" });
    // Local-only record survives.
    expect(await db.customers.get("cX")).toBeDefined();
    expect(result.attachments).toBe(4);
    expect(await db.attachments.count()).toBe(5); // 4 restored + local attX
  });

  it("handles an empty database without errors", async () => {
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);
    expect(parsed.manifest.counts.customers).toBe(0);
    expect(parsed.assets.size).toBe(0);
    await seedOtherDataset();
    await applyZipRestore(parsed, "replace");
    expect(await db.customers.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });
});

/* ------------------------------ encryption ------------------------------- */

describe("encrypted ZIP envelope", () => {
  it("round-trips with a password and includes the AI worker config", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup({ password: "ramz-test" });
    expect(built.encrypted).toBe(true);
    expect(built.filename.endsWith(".zip.enc")).toBe(true);
    expect(await sniffBackupFile(built.blob)).toBe("enc-zip");

    const zip = await decryptZipBlob(built.blob, "ramz-test");
    const parsed = await parseZipBackup(zip);
    expect(parsed.manifest.encrypted).toBe(true);
    expect(parsed.manifest.aiConfigIncluded).toBe(true);
    expect(parsed.backup.data.aiWorkers?.[0]?.key).toBe("secret-key-123");

    // Restoring an encrypted backup also restores the AI config.
    await db.aiWorkers.clear();
    await applyZipRestore(parsed, "merge");
    expect((await db.aiWorkers.toArray())[0]?.key).toBe("secret-key-123");
  });

  it("rejects a wrong password with a Persian error", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup({ password: "ramz-test" });
    await expect(decryptZipBlob(built.blob, "wrong")).rejects.toThrow(/رمز عبور نادرست/);
  });

  it("re-encrypts bytes deterministically in structure (magic + header)", async () => {
    const enc = await encryptZipBytes(new Uint8Array([1, 2, 3, 4, 5]), "p");
    const bytes = new Uint8Array(await enc.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("EMENCZIP");
    const headerLen = new DataView(bytes.buffer).getUint32(8, false);
    const header = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + headerLen)));
    expect(header.kdf).toBe("PBKDF2-SHA256");
    expect(header.inner).toBe("emanagement-zip-backup");
  });
});

/* --------------------------- corruption & guards -------------------------- */

/** Rebuild a zip from an existing one with a mutator applied. */
async function mutateZip(
  blob: Blob,
  mutate: (zip: JSZip, raw: JSZip) => Promise<void> | void,
): Promise<Blob> {
  const raw = new JSZip();
  await raw.loadAsync(new Uint8Array(await blob.arrayBuffer()), { checkCRC32: true });
  const out = new JSZip();
  await mutate(out, raw);
  return new Blob([await out.generateAsync({ type: "arraybuffer" })], {
    type: "application/zip",
  });
}

async function copyEntry(from: JSZip, to: JSZip, name: string, transform?: (data: string) => string) {
  const entry = from.file(name);
  if (!entry) throw new Error(`missing ${name}`);
  let content: string | Uint8Array = await entry.async("string");
  if (name.startsWith("assets/") && typeof content === "string") {
    content = new Uint8Array(await entry.async("uint8array"));
  }
  if (transform && typeof content === "string") content = transform(content);
  to.file(name, content);
}

describe("corruption and version guards", () => {
  it("detects a tampered attachment (checksum mismatch)", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const tampered = await mutateZip(built.blob, async (out, raw) => {
      const bytes = new Uint8Array(await raw.file("assets/attachments/att1")!.async("uint8array"));
      bytes[3] ^= 0xff; // flip a byte, CRC recomputed but checksums.json still old
      out.file("manifest.json", await raw.file("manifest.json")!.async("string"));
      out.file("data/database.json", await raw.file("data/database.json")!.async("string"));
      out.file("integrity/checksums.json", await raw.file("integrity/checksums.json")!.async("string"));
      out.file("assets/attachments/att1", bytes);
      for (const id of ["att2", "att3", "att4"]) {
        await copyEntry(raw, out, `assets/attachments/${id}`);
      }
    });
    await expect(parseZipBackup(tampered)).rejects.toThrow(/چک‌سام/);
  });

  it("detects a tampered database.json", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const tampered = await mutateZip(built.blob, async (out, raw) => {
      await copyEntry(raw, out, "manifest.json");
      await copyEntry(raw, out, "data/database.json", (s) =>
        s.replace("احمد", "هکر"),
      );
      await copyEntry(raw, out, "integrity/checksums.json");
      for (const id of ["att1", "att2", "att3", "att4"]) {
        await copyEntry(raw, out, `assets/attachments/${id}`);
      }
    });
    await expect(parseZipBackup(tampered)).rejects.toThrow(/چک‌سام/);
  });

  it("rejects an unsupported future version", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const future = await mutateZip(built.blob, async (out, raw) => {
      await copyEntry(raw, out, "manifest.json", (s) =>
        s.replace('"version": 1', '"version": 99'),
      );
      await copyEntry(raw, out, "data/database.json");
      await copyEntry(raw, out, "integrity/checksums.json");
      for (const id of ["att1", "att2", "att3", "att4"]) {
        await copyEntry(raw, out, `assets/attachments/${id}`);
      }
    });
    await expect(parseZipBackup(future)).rejects.toThrow(/نسخه جدیدتری/);
  });

  it("rejects an archive with a missing asset file", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const incomplete = await mutateZip(built.blob, async (out, raw) => {
      await copyEntry(raw, out, "manifest.json");
      await copyEntry(raw, out, "data/database.json");
      await copyEntry(raw, out, "integrity/checksums.json");
      for (const id of ["att1", "att2", "att3"]) {
        await copyEntry(raw, out, `assets/attachments/${id}`);
      } // att4 omitted
    });
    await expect(parseZipBackup(incomplete)).rejects.toThrow(/ناقص/);
  });

  it("rejects non-backup and random files via the unified reader", async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], {
      type: "application/octet-stream",
    });
    await expect(readAnyBackupFile(junk)).rejects.toThrow(/معتبر/);
    const dummy = new JSZip();
    dummy.file("hello.txt", "not a backup");
    const plainZip = new Blob([await dummy.generateAsync({ type: "arraybuffer" })], {
      type: "application/zip",
    });
    await expect(readAnyBackupFile(plainZip)).rejects.toThrow(/manifest/);
  });

  it("ignores unknown extra files with a warning", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const extra = await mutateZip(built.blob, async (out, raw) => {
      out.file("evil.txt", "hello");
      for (const name of [
        "manifest.json",
        "data/database.json",
        "integrity/checksums.json",
        "assets/attachments/att1",
        "assets/attachments/att2",
        "assets/attachments/att3",
        "assets/attachments/att4",
      ]) {
        await copyEntry(raw, out, name);
      }
    });
    const parsed = await parseZipBackup(extra);
    expect(parsed.warnings.some((w) => w.includes("ناشناخته"))).toBe(true);
    expect(parsed.assets.size).toBe(4);
  });
});

/* ------------------------------ atomicity -------------------------------- */

describe("atomic restore", () => {
  it("leaves the database untouched when a write fails mid-transaction", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);
    // Drop the blob for one attachment → apply must fail inside the tx.
    parsed.assets.delete("att2");

    await seedOtherDataset(); // so merge has something at stake too
    const before = {
      customers: await db.customers.count(),
      attachments: await db.attachments.count(),
      reps: await db.representatives.count(),
    };
    await expect(applyZipRestore(parsed, "merge")).rejects.toThrow(/پیوست/);
    // Dexie rolled the whole transaction back — nothing changed.
    expect(await db.customers.count()).toBe(before.customers);
    expect(await db.attachments.count()).toBe(before.attachments);
    expect(await db.representatives.count()).toBe(before.reps);
    expect(await db.customers.get("cX")).toBeDefined();
  });
});

/* --------------------------- cancellation --------------------------------- */

describe("cancellation", () => {
  it("can be cancelled between phases", async () => {
    await seedFullDataset();
    await expect(
      buildFullZipBackup({ shouldCancel: () => true }),
    ).rejects.toBeInstanceOf(BackupCancelledError);
  });
});

/* -------------------------- legacy JSON support --------------------------- */

describe("legacy JSON compatibility through the unified entry", () => {
  it("reads, previews and restores a legacy JSON backup (with the no-images warning)", async () => {
    await seedFullDataset();
    const legacy = await buildBackup();
    const file = new File([JSON.stringify(legacy)], "old.json", {
      type: "application/json",
    });
    expect(await sniffBackupFile(file)).toBe("json");

    const any = await readAnyBackupFile(file);
    expect(any.kind).toBe("legacy");
    const preview = await buildUnifiedPreview(any);
    expect(preview.attachments).toBeNull();
    expect(preview.warnings.some((w) => w.includes("تصاویر"))).toBe(true);
    expect(preview.counts.customers).toBe(2);

    await seedOtherDataset();
    const result = await applyAnyRestore(any, "merge");
    expect(result.attachments).toBe(0);
    expect(await db.customers.count()).toBe(3); // 2 restored + cX
  });

  it("refuses a database.json that was extracted from a ZIP archive", async () => {
    await seedFullDataset();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);
    await expect(applyRestore(parsed.backup, "merge")).rejects.toThrow(/ZIP/);
  });

  it("reads an encrypted legacy JSON backup after decryption", async () => {
    await seedFullDataset();
    const { encryptBackup } = await import("../backup");
    const encrypted = await encryptBackup(await buildBackup(), "pass123");
    const file = new File([JSON.stringify(encrypted)], "old-enc.json");
    await expect(readAnyBackupFile(file)).rejects.toThrow("ENCRYPTED");
    const any = await readAnyBackupFile(file, "pass123");
    expect(any.kind).toBe("legacy");
  });
});

/* --------------------------- helpers & naming ----------------------------- */

describe("filename & stamp helpers", () => {
  it("builds a safe local-time filename", () => {
    const d = new Date(2026, 9, 27, 14, 30, 5);
    expect(backupFilename(false, d)).toBe("emanagement-backup-2026-10-27-14-30-05.zip");
    expect(backupFilename(true, d)).toBe("emanagement-backup-2026-10-27-14-30-05.zip.enc");
  });
});

/* -------------------- parsed-shape sanity (regression guard) -------------- */

describe("manifest shape", () => {
  it("carries schema version, app version and generator", async () => {
    await seedFullDataset();
    const parsed: ParsedZipBackup = await parseZipBackup(
      (await buildFullZipBackup()).blob,
    );
    expect(parsed.manifest.schemaVersion).toBe(db.verno);
    expect(parsed.manifest.generator).toBe("E-managment");
    expect(parsed.manifest.appVersion).toBeTruthy();
    expect(parsed.manifest.attachments.count).toBe(4);
    expect(parsed.manifest.attachments.bytes).toBe(
      IMG_A.byteLength + IMG_B.byteLength + PDF_DOC.byteLength + IMG_B.byteLength,
    );
  });
});
