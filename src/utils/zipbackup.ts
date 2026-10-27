/**
 * Complete ZIP backup & restore for the main app (مدیریت ویزا).
 *
 * Archive layout (format "emanagement-zip-backup", version 1):
 *
 *   emanagement-backup-YYYY-MM-DD-HH-mm-ss.zip
 *   ├── manifest.json                     — format/version/counts/schema info
 *   ├── data/database.json                — every record of every main table
 *   │                                       (BackupFile shape + attachment
 *   │                                       metadata; blobs live in assets/)
 *   ├── assets/attachments/<attachmentId> — raw image/PDF bytes, stored as-is
 *   └── integrity/checksums.json          — SHA-256 of every archived file
 *
 * Design goals:
 *  - LOSSLESS: every record, key, relationship, filename, MIME type and binary
 *    byte of every attachment survives the round trip exactly.
 *  - CONSISTENT SNAPSHOT: all tables (records + attachments) are read inside
 *    one readonly IndexedDB transaction before packing starts.
 *  - VERIFIED: on restore, the manifest, version, SHA-256 checksums, record
 *    counts, duplicate ids and asset↔metadata mapping are all validated
 *    BEFORE a single byte is written. The apply step runs in one atomic Dexie
 *    transaction with an in-memory rollback snapshot as a safety net.
 *  - ENCRYPTABLE: with a password the whole ZIP is sealed with AES-GCM
 *    (PBKDF2-SHA256, 150k iterations) into a binary envelope. Encrypted
 *    backups are also the only ones that carry the AI worker accounts
 *    (API keys never travel unencrypted).
 *
 * The حسابداری (accounting) section is deliberately NOT part of this archive
 * — it has its own separate backup inside the accounting section.
 */

import type { Table } from "dexie";
import { db } from "../db/schema";
import type { Attachment, AttachmentMeta, BackupFile } from "../types";
import type { AiSettings, AiWorker } from "../lib/ai/types";
import { logActivity } from "../db/activities";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAIN_BACKUP_TABLES,
  b64ToBuf,
  bufToB64,
  deriveAesKey,
  PBKDF2_ITERATIONS,
  readMainBackupData,
} from "./backup";
import pkg from "../../package.json";

export const ZIP_BACKUP_FORMAT = "emanagement-zip-backup";
export const ZIP_BACKUP_VERSION = 1;
/** Binary magic at the start of every encrypted backup envelope. */
export const ENC_ZIP_MAGIC = "EMENCZIP";
export const ENC_ZIP_FORMAT = "emanagement-encrypted-zip";
export const ENC_ZIP_VERSION = 1;

/** Safety limits while reading untrusted archives (zip-bomb protection). */
export const MAX_ZIP_ENTRIES = 20_000;
export const MAX_UNCOMPRESSED_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

/** Format string of the accounting ZIP backup (defined in
 *  accounting/zipbackup.ts — kept as a literal here to avoid a circular
 *  import; the two constants must stay in sync). */
const ACC_ZIP_FORMAT_LITERAL = "emanagement-acc-zip-backup";

const MANIFEST_PATH = "manifest.json";
const DATABASE_PATH = "data/database.json";
const CHECKSUMS_PATH = "integrity/checksums.json";
const ASSET_PREFIX = "assets/attachments/";

/** Tables the ZIP backup reads/writes (records + attachments + optional AI). */
const RESTORE_TABLES = [
  db.representatives,
  db.customers,
  db.requests,
  db.lists,
  db.payments,
  db.tags,
  db.visaTypes,
  db.customFields,
  db.docTypes,
  db.activities,
  db.preferences,
  db.attachments,
];

/** Record tables whose rows are upserted by id (used for counting/duplicates). */
const UPSERT_TABLE_KEYS = [
  "representatives",
  "customers",
  "requests",
  "lists",
  "payments",
  "tags",
  "visaTypes",
  "customFields",
] as const;

type UpsertKey = (typeof UPSERT_TABLE_KEYS)[number];
type AnyTable = Table<any, any>;

export class BackupCancelledError extends Error {
  constructor() {
    super("عملیات لغو شد");
    this.name = "BackupCancelledError";
  }
}

