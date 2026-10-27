/**
 * Complete ZIP backup & restore for the accounting section (بخش حسابداری).
 *
 * Mirrors the main-app engine (utils/zipbackup.ts) with the same guarantees:
 *
 * Archive layout (format "emanagement-acc-zip-backup", version 1):
 *
 *   emanagement-acc-backup-YYYY-MM-DD-HH-mm-ss.zip
 *   ├── manifest.json                     — format/version/counts/schema info
 *   ├── data/database.json                — every accounting record + document
 *   │                                       metadata (AccBackupFile shape;
 *   │                                       file bytes live in assets/)
 *   ├── assets/docs/<docId>               — raw image/PDF bytes, stored as-is
 *   └── integrity/checksums.json          — SHA-256 of every archived file
 *
 * Design goals:
 *  - LOSSLESS: every party, account, transaction (incl. reversal links and
 *    exchange legs), outstanding item with its settlement array, document
 *    metadata (name / MIME / size / links / category / notes) and every byte
 *    of every document file survives the round trip exactly.
 *  - CONSISTENT SNAPSHOT: all six accounting tables are read inside ONE
 *    readonly Dexie transaction before packing starts.
 *  - VERIFIED: manifest, versions, SHA-256 checksums, record counts, duplicate
 *    ids and the asset↔metadata mapping are validated BEFORE any write. The
 *    apply step runs in one atomic transaction with an in-memory rollback
 *    snapshot as a safety net, followed by a post-apply verification pass.
 *  - ENCRYPTABLE: with a password the whole ZIP is sealed into the same
 *    AES-GCM EMENCZIP envelope as the main app (PBKDF2-SHA256, 150k iters).
 *
 * Completely separate from the main-app archive — each page restores only
 * its own format and points at the other one with a clear message.
 */

import type { Table } from "dexie";
import { db } from "../db/schema";
import { logActivity } from "../db/activities";
import { ACC_BACKUP_FORMAT, ACC_BACKUP_VERSION } from "./backup";
import type {
  AccBackupData,
  AccBackupFile,
  AccDoc,
  AccParty,
  AccSettings,
  FinAccount,
  FinTransaction,
  OutstandingItem,
} from "./types";
import {
  BackupCancelledError,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_ENTRIES,
  backupStamp,
  decryptZipBlob,
  encryptZipBytes,
  sha256Hex,
  sniffBackupFile,
} from "../utils/zipbackup";
import pkg from "../../package.json";

export const ACC_ZIP_BACKUP_FORMAT = "emanagement-acc-zip-backup";
export const ACC_ZIP_BACKUP_VERSION = 1;

const MANIFEST_PATH = "manifest.json";
const DATABASE_PATH = "data/database.json";
const CHECKSUMS_PATH = "integrity/checksums.json";
const ASSET_PREFIX = "assets/docs/";

/** All accounting tables — the full restore set. */
const ACC_RESTORE_TABLES = [
  db.accParties,
  db.accAccounts,
  db.accTransactions,
  db.accOutstanding,
  db.accDocs,
  db.accMeta,
] as const;

/** Record tables upserted by id (documents are handled separately). */
const ACC_RECORD_KEYS = ["parties", "accounts", "transactions", "outstanding"] as const;
type AccRecordKey = (typeof ACC_RECORD_KEYS)[number];
type AnyTable = Table<any, any>;

/* --------------------------------- types --------------------------------- */

export type AccBackupPhase =
  | "reading"
  | "packing"
  | "encrypting"
  | "validating"
  | "writing"
  | "verifying"
  | "done";

export interface AccBackupProgress {
  phase: AccBackupPhase;
  /** 0–100 across the whole operation. */
  percent: number;
}

export interface BuildAccZipOptions {
  /** When set, the whole archive is AES-GCM encrypted. */
  password?: string | null;
  onProgress?: (p: AccBackupProgress) => void;
  /** Checked between phases — throws BackupCancelledError when true. */
  shouldCancel?: () => boolean;
}

export interface AccZipManifest {
  format: typeof ACC_ZIP_BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  schemaVersion: number;
  /** Rows per table: parties / accounts / transactions / outstanding / docs. */
  counts: Record<string, number>;
  docs: { count: number; bytes: number };
  encrypted: boolean;
  generator: string;
}

