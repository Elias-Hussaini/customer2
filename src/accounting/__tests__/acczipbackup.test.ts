/**
 * Accounting ZIP full-backup engine tests — lossless round trip (including
 * document FILES, reversal links, exchange legs, settlement arrays, unicode
 * filenames), encryption envelope, corruption detection, version guards,
 * cross-backup confusion guards, atomic restore with rollback, and legacy
 * JSON compatibility through the unified entry point.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { db } from "../../db/schema";
import type {
  AccBackupFile,
  AccDoc,
  AccParty,
  AccSettings,
  FinAccount,
  FinTransaction,
  OutstandingItem,
} from "../types";
import { applyAccBackup, buildAccBackup, ACC_BACKUP_FORMAT } from "../backup";
import {
  applyAccZipRestore,
  applyAnyAccRestore,
  accBackupFilename,
  buildAccUnifiedPreview,
  buildFullAccZipBackup,
  createAccSafetyZipBackup,
  getAccStorageStats,
  parseAccZipBackup,
  readAnyAccBackupFile,
  ACC_ZIP_BACKUP_FORMAT,
  type ParsedAccZipBackup,
} from "../zipbackup";
import {
  BackupCancelledError,
  buildFullZipBackup,
  decryptZipBlob,
  parseZipBackup,
} from "../../utils/zipbackup";
import type { Representative } from "../../types";

const T = Date.now();

const IMG_A = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const PDF_DOC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 99, 42, 7]);
const BIG_PNG = new Uint8Array(Array.from({ length: 2048 }, (_, i) => (i * 7) % 256));

function mkParty(id: string, name: string, photoDocId?: string): AccParty {
  return {
    id,
    code: `P-${id.slice(-4)}`,
    type: "individual",
    name,
    phone: "0790123456",
    tags: ["vip"],
    photoDocId: photoDocId ?? null,
    active: true,
    createdAt: T,
    updatedAt: T,
  };
}

function mkAccount(id: string, name: string, currency: "IRT" | "USD"): FinAccount {
  return { id, name, type: "bank", currency, active: true, createdAt: T, updatedAt: T };
}

function mkTx(p: Partial<FinTransaction> & { id: string }): FinTransaction {
  return {
    number: `TR-1404-${p.id.slice(-4)}`,
    type: "receipt",
    amount: 1_000_000,
    currency: "IRT",
    date: "2026-01-15",
    affectsBalance: true,
    status: "final",
    createdAt: T,
    updatedAt: T,
    ...p,
  } as FinTransaction;
}

function mkOutstanding(p: Partial<OutstandingItem> & { id: string; partyId: string }): OutstandingItem {
  return {
    kind: "receivable",
    amount: 2_500_000,
    currency: "IRT",
    status: "partial",
    settlements: [],
    createdAt: T,
    updatedAt: T,
    ...p,
  } as OutstandingItem;
}

function mkDoc(id: string, name: string, bytes: Uint8Array, mime = "image/jpeg", links: Partial<AccDoc> = {}): AccDoc {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return {
    id,
    name,
    mime,
    size: blob.size,
    blob,
    createdAt: T,
    ...links,
  };
}

/** A rich, fully-linked accounting dataset exercising every relationship. */
async function seedFullDataset(): Promise<void> {
  const settings: AccSettings = {
    id: "acc",
    txCounters: { "1404": 7 },
    partyCounter: 1,
    defaultCurrency: "IRT",
    txPrefix: "TR",
    categories: ["خدمات", "ویزا", "سفارشی"],
    updatedAt: T,
  };

  const photoDoc = mkDoc("doc-photo", "عکس-پروفایل-شرکت.png", BIG_PNG, "image/png");
  const party = mkParty("p1", "شرکت سفیر سفر 🧳", photoDoc.id);
  party.type = "company";
  party.regNumber = "۴۲۱۲";

  const accounts = [
    mkAccount("acc-cash", "صندوق نقدی", "IRT"),
    mkAccount("acc-bank", "بانک افغانستان — دلار", "USD"),
  ];

  const txs: FinTransaction[] = [
    mkTx({
      id: "tx1",
      type: "opening",
      destAccountId: "acc-cash",
      amount: 50_000_000,
      number: "TR-1404-0001",
    }),
    mkTx({
      id: "tx2",
      type: "receipt",
      partyId: "p1",
      destAccountId: "acc-cash",
      amount: 5_000_000,
      description: "دریافت از شرکت سفیر",
      number: "TR-1404-0002",
    }),
    mkTx({
      id: "tx3",
      type: "exchange",
      sourceAccountId: "acc-bank",
      destAccountId: "acc-cash",
      amount: 500,
      currency: "USD",
      destAmount: 50_000_000,
      destCurrency: "IRT",
      exchangeRate: 100_000,
      number: "TR-1404-0003",
    }),
    mkTx({
      id: "tx4",
      type: "payment",
      partyId: "p1",
      sourceAccountId: "acc-cash",
      amount: 1_200_000,
      status: "reversed",
      reversalOf: null,
      reason: "اشتباه در مبلغ",
      number: "TR-1404-0004",
    }),
    mkTx({
      id: "tx5",
      type: "adjustment",
      destAccountId: "acc-cash",
      amount: 1,
      affectsBalance: false,
      status: "cancelled",
      reversedBy: "tx4",
      settlementOf: "out1",
      number: "TR-1404-0005",
    }),
  ];

  const outstanding = [
    mkOutstanding({
      id: "out1",
      partyId: "p1",
      dueDate: "2026-03-01",
      settlements: [
        { id: "st1", transactionId: "tx5", amount: 500_000, date: "2026-02-10", note: "قسط اول" },
      ],
    }),
  ];

  const docs = [
    photoDoc,
    mkDoc("doc-inv", "فاکتور شماره ۵.xlsx", IMG_A, "image/jpeg", { partyId: "p1", category: "فاکتور", notes: "رسید خرید" }),
    mkDoc("doc-bank", "سند-بانکی.pdf", PDF_DOC, "application/pdf", { transactionId: "tx3", accountId: "acc-bank" }),
    mkDoc("doc-free", "emoji-📎-name.jpg", BIG_PNG, "image/png", {}),
  ];

  await db.transaction(
    "rw",
    [db.accParties, db.accAccounts, db.accTransactions, db.accOutstanding, db.accDocs, db.accMeta],
    async () => {
      await db.accParties.put(party);
      await db.accAccounts.bulkPut(accounts);
      await db.accTransactions.bulkPut(txs);
      await db.accOutstanding.bulkPut(outstanding);
      await db.accDocs.bulkPut(docs);
      await db.accMeta.put(settings);
    },
  );
}