/* ------------------------------- progress -------------------------------- */

export type BackupPhase =
  | "reading"
  | "packing"
  | "encrypting"
  | "validating"
  | "writing"
  | "verifying"
  | "done";

export interface BackupProgress {
  phase: BackupPhase;
  /** 0–100 across the whole operation. */
  percent: number;
}

export interface BuildZipOptions {
  /** When set, the whole archive is AES-GCM encrypted (and AI config included). */
  password?: string | null;
  onProgress?: (p: BackupProgress) => void;
  /** Checked between phases — throws BackupCancelledError when true. */
  shouldCancel?: () => boolean;
}

export interface ZipManifest {
  format: typeof ZIP_BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  schemaVersion: number;
  /** Rows per table, including "attachments". */
  counts: Record<string, number>;
  attachments: { count: number; bytes: number };
  /** True when the archive was built with a password (then it travels sealed). */
  encrypted: boolean;
  /** AI worker accounts (with keys) are only included in encrypted backups. */
  aiConfigIncluded: boolean;
  generator: string;
}

interface ChecksumsFile {
  algorithm: "SHA-256";
  files: Record<string, string>;
}

/** What data/database.json holds: legacy BackupFile + attachment meta (+ AI). */
export interface ZipDatabasePayload extends BackupFile {
  data: BackupFile["data"] & {
    attachments?: AttachmentMeta[];
    aiWorkers?: AiWorker[];
    aiMeta?: AiSettings | null;
  };
}

export interface ParsedZipBackup {
  manifest: ZipManifest;
  backup: ZipDatabasePayload;
  /** attachmentId → binary content (SHA-256 verified). */
  assets: Map<string, Blob>;
  /** Non-fatal notes detected while parsing (unknown files, dangling refs…). */
  warnings: string[];
}

/* -------------------------------- helpers -------------------------------- */

function assertNotCancelled(opts: { shouldCancel?: () => boolean }): void {
  if (opts.shouldCancel?.()) throw new BackupCancelledError();
}

/** SHA-256 hex digest — shared with the accounting ZIP engine. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Local-time filename stamp: YYYY-MM-DD-HH-mm-ss (safe on every OS). */
export function backupStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    p(d.getMonth() + 1),
    p(d.getDate()),
    p(d.getHours()),
    p(d.getMinutes()),
    p(d.getSeconds()),
  ].join("-");
}

export function backupFilename(encrypted: boolean, d = new Date()): string {
  return `emanagement-backup-${backupStamp(d)}.zip${encrypted ? ".enc" : ""}`;
}

function stripAttachmentBlob(att: Attachment): AttachmentMeta {
  return {
    id: att.id,
    customerId: att.customerId,
    paymentId: att.paymentId ?? null,
    kind: att.kind,
    name: att.name,
    mime: att.mime,
    size: att.size,
    createdAt: att.createdAt,
  };
}

/* ------------------------------ build (export) ---------------------------- */

export interface BuiltZipBackup {
  blob: Blob;
  filename: string;
  counts: ZipManifest["counts"];
  encrypted: boolean;
}

/**
 * Build the complete ZIP backup of the main app. Everything is read in one
 * readonly transaction (consistent snapshot), then packed with JSZip (assets
 * STOREd as-is, JSON deflated) and — when a password is given — sealed into
 * the AES-GCM envelope.
 */