/** What data/database.json holds: legacy AccBackupFile + app version. */
export type AccZipDatabasePayload = AccBackupFile & {
  appVersion?: string;
};

export interface ParsedAccZipBackup {
  manifest: AccZipManifest;
  backup: AccZipDatabasePayload;
  /** docId → binary content (SHA-256 verified). */
  assets: Map<string, Blob>;
  /** Non-fatal notes detected while parsing (dangling refs, unknown files…). */
  warnings: string[];
}

export interface BuiltAccZipBackup {
  blob: Blob;
  filename: string;
  counts: AccZipManifest["counts"];
  encrypted: boolean;
}

/* -------------------------------- helpers -------------------------------- */

function assertNotCancelled(opts: { shouldCancel?: () => boolean }): void {
  if (opts.shouldCancel?.()) throw new BackupCancelledError();
}

export function accBackupFilename(encrypted: boolean, d = new Date()): string {
  return `emanagement-acc-backup-${backupStamp(d)}.zip${encrypted ? ".enc" : ""}`;
}

/** Document row minus the blob — exactly what travels in database.json. */
function stripDocBlob(doc: AccDoc): Omit<AccDoc, "blob"> {
  const { blob: _blob, ...meta } = doc;
  return meta;
}

/**
 * Read every accounting table inside ONE readonly transaction, so the export
 * is a consistent snapshot (parties, accounts, transactions, outstanding,
 * document files and settings can never be half-updated mid-read).
 */
export async function readAccSnapshot(): Promise<{
  data: AccBackupData;
  docs: AccDoc[];
}> {
  return db.transaction("r", ACC_RESTORE_TABLES as unknown as AnyTable[], async () => {
    const [parties, accounts, transactions, outstanding, docs, settings] = await Promise.all([
      db.accParties.toArray(),
      db.accAccounts.toArray(),
      db.accTransactions.orderBy("date").toArray(),
      db.accOutstanding.toArray(),
      db.accDocs.orderBy("createdAt").toArray(),
      db.accMeta.get("acc"),
    ]);
    return {
      data: {
        parties,
        accounts,
        transactions,
        outstanding,
        docsMeta: docs.map(stripDocBlob),
        settings: settings ?? null,
      },
      docs,
    };
  });
}

/* ------------------------------ build (export) ---------------------------- */

/**
 * Build the complete ZIP backup of the accounting section: every record,
 * every document FILE and the module settings in one archive.
 */