async function expectFullDatasetIntact(): Promise<void> {
  const party = await db.accParties.get("p1");
  expect(party?.name).toBe("شرکت سفیر سفر 🧳");
  expect(party?.photoDocId).toBe("doc-photo");
  expect(party?.regNumber).toBe("۴۲۱۲");

  expect(await db.accAccounts.count()).toBe(2);
  const txs = await db.accTransactions.toArray();
  expect(txs.length).toBe(5);
  const tx3 = txs.find((t) => t.id === "tx3");
  expect(tx3?.destAmount).toBe(50_000_000);
  expect(tx3?.exchangeRate).toBe(100_000);
  expect(tx3?.destCurrency).toBe("IRT");
  const tx4 = txs.find((t) => t.id === "tx4");
  expect(tx4?.status).toBe("reversed");
  const tx5 = txs.find((t) => t.id === "tx5");
  expect(tx5?.settlementOf).toBe("out1");

  const out = await db.accOutstanding.get("out1");
  expect(out?.settlements.length).toBe(1);
  expect(out?.settlements[0].note).toBe("قسط اول");

  // Document bytes must be byte-exact with the right MIME types.
  const photo = await db.accDocs.get("doc-photo");
  expect(photo?.mime).toBe("image/png");
  expect(new Uint8Array(await photo!.blob.arrayBuffer())).toEqual(BIG_PNG);
  const inv = await db.accDocs.get("doc-inv");
  expect(inv?.name).toBe("فاکتور شماره ۵.xlsx");
  expect(inv?.partyId).toBe("p1");
  expect(new Uint8Array(await inv!.blob.arrayBuffer())).toEqual(IMG_A);
  const bankDoc = await db.accDocs.get("doc-bank");
  expect(new Uint8Array(await bankDoc!.blob.arrayBuffer())).toEqual(PDF_DOC);
  const free = await db.accDocs.get("doc-free");
  expect(free?.name).toBe("emoji-📎-name.jpg");

  const settings = await db.accMeta.get("acc");
  expect(settings?.txCounters["1404"]).toBe(7);
  expect(settings?.categories).toContain("سفارشی");
}