export async function buildFullZipBackup(
  opts: BuildZipOptions = {},
): Promise<BuiltZipBackup> {
  const encrypted = Boolean(opts.password);
  const onProgress = opts.onProgress;
  assertNotCancelled(opts);

  // ---- Phase 1: consistent snapshot of every table -----------------------
  onProgress?.({ phase: "reading", percent: 2 });
  let data: BackupFile["data"] | null = null;
  let attachments: Attachment[] = [];
  let aiWorkers: AiWorker[] = [];
  let aiMeta: AiSettings | null = null;

  const snapshotTables = encrypted
    ? [...RESTORE_TABLES, db.aiWorkers, db.aiMeta]
    : RESTORE_TABLES;

  await db.transaction("r", snapshotTables, async () => {
    data = await readMainBackupData({ allActivities: true });
    attachments = await db.attachments.toArray();
    if (encrypted) {
      // API keys only ever leave the device inside an encrypted archive.
      aiWorkers = await db.aiWorkers.toArray();
      aiMeta = (await db.aiMeta.get("ai")) ?? null;
    }
  });
  if (!data) throw new Error("خواندن داده‌ها برای پشتیبان ناموفق بود.");
  const recordData: BackupFile["data"] = data;
  assertNotCancelled(opts);
  onProgress?.({ phase: "reading", percent: 22 });

  // ---- Phase 2: pack ------------------------------------------------------
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const attMetas = attachments.map(stripAttachmentBlob);
  const counts: Record<string, number> = {
    representatives: recordData.representatives.length,
    customers: recordData.customers.length,
    requests: recordData.requests.length,
    lists: recordData.lists.length,
    payments: recordData.payments.length,
    tags: recordData.tags.length,
    visaTypes: recordData.visaTypes.length,
    customFields: recordData.customFields.length,
    docTypes: recordData.docTypes?.length ?? 0,
    activities: recordData.activities.length,
    attachments: attMetas.length,
  };

  const payload: ZipDatabasePayload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    schemaVersion: db.verno,
    appVersion: pkg.version,
    counts,
    data: {
      ...recordData,
      attachments: attMetas,
      ...(encrypted ? { aiWorkers, aiMeta } : {}),
    },
  };

  const manifest: ZipManifest = {
    format: ZIP_BACKUP_FORMAT,
    version: ZIP_BACKUP_VERSION,
    createdAt: payload.exportedAt,
    appVersion: pkg.version,
    schemaVersion: db.verno,
    counts,
    attachments: {
      count: attMetas.length,
      bytes: attachments.reduce((s, a) => s + a.size, 0),
    },
    encrypted,
    aiConfigIncluded: encrypted,
    generator: "E-managment",
  };

  const dbJson = JSON.stringify(payload);

  // Hash every file that travels in the archive (assets hashed from bytes).
  const checksumFiles: Record<string, string> = {};
  checksumFiles[DATABASE_PATH] = await sha256Hex(dbJson);

  const assetBytes = new Map<string, Uint8Array>();
  let packed = 0;
  for (const att of attachments) {
    assertNotCancelled(opts);
    const bytes = new Uint8Array(await att.blob.arrayBuffer());
    assetBytes.set(att.id, bytes);
    checksumFiles[`${ASSET_PREFIX}${att.id}`] = await sha256Hex(bytes);
    packed++;
    onProgress?.({
      phase: "reading",
      percent: 22 + Math.round((packed / Math.max(1, attachments.length)) * 16),
    });
  }

  const checksums: ChecksumsFile = { algorithm: "SHA-256", files: checksumFiles };
  const checksumsJson = JSON.stringify(checksums, null, 2);

  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });
  zip.file(DATABASE_PATH, dbJson, { compression: "DEFLATE" });
  zip.file(CHECKSUMS_PATH, checksumsJson, { compression: "DEFLATE" });
  const assetFolder = zip.folder("assets")!.folder("attachments")!;
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
    blob = await encryptZipBytes(new Uint8Array(arrayBuf), opts.password);
  } else {
    blob = new Blob([arrayBuf], { type: "application/zip" });
  }

  onProgress?.({ phase: "done", percent: 100 });
  return { blob, filename: backupFilename(encrypted), counts, encrypted };
}

/* ------------------------- encrypted ZIP envelope ------------------------- */

/**
 * Seal raw ZIP bytes into the binary envelope:
 *   "EMENCZIP" (8 bytes) | header length (uint32 BE) | header JSON | AES-GCM ciphertext
 * The header carries the PBKDF2 salt/iv/iterations — everything needed to
 * decrypt without any external metadata. AES-GCM authenticates the content.
 */