export async function buildFullAccZipBackup(
  opts: BuildAccZipOptions = {},
): Promise<BuiltAccZipBackup> {
  const encrypted = Boolean(opts.password);
  const onProgress = opts.onProgress;
  assertNotCancelled(opts);

  // ---- Phase 1: consistent snapshot ---------------------------------------
  onProgress?.({ phase: "reading", percent: 2 });
  const { data, docs } = await readAccSnapshot();
  assertNotCancelled(opts);
  onProgress?.({ phase: "reading", percent: 22 });

  // ---- Phase 2: pack ------------------------------------------------------
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const counts: Record<string, number> = {
    parties: data.parties.length,
    accounts: data.accounts.length,
    transactions: data.transactions.length,
    outstanding: data.outstanding.length,
    docs: data.docsMeta.length,
  };

  const payload: AccZipDatabasePayload = {
    format: ACC_BACKUP_FORMAT,
    version: ACC_BACKUP_VERSION,
    exportedAt: Date.now(),
    schemaVersion: db.verno,
    appVersion: pkg.version,
    counts,
    data,
  };

  const manifest: AccZipManifest = {
    format: ACC_ZIP_BACKUP_FORMAT,
    version: ACC_ZIP_BACKUP_VERSION,
    createdAt: payload.exportedAt,
    appVersion: pkg.version,
    schemaVersion: db.verno,
    counts,
    docs: {
      count: docs.length,
      bytes: docs.reduce((s, d) => s + d.size, 0),
    },
    encrypted,
    generator: "E-managment",
  };

  const dbJson = JSON.stringify(payload);

  // Hash every file that travels in the archive (assets hashed from bytes).
  const checksumFiles: Record<string, string> = {};
  checksumFiles[DATABASE_PATH] = await sha256Hex(dbJson);

  const assetBytes = new Map<string, Uint8Array>();
  let packed = 0;
  for (const doc of docs) {
    assertNotCancelled(opts);
    const bytes = new Uint8Array(await doc.blob.arrayBuffer());
    assetBytes.set(doc.id, bytes);
    checksumFiles[`${ASSET_PREFIX}${doc.id}`] = await sha256Hex(bytes);
    packed++;
    onProgress?.({
      phase: "reading",
      percent: 22 + Math.round((packed / Math.max(1, docs.length)) * 16),
    });
  }

  const checksumsJson = JSON.stringify(
    { algorithm: "SHA-256", files: checksumFiles },
    null,
    2,
  );

  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });
  zip.file(DATABASE_PATH, dbJson, { compression: "DEFLATE" });
  zip.file(CHECKSUMS_PATH, checksumsJson, { compression: "DEFLATE" });
  const assetFolder = zip.folder("assets")!.folder("docs")!;
  for (const [id, bytes] of assetBytes) {
    // Images/PDFs are already compressed — STORE keeps bytes exact and fast.
    assetFolder.file(id, bytes, { compression: "STORE" });
  }

  assertNotCancelled(opts);
  onProgress?.({ phase: "packing", percent: 40 });

  const arrayBuf = await zip.generateAsync({ type: "arraybuffer" }, (meta) => {
    onProgress?.({
      phase: "packing",
      percent: 40 + Math.round(meta.percent * 0.5),
    });
  });
  assertNotCancelled(opts);

  let blob: Blob;
  if (encrypted && opts.password) {
    onProgress?.({ phase: "encrypting", percent: 92 });
    blob = await encryptZipBytes(new Uint8Array(arrayBuf), opts.password, ACC_ZIP_BACKUP_FORMAT);
  } else {
    blob = new Blob([arrayBuf], { type: "application/zip" });
  }

  onProgress?.({ phase: "done", percent: 100 });
  return { blob, filename: accBackupFilename(encrypted), counts, encrypted };
}

/* ------------------------------ parse (import) ---------------------------- */

export interface ParseAccOptions {
  onProgress?: (p: AccBackupProgress) => void;
}

/**
 * Read and fully validate an accounting ZIP backup. Nothing here touches the
 * database — the caller only gets data back once every check has passed.
 */