async function wipeAcc(): Promise<void> {
  await db.transaction(
    "rw",
    [db.accParties, db.accAccounts, db.accTransactions, db.accOutstanding, db.accDocs, db.accMeta],
    async () => {
      await Promise.all([
        db.accParties.clear(),
        db.accAccounts.clear(),
        db.accTransactions.clear(),
        db.accOutstanding.clear(),
        db.accDocs.clear(),
        db.accMeta.clear(),
      ]);
    },
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("buildFullAccZipBackup", () => {
  it("packs manifest + database + assets + checksums and names the file correctly", async () => {
    await seedFullDataset();
    const built = await buildFullAccZipBackup();
    expect(built.encrypted).toBe(false);
    expect(built.filename).toMatch(/^emanagement-acc-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
    expect(built.filename).toBe(accBackupFilename(false));
    expect(built.counts).toEqual({
      parties: 1,
      accounts: 2,
      transactions: 5,
      outstanding: 1,
      docs: 4,
    });

    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toEqual(
      [
        "assets/docs/doc-bank",
        "assets/docs/doc-free",
        "assets/docs/doc-inv",
        "assets/docs/doc-photo",
        "data/database.json",
        "integrity/checksums.json",
        "manifest.json",
      ].sort(),
    );
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.format).toBe(ACC_ZIP_BACKUP_FORMAT);
    expect(manifest.docs).toEqual({ count: 4, bytes: 2 * BIG_PNG.length + IMG_A.length + PDF_DOC.length });
    const dbJson = JSON.parse(await zip.file("data/database.json")!.async("string"));
    expect(dbJson.format).toBe(ACC_BACKUP_FORMAT);
    expect(dbJson.data.docsMeta.length).toBe(4);
  });

  it("supports cancellation between phases", async () => {
    await seedFullDataset();
    await expect(
      buildFullAccZipBackup({ shouldCancel: () => true }),
    ).rejects.toBeInstanceOf(BackupCancelledError);
  });

  it("produces zero-byte-docs archives for an empty module", async () => {
    const built = await buildFullAccZipBackup();
    expect(built.counts).toEqual({
      parties: 0,
      accounts: 0,
      transactions: 0,
      outstanding: 0,
      docs: 0,
    });
    const parsed = await parseAccZipBackup(built.blob);
    expect(parsed.manifest.docs.count).toBe(0);
    expect(parsed.assets.size).toBe(0);
  });
});

describe("round trip (replace restore)", () => {
  it("restores every record, link and byte exactly", async () => {
    await seedFullDataset();
    const built = await buildFullAccZipBackup();
    const parsed = await parseAccZipBackup(built.blob);
    expect(parsed.warnings).toEqual([]);

    await wipeAcc();
    expect(await db.accParties.count()).toBe(0);
    expect(await db.accDocs.count()).toBe(0);

    const result = await applyAccZipRestore(parsed, "replace");
    expect(result).toEqual({ inserted: 9, updated: 0, docs: 4 });
    await expectFullDatasetIntact();
  });

  it("merge mode updates matching ids and preserves device-only rows", async () => {
    await seedFullDataset();
    const built = await buildFullZipSafe(); // acc ZIP
    await db.accParties.put(mkParty("p-local", "فروشگاه محلی"));
    const parsed = await parseAccZipBackup(built.blob);
    const result = await applyAccZipRestore(parsed, "merge");
    // 1 party, 2 accounts, 5 txs, 1 outstanding → all already exist → updated
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(9);
    expect(await db.accParties.get("p-local")).toBeDefined();
    await expectFullDatasetIntact();
  });

  it("replace mode wipes device-only rows and files first", async () => {
    await seedFullDataset();
    const built = await buildFullZipSafe();
    await db.accParties.put(mkParty("p-local", "فروشگاه محلی"));
    await db.accDocs.put(mkDoc("doc-local", "local.jpg", IMG_A));
    const parsed = await parseAccZipBackup(built.blob);
    await applyAccZipRestore(parsed, "replace");
    expect(await db.accParties.get("p-local")).toBeUndefined();
    expect(await db.accDocs.get("doc-local")).toBeUndefined();
    expect(await db.accDocs.count()).toBe(4);
  });
});

async function buildFullZipSafe() {
  return buildFullAccZipBackup();
}

describe("validation", () => {
  async function tamper(
    mutate: (zip: InstanceType<typeof JSZip>) => Promise<void>,
  ): Promise<Blob> {
    await seedFullDataset();
    const built = await buildFullAccZipBackup();
    const zip = await JSZip.loadAsync(await built.blob.arrayBuffer());
    await mutate(zip);
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    return new Blob([buf], { type: "application/zip" });
  }

  it("rejects a tampered asset (checksum mismatch)", async () => {
    const blob = await tamper(async (zip) => {
      zip.file("assets/docs/doc-inv", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/چک‌سام/);
  });

  it("rejects a tampered database.json (checksum mismatch)", async () => {
    const blob = await tamper(async (zip) => {
      const payload = JSON.parse(await zip.file("data/database.json")!.async("string"));
      payload.data.parties[0].name = "مخرب";
      zip.file("data/database.json", JSON.stringify(payload));
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/چک‌سام/);
  });

  it("rejects an archive missing one asset file", async () => {
    const blob = await tamper(async (zip) => {
      zip.remove("assets/docs/doc-bank");
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/ناقص/);
  });

  it("rejects a future manifest version", async () => {
    const blob = await tamper(async (zip) => {
      const m = JSON.parse(await zip.file("manifest.json")!.async("string"));
      m.version = 99;
      zip.file("manifest.json", JSON.stringify(m));
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/به‌روزرسانی/);
  });

  it("rejects duplicate ids inside the archive", async () => {
    const blob = await tamper(async (zip) => {
      const m = JSON.parse(await zip.file("manifest.json")!.async("string"));
      m.counts.parties = 2; // keep the count check happy so the dup check fires
      zip.file("manifest.json", JSON.stringify(m));
      const payload = JSON.parse(await zip.file("data/database.json")!.async("string"));
      payload.data.parties.push({ ...payload.data.parties[0] });
      // Recompute checksums so only the duplicate check fires.
      const dbJson = JSON.stringify(payload);
      zip.file("data/database.json", dbJson);
      const sums = JSON.parse(await zip.file("integrity/checksums.json")!.async("string"));
      const enc = new TextEncoder();
      const digest = await crypto.subtle.digest("SHA-256", enc.encode(dbJson));
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      sums.files["data/database.json"] = hex;
      zip.file("integrity/checksums.json", JSON.stringify(sums));
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/تکراری/);
  });

  it("reports dangling references as warnings, not errors", async () => {
    const blob = await tamper(async (zip) => {
      const payload = JSON.parse(await zip.file("data/database.json")!.async("string"));
      payload.data.docsMeta[1].partyId = "p-ghost";
      const dbJson = JSON.stringify(payload);
      zip.file("data/database.json", dbJson);
      const sums = JSON.parse(await zip.file("integrity/checksums.json")!.async("string"));
      const enc = new TextEncoder();
      const digest = await crypto.subtle.digest("SHA-256", enc.encode(dbJson));
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      sums.files["data/database.json"] = hex;
      zip.file("integrity/checksums.json", JSON.stringify(sums));
    });
    const parsed = await parseAccZipBackup(blob);
    expect(parsed.warnings.some((w) => w.includes("سند"))).toBe(true);
  });

  it("rejects a main-app ZIP with a pointer to the right page", async () => {
    // Build a MAIN app backup (visa tables) and try to read it as accounting.
    await db.representatives.put({ id: "r1", name: "علی", createdAt: T, updatedAt: T } as Representative);
    const mainZip = await buildFullZipBackup();
    await expect(parseAccZipBackup(mainZip.blob)).rejects.toThrow(/پشتیبان حسابداری/);
    // And the accounting ZIP on the MAIN page must point back here.
    await seedFullDataset();
    const accZip = await buildFullAccZipBackup();
    await expect(parseZipBackup(accZip.blob)).rejects.toThrow(/حسابداری/);
  });

  it("rejects a totally unknown zip", async () => {
    const zip = new JSZip();
    zip.file("random.txt", "hello");
    const blob = new Blob([await zip.generateAsync({ type: "arraybuffer" })], {
      type: "application/zip",
    });
    await expect(parseAccZipBackup(blob)).rejects.toThrow(/manifest/);
  });
});

describe("encryption", () => {
  it("round trips through the EMENCZIP envelope with the accounting inner format", async () => {
    await seedFullDataset();
    const built = await buildFullAccZipBackup({ password: "رمز-تست-۱۲۳" });
    expect(built.encrypted).toBe(true);
    expect(built.filename).toMatch(/\.enc$/);

    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.slice(0, 8));
    expect(magic).toBe("EMENCZIP");

    const inner = await decryptZipBlob(built.blob, "رمز-تست-۱۲۳");
    const zip = await JSZip.loadAsync(await inner.arrayBuffer());
    const headerless = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(headerless.format).toBe(ACC_ZIP_BACKUP_FORMAT);

    await wipeAcc();
    const parsed = await parseAccZipBackup(inner);
    await applyAccZipRestore(parsed, "replace");
    await expectFullDatasetIntact();
  });

  it("demands a password and rejects a wrong one via the unified reader", async () => {
    await seedFullDataset();
    const built = await buildFullAccZipBackup({ password: "correct-pass" });
    const asFile = new File([built.blob], built.filename);
    await expect(readAnyAccBackupFile(asFile)).rejects.toThrow("ENCRYPTED");
    await expect(readAnyAccBackupFile(asFile, "wrong")).rejects.toThrow(/رمز عبور نادرست/);
    const any = await readAnyAccBackupFile(asFile, "correct-pass");
    expect(any.kind).toBe("zip");
  });
});

describe("unified reader (legacy compatibility)", () => {
  it("reads the legacy accounting JSON and restores it (with a no-files warning)", async () => {
    await seedFullDataset();
    const legacy = await buildAccBackup();
    const json = new Blob([JSON.stringify(legacy)], { type: "application/json" });
    const any = await readAnyAccBackupFile(json);
    expect(any.kind).toBe("legacy-acc");

    const preview = await buildAccUnifiedPreview(any);
    expect(preview.docs).toBeNull();
    expect(preview.counts.docs).toBe(4);
    expect(preview.warnings.some((w) => w.includes("فایل‌های اسناد"))).toBe(true);

    await wipeAcc();
    const result = await applyAnyAccRestore(any, "replace");
    // Records restored; doc METADATA is not written as rows (no files in JSON).
    expect(result.docs).toBe(4);
    expect(await db.accParties.count()).toBe(1);
    expect(await db.accTransactions.count()).toBe(5);
    expect(await db.accDocs.count()).toBe(0);
  });

  it("reads an old full-app JSON that still embeds accounting data", async () => {
    await seedFullDataset();
    const accData = (await buildAccBackup()).data;
    const oldFull = {
      format: "2customer-backup",
      version: 1,
      exportedAt: T,
      schemaVersion: db.verno,
      counts: {},
      data: {
        representatives: [],
        customers: [],
        requests: [],
        lists: [],
        payments: [],
        tags: [],
        visaTypes: [],
        customFields: [],
        activities: [],
        preferences: null,
        acc: accData,
      },
    };
    const json = new Blob([JSON.stringify(oldFull)], { type: "application/json" });
    const any = await readAnyAccBackupFile(json);
    expect(any.kind).toBe("legacy-full");
    const preview = await buildAccUnifiedPreview(any);
    expect(preview.warnings.some((w) => w.includes("قدیمی کل برنامه"))).toBe(true);

    await wipeAcc();
    await applyAnyAccRestore(any, "merge");
    expect(await db.accParties.count()).toBe(1);
  });

  it("rejects a full-app JSON without accounting data", async () => {
    const oldFull = {
      format: "2customer-backup",
      version: 1,
      exportedAt: T,
      schemaVersion: db.verno,
      counts: {},
      data: {
        representatives: [],
        customers: [],
        requests: [],
        lists: [],
        payments: [],
        tags: [],
        visaTypes: [],
        customFields: [],
        activities: [],
        preferences: null,
      },
    };
    const json = new Blob([JSON.stringify(oldFull)], { type: "application/json" });
    await expect(readAnyAccBackupFile(json)).rejects.toThrow(/حسابداری/);
  });

  it("rejects an unknown file kind", async () => {
    const junk = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: "application/octet-stream" });
    await expect(readAnyAccBackupFile(junk)).rejects.toThrow(/معتبر/);
  });
});

describe("atomicity & rollback", () => {
  it("rolls the database back to the pre-restore state when a write fails mid-transaction", async () => {
    await seedFullDataset();
    const built = await buildFullAccZipBackup();
    const parsed = await parseAccZipBackup(built.blob);

    // Mutate the current state so we can prove the rollback restores it.
    await db.accParties.put(mkParty("p-extra", "مشتری اضافه"));

    const originalPut = db.accDocs.put.bind(db.accDocs);
    const spy = vi.spyOn(db.accDocs, "put");
    let calls = 0;
    spy.mockImplementation(((doc: AccDoc) => {
      calls++;
      if (calls === 3) return Promise.reject(new Error("boom"));
      return originalPut(doc as never);
    }) as never);

    await expect(applyAccZipRestore(parsed, "replace")).rejects.toThrow("boom");
    spy.mockRestore();

    // Rollback snapshot: original dataset + the extra party, docs intact.
    expect(await db.accParties.get("p-extra")).toBeDefined();
    expect(await db.accParties.count()).toBe(2);
    expect(await db.accDocs.count()).toBe(4);
    const tx = await db.accTransactions.get("tx3");
    expect(tx?.exchangeRate).toBe(100_000);
  });

  it("rolls back when post-apply verification fails", async () => {
    await seedFullDataset();
    const built = await buildFullZipSafe();
    const parsed = await parseAccZipBackup(built.blob);

    // Make bulkGet lie about a missing row AFTER the write phase.
    const spy = vi.spyOn(db.accParties, "bulkGet").mockResolvedValue([undefined] as never);
    await expect(applyAccZipRestore(parsed, "replace")).rejects.toThrow(/تأیید نهایی/);
    spy.mockRestore();
    await expectFullDatasetIntact();
  });
});

describe("safety backup & stats", () => {
  it("returns null for an empty module and a full ZIP otherwise", async () => {
    expect(await createAccSafetyZipBackup()).toBeNull();
    await seedFullDataset();
    const safety = await createAccSafetyZipBackup();
    expect(safety).not.toBeNull();
    expect(safety!.filename).toMatch(/^emanagement-acc-backup-/);
    const parsed = await parseAccZipBackup(safety!.blob);
    expect(parsed.manifest.docs.count).toBe(4);
  });

  it("reports storage stats", async () => {
    const empty = await getAccStorageStats();
    expect(empty.records).toEqual({ parties: 0, accounts: 0, transactions: 0, outstanding: 0 });
    expect(empty.docs.count).toBe(0);
    await seedFullDataset();
    const stats = await getAccStorageStats();
    expect(stats.records).toEqual({ parties: 1, accounts: 2, transactions: 5, outstanding: 1 });
    expect(stats.docs.count).toBe(4);
    expect(stats.docs.bytes).toBe(2 * BIG_PNG.length + IMG_A.length + PDF_DOC.length);
  });
});