export async function encryptZipBytes(
  zipBytes: Uint8Array,
  password: string,
  innerFormat: string = ZIP_BACKUP_FORMAT,
): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    zipBytes as unknown as BufferSource,
  );
  const header = new TextEncoder().encode(
    JSON.stringify({
      format: ENC_ZIP_FORMAT,
      version: ENC_ZIP_VERSION,
      kdf: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      createdAt: Date.now(),
      inner: innerFormat,
    }),
  );
  const out = new Uint8Array(8 + 4 + header.length + cipher.byteLength);
  out.set(new TextEncoder().encode(ENC_ZIP_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, header.length, false);
  out.set(header, 12);
  out.set(new Uint8Array(cipher), 12 + header.length);
  return new Blob([out], { type: "application/octet-stream" });
}

/** Open the envelope back into a plain ZIP blob. Throws on wrong password. */
export async function decryptZipBlob(blob: Blob, password: string): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 13) throw new Error("فایل رمزنگاری‌شده معتبر نیست.");
  const magic = new TextDecoder().decode(bytes.slice(0, 8));
  if (magic !== ENC_ZIP_MAGIC) {
    throw new Error("این فایل رمزنگاری‌شده معتبر نیست.");
  }
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false);
  if (12 + headerLen > bytes.length) {
    throw new Error("سرآیند فایل رمزنگاری‌شده آسیب دیده است.");
  }
  let header: { salt: string; iv: string };
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + headerLen)));
  } catch {
    throw new Error("سرآیند فایل رمزنگاری‌شده آسیب دیده است.");
  }
  const key = await deriveAesKey(password, b64ToBuf(header.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(header.iv) as unknown as BufferSource },
      key,
      bytes.slice(12 + headerLen) as unknown as BufferSource,
    );
  } catch {
    throw new Error("رمز عبور نادرست است یا فایل آسیب دیده است.");
  }
  return new Blob([plain], { type: "application/zip" });
}

/* ------------------------------ file sniffing ----------------------------- */

export type BackupFileKind = "enc-zip" | "zip" | "json" | "unknown";

/** Detect what a picked file is, from its first bytes (no full read). */
export async function sniffBackupFile(file: Blob): Promise<BackupFileKind> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const ascii = Array.from(head, (b) => String.fromCharCode(b)).join("");
  if (ascii === ENC_ZIP_MAGIC) return "enc-zip";
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip";
  if (ascii.trimStart().startsWith("{")) return "json";
  return "unknown";
}

/* ------------------------------ parse (import) ---------------------------- */

export interface ParseOptions {
  onProgress?: (p: BackupProgress) => void;
}

/**
 * Read and fully validate a ZIP backup. Nothing here touches the database —
 * the caller only gets data back once every check has passed.
 */