export async function parseAccZipBackup(
  zipBlob: Blob,
  opts: ParseAccOptions = {},
): Promise<ParsedAccZipBackup> {
  const onProgress = opts.onProgress;
  onProgress?.({ phase: "validating", percent: 2 });
  const { default: JSZip } = await import("jszip");
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

  let loaded: InstanceType<typeof JSZip>;
  try {
    loaded = await JSZip.loadAsync(zipBytes, { checkCRC32: true });
  } catch {
    throw new Error("فایل ZIP قابل خواندن نیست — آسیب‌دیده یا ناقص است.");
  }

  const entryNames = Object.keys(loaded.files).filter((n) => !loaded.files[n].dir);
  if (entryNames.length === 0) throw new Error("بایگانی ZIP خالی است.");
  if (entryNames.length > MAX_ZIP_ENTRIES) {
    throw new Error("تعداد فایل‌های این بایگانی بیش از حد مجاز است.");
  }
  for (const name of entryNames) {
    if (name.includes("..") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`مسیر ناامن در بایگانی: ${name}`);
    }
  }

  const warnings: string[] = [];

  // ---- manifest -----------------------------------------------------------
  const manifestEntry = loaded.file(MANIFEST_PATH);
  if (!manifestEntry) {
    throw new Error("فایل manifest.json در بایگانی پیدا نشد — این یک پشتیبان معتبر نیست.");
  }
  let manifest: AccZipManifest;
  try {
    manifest = JSON.parse(await manifestEntry.async("string"));
  } catch {
    throw new Error("manifest.json قابل خواندن نیست.");
  }
  if (manifest.format !== ACC_ZIP_BACKUP_FORMAT) {
    throw new Error("این ZIP یک پشتیبان حسابداری E-managment نیست.");
  }
  if (manifest.version > ACC_ZIP_BACKUP_VERSION) {
    throw new Error(
      `این پشتیبان با نسخه جدیدتری از برنامه ساخته شده (نسخه ${manifest.version}) و قابل بازیابی نیست — اول برنامه را به‌روزرسانی کنید.`,
    );
  }

  // ---- checksums ----------------------------------------------------------
  const sumsEntry = loaded.file(CHECKSUMS_PATH);
  if (!sumsEntry) {
    throw new Error("فایل checksums.json در بایگانی پیدا نشد — صحت داده‌ها قابل تأیید نیست.");
  }
  let sums: { algorithm: string; files: Record<string, string> };
  try {
    sums = JSON.parse(await sumsEntry.async("string"));
  } catch {
    throw new Error("checksums.json قابل خواندن نیست.");
  }
  if (sums.algorithm !== "SHA-256" || !sums.files) {
    throw new Error("الگوریتم چک‌سام پشتیبانی نمی‌شود.");
  }

  // ---- database.json ------------------------------------------------------
  onProgress?.({ phase: "validating", percent: 10 });
  const dbEntry = loaded.file(DATABASE_PATH);
  if (!dbEntry) {
    throw new Error("فایل data/database.json در بایگانی پیدا نشد.");
  }
  const dbJson = await dbEntry.async("string");
  if ((await sha256Hex(dbJson)) !== sums.files[DATABASE_PATH]) {
    throw new Error("داده‌های اصلی بایگانی با چک‌سام نمی‌خوانند — فایل خراب یا دستکاری شده است.");
  }
  let payload: AccZipDatabasePayload;
  try {
    payload = JSON.parse(dbJson);
  } catch {
    throw new Error("data/database.json قابل خواندن نیست.");
  }
  if (payload.format !== ACC_BACKUP_FORMAT || !payload.data) {
    throw new Error("ساختار داده‌های بایگانی معتبر نیست.");
  }
  if (payload.schemaVersion > db.verno) {
    throw new Error(
      "این پشتیبان با نسخه جدیدتری از ساختار داده ساخته شده — اول برنامه را به‌روزرسانی کنید.",
    );
  }

  // ---- counts & duplicate ids ---------------------------------------------
  for (const key of [...ACC_RECORD_KEYS, "docs"] as const) {
    const rows =
      key === "docs" ? payload.data.docsMeta : (payload.data[key] as { id: string }[]);
    if (manifest.counts[key] != null && rows.length !== manifest.counts[key]) {
      throw new Error(
        `تعداد رکوردهای «${key}» با manifest نمی‌خواند — بایگانی ناقص یا خراب است.`,
      );
    }
    const ids = new Set(rows.map((r) => r.id));
    if (ids.size !== rows.length) {
      throw new Error(`شناسه‌های تکراری در «${key}» — بایگانی خراب است.`);
    }
  }

  // ---- documents: metadata ↔ bytes ----------------------------------------
  const metas = payload.data.docsMeta;
  const metaById = new Map<string, Omit<AccDoc, "blob">>();
  for (const m of metas) {
    if (!m || typeof m.id !== "string" || typeof m.size !== "number" || !m.mime) {
      throw new Error("متادیتای یک سند نامعتبر است.");
    }
    if (metaById.has(m.id)) throw new Error("شناسه سند تکراری در بایگانی.");
    metaById.set(m.id, m);
  }

  const assetEntries = entryNames.filter((n) => n.startsWith(ASSET_PREFIX));
  const knownPaths = new Set<string>([MANIFEST_PATH, DATABASE_PATH, CHECKSUMS_PATH]);
  for (const e of assetEntries) knownPaths.add(e);
  const unknownFiles = entryNames.filter((n) => !knownPaths.has(n));
  if (unknownFiles.length > 0) {
    warnings.push(
      `${unknownFiles.length} فایل ناشناخته در بایگانی نادیده گرفته شد (${unknownFiles[0]}${unknownFiles.length > 1 ? " و…" : ""}).`,
    );
  }

  const assets = new Map<string, Blob>();
  let totalBytes = 0;
  let done = 0;
  for (const entryName of assetEntries) {
    const id = entryName.slice(ASSET_PREFIX.length);
    const meta = metaById.get(id);
    if (!meta) {
      throw new Error(`فایل سند بدون متادیتا در بایگانی: ${id}`);
    }
    const entry = loaded.file(entryName);
    if (!entry) continue;
    const bytes = new Uint8Array(await entry.async("uint8array"));
    totalBytes += bytes.length;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("حجم باز شدهٔ بایگانی بیش از حد مجاز است.");
    }
    if ((await sha256Hex(bytes)) !== sums.files[entryName]) {
      throw new Error(`فایل سند «${meta.name}» با چک‌سام نمی‌خواند — خراب یا دستکاری شده است.`);
    }
    if (bytes.length !== meta.size) {
      throw new Error(`حجم فایل سند «${meta.name}» با متادیتا نمی‌خواند.`);
    }
    assets.set(id, new Blob([bytes], { type: meta.mime }));
    done++;
    onProgress?.({
      phase: "validating",
      percent: 10 + Math.round((done / Math.max(1, assetEntries.length)) * 65),
    });
  }

  if (assets.size !== metaById.size) {
    const missing = metas.filter((m) => !assets.has(m.id)).length;
    throw new Error(
      `این بایگانی ناقص است — ${missing} فایل سند کم دارد. از نسخهٔ سالم پشتیبان استفاده کنید.`,
    );
  }

  // ---- referential notes (non-fatal) --------------------------------------
  const partyIds = new Set(payload.data.parties.map((p) => p.id));
  const accountIds = new Set(payload.data.accounts.map((a) => a.id));
  const txIds = new Set(payload.data.transactions.map((t) => t.id));
  const docIds = new Set(metas.map((m) => m.id));
  const danglingDocs = metas.filter(
    (m) =>
      (m.partyId && !partyIds.has(m.partyId)) ||
      (m.transactionId && !txIds.has(m.transactionId)) ||
      (m.accountId && !accountIds.has(m.accountId)),
  ).length;
  if (danglingDocs > 0) {
    warnings.push(
      `${danglingDocs} سند به طرف حساب/تراکنش/حسابی اشاره می‌کند که در این پشتیبان نیست — خود فایل‌ها محفوظ می‌مانند.`,
    );
  }
  const photoDangling = payload.data.parties.filter(
    (p) => p.photoDocId && !docIds.has(p.photoDocId),
  ).length;
  if (photoDangling > 0) {
    warnings.push(
      `${photoDangling} طرف حساب به سند عکسی اشاره می‌کند که در این پشتیبان نیست.`,
    );
  }
  const danglingTx = payload.data.transactions.filter(
    (t) =>
      (t.partyId && !partyIds.has(t.partyId)) ||
      (t.sourceAccountId && !accountIds.has(t.sourceAccountId)) ||
      (t.destAccountId && !accountIds.has(t.destAccountId)),
  ).length;
  if (danglingTx > 0) {
    warnings.push(
      `${danglingTx} تراکنش به طرف حساب یا حسابی اشاره می‌کند که در این پشتیبان نیست.`,
    );
  }

  onProgress?.({ phase: "validating", percent: 75 });
  return { manifest, backup: payload, assets, warnings };
}

/* ------------------------------ unified facade ---------------------------- */

export type AnyAccBackup =
  | { kind: "zip"; parsed: ParsedAccZipBackup }
  /** Accounting-only legacy JSON (docs metadata only, no files). */
  | { kind: "legacy-acc"; backup: AccBackupFile }
  /**
   * Old MAIN-app JSON backup that still bundles the accounting section
   * (data.acc) — accepted here so no accounting data is ever lost. Only the
   * accounting portion is restored.
   */
  | { kind: "legacy-full"; backup: { exportedAt: number; data: AccBackupData } };

/**
 * Entry point for the accounting restore screen: accepts the new accounting
 * ZIP (plain or encrypted), the legacy accounting JSON, and old full-app JSON
 * backups that still embedded accounting data. Throws Error("ENCRYPTED") when
 * a password is required.
 */
export async function readAnyAccBackupFile(
  file: Blob,
  password?: string,
): Promise<AnyAccBackup> {
  const kind = await sniffBackupFile(file);
  if (kind === "enc-zip") {
    if (!password) throw new Error("ENCRYPTED");
    const zip = await decryptZipBlob(file, password);
    return { kind: "zip", parsed: await parseAccZipBackup(zip) };
  }
  if (kind === "zip") {
    return { kind: "zip", parsed: await parseAccZipBackup(file) };
  }
  if (kind === "json") {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("فایل انتخاب‌شده یک JSON معتبر نیست.");
    }
    const obj = parsed as { format?: string; version?: number; data?: unknown };
    if (obj?.format === ACC_BACKUP_FORMAT) {
      const backup = parsed as AccBackupFile;
      if (backup.version > ACC_BACKUP_VERSION) {
        throw new Error(
          `این پشتیبان با نسخه جدیدتری ساخته شده (${backup.version}) و قابل بازیابی نیست.`,
        );
      }
      if (!backup.data) throw new Error("ساختار فایل پشتیبان نامعتبر است.");
      return { kind: "legacy-acc", backup };
    }
    // Old full-app backup formats (plain or encrypted) with embedded acc data.
    const { BACKUP_FORMAT, ENCRYPTED_FORMAT, readBackupFile } = await import("../utils/backup");
    if (obj?.format === ENCRYPTED_FORMAT) {
      if (!password) throw new Error("ENCRYPTED");
      const asFile =
        file instanceof File ? file : new File([file], "backup.json", { type: "application/json" });
      const full = await readBackupFile(asFile, password);
      if (!full.data.acc) {
        throw new Error("این پشتیبان قدیمی داده‌های حسابداری ندارد.");
      }
      return { kind: "legacy-full", backup: { exportedAt: full.exportedAt, data: full.data.acc } };
    }
    if (obj?.format === BACKUP_FORMAT) {
      const full = parsed as { exportedAt: number; data: { acc?: AccBackupData } };
      if (!full.data?.acc) {
        throw new Error("این پشتیبان داده‌های حسابداری ندارد — پشتیبان حسابداری جداگانه است.");
      }
      return { kind: "legacy-full", backup: { exportedAt: full.exportedAt, data: full.data.acc } };
    }
    throw new Error(
      "فایل انتخاب‌شده پشتیبان حسابداری معتبری نیست — ZIP جدید، ZIP رمزنگاری‌شده یا JSON حسابداری را انتخاب کنید.",
    );
  }
  throw new Error(
    "فایل انتخاب‌شده پشتیبان حسابداری معتبری نیست — ZIP جدید، ZIP رمزنگاری‌شده یا JSON حسابداری را انتخاب کنید.",
  );
}