export async function parseZipBackup(
  zipBlob: Blob,
  opts: ParseOptions = {},
): Promise<ParsedZipBackup> {
  const onProgress = opts.onProgress;
  onProgress?.({ phase: "validating", percent: 2 });
  const { default: JSZip } = await import("jszip");
  // Hand JSZip raw bytes — universally supported (browser + node).
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
  let manifest: ZipManifest;
  try {
    manifest = JSON.parse(await manifestEntry.async("string"));
  } catch {
    throw new Error("manifest.json قابل خواندن نیست.");
  }
  if ((manifest.format as string) === ACC_ZIP_FORMAT_LITERAL) {
    throw new Error(
      "این ZIP پشتیبان بخش حسابداری است — برای بازیابی آن به بخش حسابداری › پشتیبان و تنظیمات بروید.",
    );
  }
  if (manifest.format !== ZIP_BACKUP_FORMAT) {
    throw new Error("این ZIP یک پشتیبان کامل E-managment نیست.");
  }
  if (manifest.version > ZIP_BACKUP_VERSION) {
    throw new Error(
      `این پشتیبان با نسخه جدیدتری از برنامه ساخته شده (نسخه ${manifest.version}) و قابل بازیابی نیست — اول برنامه را به‌روزرسانی کنید.`,
    );
  }

  // ---- checksums ----------------------------------------------------------
  const sumsEntry = loaded.file(CHECKSUMS_PATH);
  if (!sumsEntry) {
    throw new Error("فایل checksums.json در بایگانی پیدا نشد — صحت داده‌ها قابل تأیید نیست.");
  }
  let sums: ChecksumsFile;
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
  let payload: ZipDatabasePayload;
  try {
    payload = JSON.parse(dbJson);
  } catch {
    throw new Error("data/database.json قابل خواندن نیست.");
  }
  if (payload.format !== BACKUP_FORMAT || !payload.data) {
    throw new Error("ساختار داده‌های بایگانی معتبر نیست.");
  }
  if (payload.schemaVersion > db.verno) {
    throw new Error(
      "این پشتیبان با نسخه جدیدتری از ساختار داده ساخته شده — اول برنامه را به‌روزرسانی کنید.",
    );
  }

  // ---- counts & duplicate ids ---------------------------------------------
  const recordTableKeys = [
    "representatives",
    "customers",
    "requests",
    "lists",
    "payments",
    "tags",
    "visaTypes",
    "customFields",
    "docTypes",
    "activities",
  ] as const;
  for (const key of recordTableKeys) {
    const rows = (payload.data[key] ?? []) as { id: string }[];
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

  // ---- attachments: metadata ↔ bytes --------------------------------------
  const metas = payload.data.attachments ?? [];
  if (manifest.counts.attachments != null && metas.length !== manifest.counts.attachments) {
    throw new Error("تعداد پیوست‌ها با manifest نمی‌خواند — بایگانی ناقص است.");
  }
  const metaById = new Map<string, AttachmentMeta>();
  for (const m of metas) {
    if (!m || typeof m.id !== "string" || typeof m.size !== "number" || !m.mime) {
      throw new Error("متادیتای یک پیوست نامعتبر است.");
    }
    if (metaById.has(m.id)) throw new Error("شناسه پیوست تکراری در بایگانی.");
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
      throw new Error(`فایل پیوست بدون متادیتا در بایگانی: ${id}`);
    }
    const entry = loaded.file(entryName);
    if (!entry) continue;
    const bytes = new Uint8Array(await entry.async("uint8array"));
    totalBytes += bytes.length;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("حجم باز شدهٔ بایگانی بیش از حد مجاز است.");
    }
    if ((await sha256Hex(bytes)) !== sums.files[entryName]) {
      throw new Error(`فایل پیوست «${meta.name}» با چک‌سام نمی‌خواند — خراب یا دستکاری شده است.`);
    }
    if (bytes.length !== meta.size) {
      throw new Error(`حجم فایل پیوست «${meta.name}» با متادیتا نمی‌خواند.`);
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
      `این بایگانی ناقص است — ${missing} فایل پیوست کم دارد. از نسخهٔ سالم پشتیبان استفاده کنید.`,
    );
  }

  // ---- referential notes (non-fatal) --------------------------------------
  const customerIds = new Set(payload.data.customers.map((c) => c.id));
  const paymentIds = new Set(payload.data.payments.map((p) => p.id));
  const dangling = metas.filter(
    (m) =>
      (m.customerId && !customerIds.has(m.customerId)) ||
      (m.paymentId && !paymentIds.has(m.paymentId)),
  ).length;
  if (dangling > 0) {
    warnings.push(
      `${dangling} پیوست به مشتری/پرداختی اشاره می‌کند که در این پشتیبان نیست (مثلاً حذف‌شده) — خود فایل‌ها محفوظ می‌مانند.`,
    );
  }
  // Profile-specific document slots (AI-created) whose customer is missing
  // from this archive — they restore silently and only reappear if that
  // customer is ever restored too; nothing is lost either way.
  const orphanSlots = (payload.data.docTypes ?? []).filter(
    (d) => d.customerId && !customerIds.has(d.customerId),
  ).length;
  if (orphanSlots > 0) {
    warnings.push(
      `${orphanSlots} بخش مدارک مخصوص یک مشتری است که در این پشتیبان نیست — با بازگردانی مشتری دوباره نمایان می‌شود.`,
    );
  }

  onProgress?.({ phase: "validating", percent: 75 });
  return { manifest, backup: payload, assets, warnings };
}

/* ------------------------------ unified facade ---------------------------- */

export type AnyBackup =
  | { kind: "zip"; parsed: ParsedZipBackup }
  | { kind: "legacy"; backup: BackupFile };