export interface AccUnifiedPreview {
  kind: "zip" | "legacy-acc" | "legacy-full";
  counts: Record<string, number>;
  /** ZIP only; legacy JSON never carries document files. */
  docs: { count: number; bytes: number } | null;
  duplicates: number;
  existingCounts: Record<string, number>;
  warnings: string[];
}

export async function buildAccUnifiedPreview(b: AnyAccBackup): Promise<AccUnifiedPreview> {
  const existingCounts: Record<string, number> = {};
  for (const key of ACC_RECORD_KEYS) {
    const table = db[accTableForKey(key)] as AnyTable;
    existingCounts[key] = await table.count();
  }

  if (b.kind === "zip") {
    const { manifest, backup, warnings: parseWarnings } = b.parsed;
    let duplicates = 0;
    for (const key of ACC_RECORD_KEYS) {
      const table = db[accTableForKey(key)] as AnyTable;
      const ids = new Set(((await table.toArray()) as { id: string }[]).map((r) => r.id));
      duplicates += (backup.data[key] as { id: string }[]).filter((r) => ids.has(r.id)).length;
    }
    const warnings = [...parseWarnings];
    if (manifest.schemaVersion < db.verno) {
      warnings.push(
        "این پشتیبان با نسخه قدیمی‌تری از ساختار داده ساخته شده — رکوردهای ناقص ممکن است فیلدهای جدید را نداشته باشند (برنامه تحمل می‌کند).",
      );
    }
    return {
      kind: "zip",
      counts: manifest.counts,
      docs: { ...manifest.docs },
      duplicates,
      existingCounts,
      warnings,
    };
  }

  // Legacy paths
  const data = b.kind === "legacy-acc" ? b.backup.data : b.backup.data;
  const counts = {
    parties: data.parties.length,
    accounts: data.accounts.length,
    transactions: data.transactions.length,
    outstanding: data.outstanding.length,
    docs: data.docsMeta.length,
  };
  let duplicates = 0;
  for (const key of ACC_RECORD_KEYS) {
    const table = db[accTableForKey(key)] as AnyTable;
    const ids = new Set(((await table.toArray()) as { id: string }[]).map((r) => r.id));
    duplicates += (data[key] as { id: string }[]).filter((r) => ids.has(r.id)).length;
  }
  const warnings: string[] = [];
  warnings.push(
    "پشتیبان‌های JSON قدیمی فایل‌های اسناد را شامل نمی‌شوند — اسناد فقط در پشتیبان کامل ZIP موجودند.",
  );
  if (b.kind === "legacy-full") {
    warnings.push(
      "این یک پشتیبان قدیمی کل برنامه است — فقط بخش حسابداری آن بازیابی می‌شود (بدون فایل اسناد).",
    );
  }
  return { kind: b.kind, counts, docs: null, duplicates, existingCounts, warnings };
}

function accTableForKey(key: AccRecordKey): keyof typeof db {
  switch (key) {
    case "parties":
      return "accParties";
    case "accounts":
      return "accAccounts";
    case "transactions":
      return "accTransactions";
    case "outstanding":
      return "accOutstanding";
  }
}

export type AccRestoreMode = "merge" | "replace";

export interface AccUnifiedRestoreResult {
  inserted: number;
  updated: number;
  docs: number;
}

/* --------------------------- apply (zip restore) -------------------------- */

interface AccTableSnapshot {
  entries: { table: AnyTable; rows: unknown[] }[];
}

async function snapshotAccTables(tables: AnyTable[]): Promise<AccTableSnapshot> {
  const entries: AccTableSnapshot["entries"] = [];
  for (const table of tables) {
    entries.push({ table, rows: await table.toArray() });
  }
  return { entries };
}

async function rollbackAccSnapshot(snap: AccTableSnapshot): Promise<void> {
  const tables = snap.entries.map((e) => e.table);
  await db.transaction("rw", tables, async () => {
    for (const t of tables) await t.clear();
    for (const e of snap.entries) {
      if (e.rows.length) await e.table.bulkPut(e.rows as never[]);
    }
  });
}

/**
 * Restore a validated accounting ZIP backup.
 *
 * Atomicity: all writes run in ONE Dexie transaction — any error aborts and
 * leaves the database untouched. A pre-apply in-memory snapshot is kept as a
 * safety net: if the post-apply verification still fails, the snapshot is
 * written back so the app is never left half-restored.
 */