/**
 * Entry point for the restore screen: accepts the new ZIP backup (plain or
 * encrypted) and the legacy JSON backup (plain or encrypted).
 * Throws Error("ENCRYPTED") when a password is required.
 */
export async function readAnyBackupFile(
  file: Blob,
  password?: string,
): Promise<AnyBackup> {
  const kind = await sniffBackupFile(file);
  if (kind === "enc-zip") {
    if (!password) throw new Error("ENCRYPTED");
    const zip = await decryptZipBlob(file, password);
    return { kind: "zip", parsed: await parseZipBackup(zip) };
  }
  if (kind === "zip") {
    return { kind: "zip", parsed: await parseZipBackup(file) };
  }
  if (kind === "json") {
    const { readBackupFile } = await import("./backup");
    const asFile =
      file instanceof File
        ? file
        : new File([file], "backup.json", { type: "application/json" });
    return { kind: "legacy", backup: await readBackupFile(asFile, password) };
  }
  throw new Error(
    "فایل انتخاب‌شده پشتیبان معتبری نیست — ZIP جدید، ZIP رمزنگاری‌شده یا JSON قدیمی را انتخاب کنید.",
  );
}

export interface UnifiedPreview {
  kind: "zip" | "legacy";
  counts: Record<string, number>;
  /** ZIP only; legacy JSON never carries attachments. */
  attachments: { count: number; bytes: number } | null;
  duplicates: number;
  existingCounts: Record<string, number>;
  warnings: string[];
}

export async function buildUnifiedPreview(b: AnyBackup): Promise<UnifiedPreview> {
  if (b.kind === "zip") {
    const { manifest, backup, warnings: parseWarnings } = b.parsed;
    const existingCounts: Record<string, number> = {};
    let duplicates = 0;
    for (const key of UPSERT_TABLE_KEYS) {
      const table = db[key] as AnyTable;
      const rows = (await table.toArray()) as { id: string }[];
      existingCounts[key] = rows.length;
      const ids = new Set(rows.map((r) => r.id));
      duplicates += (backup.data[key] as { id: string }[]).filter((r) =>
        ids.has(r.id),
      ).length;
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
      attachments: { ...manifest.attachments },
      duplicates,
      existingCounts,
      warnings,
    };
  }

  // Legacy JSON
  const { buildRestorePreview } = await import("./backup");
  const preview = await buildRestorePreview(b.backup);
  const warnings = [...preview.warnings];
  warnings.push(
    "پشتیبان‌های JSON قدیمی تصاویر و پیوست‌ها را شامل نمی‌شوند — تصاویر فقط در پشتیبان کامل ZIP موجودند.",
  );
  return {
    kind: "legacy",
    counts: b.backup.counts,
    attachments: null,
    duplicates: preview.duplicates,
    existingCounts: preview.existingCounts,
    warnings,
  };
}

export type RestoreMode = "merge" | "replace";

export interface UnifiedRestoreResult {
  inserted: number;
  updated: number;
  attachments: number;
}

/** Apply any recognized backup. Zip = full restore incl. attachments. */
export async function applyAnyRestore(
  b: AnyBackup,
  mode: RestoreMode,
  onProgress?: (p: BackupProgress) => void,
): Promise<UnifiedRestoreResult> {
  if (b.kind === "legacy") {
    const { applyRestore } = await import("./backup");
    onProgress?.({ phase: "writing", percent: 50 });
    const r = await applyRestore(b.backup, mode);
    onProgress?.({ phase: "done", percent: 100 });
    return { ...r, attachments: 0 };
  }
  return applyZipRestore(b.parsed, mode, onProgress);
}

/* --------------------------- apply (zip restore) -------------------------- */

interface TableSnapshot {
  entries: { table: AnyTable; rows: unknown[] }[];
}

async function snapshotTables(tables: AnyTable[]): Promise<TableSnapshot> {
  const entries: TableSnapshot["entries"] = [];
  for (const table of tables) {
    entries.push({ table, rows: await table.toArray() });
  }
  return { entries };
}

async function rollbackSnapshot(snap: TableSnapshot): Promise<void> {
  const tables = snap.entries.map((e) => e.table);
  await db.transaction("rw", tables, async () => {
    for (const t of tables) await t.clear();
    for (const e of snap.entries) {
      if (e.rows.length) await e.table.bulkPut(e.rows as never[]);
    }
  });
}

/**
 * Restore a validated ZIP backup.
 *
 * Atomicity: all writes run in ONE Dexie transaction — any error aborts and
 * leaves the database untouched. A pre-apply in-memory snapshot is kept as a
 * safety net: if the post-apply verification still fails, the snapshot is
 * written back so the app is never left half-restored.
 */
export async function applyZipRestore(
  parsed: ParsedZipBackup,
  mode: RestoreMode,
  onProgress?: (p: BackupProgress) => void,
): Promise<UnifiedRestoreResult> {
  const d = parsed.backup.data;
  const restoreAi = Array.isArray(d.aiWorkers);
  const tables: AnyTable[] = restoreAi
    ? [...RESTORE_TABLES, db.aiWorkers, db.aiMeta]
    : [...RESTORE_TABLES];

  // Safety snapshot of everything we are about to touch.
  const snap = await snapshotTables(tables);

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
      await upsert(db.representatives, d.representatives);
      await upsert(db.customers, d.customers);
      await upsert(db.requests, d.requests);
      await upsert(db.lists, d.lists);
      await upsert(db.payments, d.payments);
      await upsert(db.tags, d.tags);
      await upsert(db.visaTypes, d.visaTypes);
      await upsert(db.customFields, d.customFields);
      if (d.docTypes?.length) await upsert(db.docTypes, d.docTypes);
      if (d.activities?.length) await db.activities.bulkPut(d.activities as never[]);
      if (d.preferences) await db.preferences.put(d.preferences);

      // Attachments — metadata + verified bytes reunited by id.
      for (const meta of d.attachments ?? []) {
        const blob = parsed.assets.get(meta.id);
        if (!blob) throw new Error(`فایل پیوست «${meta.name}» در بایگانی نیست.`);
        await db.attachments.put({ ...meta, blob } as never);
      }

      if (restoreAi) {
        for (const w of d.aiWorkers ?? []) await db.aiWorkers.put(w as never);
        if (d.aiMeta) await db.aiMeta.put(d.aiMeta as never);
      }
    });

    // Post-apply verification: every backed-up id must exist, attachment
    // sizes must match. (Counts only — bytes were SHA-256-verified at parse.)
    onProgress?.({ phase: "verifying", percent: 90 });
    const checkIds = async (table: AnyTable, records: { id: string }[]) => {
      if (!records.length) return;
      const got = (await table.bulkGet(records.map((r) => r.id))) as (
        | { id: string }
        | undefined
      )[];
      if (got.some((g) => g == null)) {
        throw new Error("تأیید نهایی بازیابی ناموفق بود — برخی رکوردها ثبت نشدند.");
      }
    };
    for (const key of UPSERT_TABLE_KEYS) {
      await checkIds(db[key] as AnyTable, d[key] as { id: string }[]);
    }
    for (const meta of d.attachments ?? []) {
      const row = (await db.attachments.get(meta.id)) as Attachment | undefined;
      if (!row || row.size !== meta.size) {
        throw new Error("تأیید نهایی پیوست‌ها ناموفق بود.");
      }
    }
  } catch (e) {
    // The transaction itself is atomic; this covers post-commit verification
    // failures and any unexpected error path — restore the pre-apply state.
    try {
      await rollbackSnapshot(snap);
    } catch {
      /* keep the original error */
    }
    throw e;
  }

  try {
    await logActivity({
      type: "restore",
      entity: "backup",
      title:
        mode === "replace"
          ? "بازیابی کامل از پشتیبان ZIP انجام شد"
          : "بازیابی ادغامی از پشتیبان ZIP انجام شد",
      detail: `${inserted} رکورد جدید، ${updated} به‌روزرسانی، ${d.attachments?.length ?? 0} پیوست`,
    });
  } catch {
    /* activity log is best-effort */
  }

  onProgress?.({ phase: "done", percent: 100 });
  return { inserted, updated, attachments: d.attachments?.length ?? 0 };
}