export async function applyAccZipRestore(
  parsed: ParsedAccZipBackup,
  mode: AccRestoreMode,
  onProgress?: (p: AccBackupProgress) => void,
): Promise<AccUnifiedRestoreResult> {
  const d = parsed.backup.data;
  const tables = [...ACC_RESTORE_TABLES] as unknown as AnyTable[];

  // Safety snapshot of everything we are about to touch.
  const snap = await snapshotAccTables(tables);

  let inserted = 0;
  let updated = 0;

  try {
    onProgress?.({ phase: "writing", percent: 78 });
    await db.transaction("rw", tables, async () => {
      if (mode === "replace") {
        for (const t of tables) await t.clear();
      }
      const upsert = async (table: AnyTable, records: { id: string }[]) => {
        for (const rec of records) {
          if (mode === "replace") {
            inserted++;
          } else {
            const exists = (await table.get(rec.id)) != null;
            exists ? updated++ : inserted++;
          }
          await table.put(rec as never);
        }
      };
      await upsert(db.accParties, d.parties as { id: string }[]);
      await upsert(db.accAccounts, d.accounts as { id: string }[]);
      await upsert(db.accTransactions, d.transactions as { id: string }[]);
      await upsert(db.accOutstanding, d.outstanding as { id: string }[]);

      if (d.settings) {
        await db.accMeta.put(d.settings as never);
      }

      // Documents — metadata + verified bytes reunited by id.
      for (const meta of d.docsMeta) {
        const blob = parsed.assets.get(meta.id);
        if (!blob) throw new Error(`فایل سند «${meta.name}» در بایگانی نیست.`);
        await db.accDocs.put({ ...meta, blob } as never);
      }
    });

    // Post-apply verification: every backed-up id must exist, document sizes
    // must match. (Counts only — bytes were SHA-256-verified at parse.)
    onProgress?.({ phase: "verifying", percent: 90 });
    const checkIds = async (table: AnyTable, records: { id: string }[]) => {
      if (!records.length) return;
      const got = (await table.bulkGet(records.map((r) => r.id))) as ({ id: string } | undefined)[];
      if (got.some((g) => g == null)) {
        throw new Error("تأیید نهایی بازیابی ناموفق بود — برخی رکوردها ثبت نشدند.");
      }
    };
    await checkIds(db.accParties, d.parties as { id: string }[]);
    await checkIds(db.accAccounts, d.accounts as { id: string }[]);
    await checkIds(db.accTransactions, d.transactions as { id: string }[]);
    await checkIds(db.accOutstanding, d.outstanding as { id: string }[]);
    for (const meta of d.docsMeta) {
      const row = (await db.accDocs.get(meta.id)) as AccDoc | undefined;
      if (!row || row.size !== meta.size) {
        throw new Error("تأیید نهایی اسناد ناموفق بود.");
      }
    }
  } catch (e) {
    // The transaction itself is atomic; this covers post-commit verification
    // failures and any unexpected error path — restore the pre-apply state.
    try {
      await rollbackAccSnapshot(snap);
    } catch {
      /* keep the original error */
    }
    throw e;
  }

  try {
    await logActivity({
      type: "restore",
      entity: "accBackup",
      title:
        mode === "replace"
          ? "بازیابی کامل حسابداری از پشتیبان ZIP انجام شد"
          : "بازیابی ادغامی حسابداری از پشتیبان ZIP انجام شد",
      detail: `${inserted} رکورد جدید، ${updated} به‌روزرسانی، ${d.docsMeta.length} سند`,
    });
  } catch {
    /* activity log is best-effort */
  }

  onProgress?.({ phase: "done", percent: 100 });
  return { inserted, updated, docs: d.docsMeta.length };
}

/** Apply any recognized accounting backup (ZIP, legacy acc JSON, old full JSON). */
export async function applyAnyAccRestore(
  b: AnyAccBackup,
  mode: AccRestoreMode,
  onProgress?: (p: AccBackupProgress) => void,
): Promise<AccUnifiedRestoreResult> {
  if (b.kind === "zip") {
    return applyAccZipRestore(b.parsed, mode, onProgress);
  }
  // Legacy JSON: metadata only — reuse the proven applyAccBackup writer.
  const { applyAccBackup } = await import("./backup");
  onProgress?.({ phase: "writing", percent: 50 });
  const r = await applyAccBackup(b.backup.data, mode);
  onProgress?.({ phase: "done", percent: 100 });
  return { ...r, docs: b.backup.data.docsMeta.length };
}

/* ----------------------------- safety & stats ----------------------------- */

/**
 * Full ZIP safety snapshot before a destructive action (replace-restore or
 * reset). Returns null when accounting is completely empty. Includes every
 * document FILE — unlike the old JSON safety backup, nothing is lost.
 */
export async function createAccSafetyZipBackup(): Promise<BuiltAccZipBackup | null> {
  const counts = await Promise.all([
    db.accParties.count(),
    db.accAccounts.count(),
    db.accTransactions.count(),
    db.accOutstanding.count(),
    db.accDocs.count(),
  ]);
  if (counts.every((c) => c === 0)) return null;
  return buildFullAccZipBackup();
}

/** Storage stats for the accounting backup screen cards. */
export async function getAccStorageStats(): Promise<{
  records: { parties: number; accounts: number; transactions: number; outstanding: number };
  docs: { count: number; bytes: number };
}> {
  const [parties, accounts, transactions, outstanding, docs] = await Promise.all([
    db.accParties.count(),
    db.accAccounts.count(),
    db.accTransactions.count(),
    db.accOutstanding.count(),
    db.accDocs.toArray(),
  ]);
  return {
    records: { parties, accounts, transactions, outstanding },
    docs: { count: docs.length, bytes: docs.reduce((s, d) => s + d.size, 0) },
  };
}
