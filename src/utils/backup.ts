import { db } from "../db/schema";
import type {
  BackupFile,
  Customer,
  EncryptedBackup,
} from "../types";
import { customerFullName } from "../db/customers";
import { downloadBlob } from "./export/tabular";

export const BACKUP_VERSION = 1;
export const BACKUP_FORMAT = "2customer-backup";
export const ENCRYPTED_FORMAT = "2customer-encrypted-backup";

/** Full JSON backup of every table except attachments (by design). */
export async function buildBackup(): Promise<BackupFile> {
  const [
    representatives,
    customers,
    requests,
    lists,
    payments,
    tags,
    visaTypes,
    customFields,
    docTypes,
    activities,
    preferences,
  ] = await Promise.all([
    db.representatives.toArray(),
    db.customers.toArray(),
    db.requests.toArray(),
    db.lists.toArray(),
    db.payments.toArray(),
    db.tags.toArray(),
    db.visaTypes.toArray(),
    db.customFields.toArray(),
    db.docTypes.toArray(),
    db.activities.orderBy("ts").reverse().limit(800).toArray(),
    db.preferences.get("app"),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    schemaVersion: db.verno,
    counts: {
      representatives: representatives.length,
      customers: customers.length,
      requests: requests.length,
      lists: lists.length,
      payments: payments.length,
      tags: tags.length,
      visaTypes: visaTypes.length,
      customFields: customFields.length,
      docTypes: docTypes.length,
      activities: activities.length,
    },
    data: {
      representatives,
      customers,
      requests,
      lists,
      payments,
      tags,
      visaTypes,
      customFields,
      docTypes,
      activities,
      preferences: preferences ?? null,
    },
  };
}

/* --------------------------- AES-GCM encryption --------------------------- */

const ITERATIONS = 150_000;

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(backup: BackupFile, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plaintext,
  );
  return {
    format: ENCRYPTED_FORMAT,
    version: BACKUP_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    data: bufToB64(cipher),
    exportedAt: backup.exportedAt,
  };
}

export async function decryptBackup(file: EncryptedBackup, password: string): Promise<BackupFile> {
  const key = await deriveKey(password, b64ToBuf(file.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(file.iv) as unknown as BufferSource },
      key,
      b64ToBuf(file.data) as unknown as BufferSource,
    );
  } catch {
    throw new Error("رمز عبور نادرست است یا فایل آسیب دیده است.");
  }
  return JSON.parse(new TextDecoder().decode(plain)) as BackupFile;
}

/* ------------------------------ Restore flow ------------------------------ */

export interface RestorePreview {
  backup: BackupFile;
  duplicates: number;
  existingCounts: Record<string, number>;
  warnings: string[];
}

/** Read a backup file (plain or encrypted). */
export async function readBackupFile(file: File, password?: string): Promise<BackupFile> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("فایل انتخاب‌شده یک فایل JSON معتبر نیست.");
  }
  const obj = parsed as { format?: string };
  if (obj?.format === ENCRYPTED_FORMAT) {
    if (!password) throw new Error("ENCRYPTED");
    return decryptBackup(parsed as EncryptedBackup, password);
  }
  if (obj?.format !== BACKUP_FORMAT) {
    throw new Error("این فایل یک فایل پشتیبان E-managment نیست.");
  }
  const backup = parsed as BackupFile;
  if (backup.version > BACKUP_VERSION) {
    throw new Error(
      `این پشتیبان با نسخه جدیدتری از برنامه ساخته شده (نسخه ${backup.version}) و قابل بازیابی نیست.`,
    );
  }
  if (!backup.data) throw new Error("ساختار فایل پشتیبان نامعتبر است.");
  return backup;
}

export async function buildRestorePreview(backup: BackupFile): Promise<RestorePreview> {
  const existingCounts: Record<string, number> = {
    representatives: await db.representatives.count(),
    customers: await db.customers.count(),
    requests: await db.requests.count(),
    lists: await db.lists.count(),
    payments: await db.payments.count(),
    tags: await db.tags.count(),
    visaTypes: await db.visaTypes.count(),
    customFields: await db.customFields.count(),
  };
  const d = backup.data;
  const existingIds = async (
    table:
      | "representatives"
      | "customers"
      | "requests"
      | "lists"
      | "payments"
      | "tags"
      | "visaTypes"
      | "customFields",
  ): Promise<Set<string>> => {
    const rows = await db[table].toArray();
    return new Set(rows.map((r) => (r as { id: string }).id));
  };

  let duplicates = 0;
  for (const key of [
    "representatives",
    "customers",
    "requests",
    "lists",
    "payments",
    "tags",
    "visaTypes",
    "customFields",
  ] as const) {
    const ids = await existingIds(key);
    duplicates += d[key].filter((r) => ids.has((r as { id: string }).id)).length;
  }

  const warnings: string[] = [];
  if (backup.schemaVersion > db.verno) {
    warnings.push("این پشتیبان با نسخه جدیدتری از ساختار داده ساخته شده است.");
  }

  return { backup, duplicates, existingCounts, warnings };
}

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  inserted: number;
  updated: number;
}

/** Apply a backup. Merge = upsert by id (backup wins). Replace = wipe first. */
export async function applyRestore(backup: BackupFile, mode: RestoreMode): Promise<RestoreResult> {
  const d = backup.data;
  let inserted = 0;
  let updated = 0;

  await db.transaction(
    "rw",
    [
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
    ],
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.representatives.clear(),
          db.customers.clear(),
          db.requests.clear(),
          db.lists.clear(),
          db.payments.clear(),
          db.tags.clear(),
          db.visaTypes.clear(),
          db.customFields.clear(),
          db.docTypes.clear(),
          db.activities.clear(),
          db.preferences.clear(),
        ]);
      }

      const upsert = async (
        table:
          | typeof db.representatives
          | typeof db.customers
          | typeof db.requests
          | typeof db.lists
          | typeof db.payments
          | typeof db.tags
          | typeof db.visaTypes
          | typeof db.customFields,
        records: { id: string }[],
      ) => {
        for (const rec of records) {
          const exists = (await table.get(rec.id)) != null;
          exists ? updated++ : inserted++;
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
      if (d.docTypes?.length) {
        for (const dt of d.docTypes) {
          const exists = (await db.docTypes.get(dt.id)) != null;
          exists ? updated++ : inserted++;
          await db.docTypes.put(dt);
        }
      }

      if (d.activities?.length) {
        await db.activities.bulkPut(d.activities);
      }
      if (d.preferences) {
        await db.preferences.put(d.preferences);
      }
    },
  );

  return { inserted, updated };
}

/* --------------------------- Attachments archive -------------------------- */

/** ZIP archive of all document attachments, organized per customer. */
export async function buildAttachmentsZip(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const attachments = await db.attachments.toArray();
  if (attachments.length === 0) throw new Error("هیچ پیوستی برای بایگانی وجود ندارد.");
  const customers = await db.customers.toArray();
  const nameById = new Map(customers.map((c) => [c.id, customerFullName(c)]));

  const zip = new JSZip();
  const payments = await db.payments.toArray();
  const repNames = new Map((await db.representatives.toArray()).map((r) => [r.id, r.name]));
  for (const att of attachments) {
    let folder;
    if (att.paymentId) {
      // Receipt photo → its own folder next to the customer documents.
      const pay = payments.find((p) => p.id === att.paymentId);
      folder = zip.folder(
        `رسید-پرداخت‌ها/${(repNames.get(pay?.representativeId ?? "") ?? "نماینده-نامشخص").replace(
          /[\\/:*?"<>|]/g,
          "-",
        )}`,
      );
    } else {
      folder = zip.folder(
        `${(nameById.get(att.customerId ?? "") ?? "مشتری-نامشخص").replace(/[\\/:*?"<>|]/g, "-")} (${
          att.customerId ? att.customerId.slice(0, 8) : "—"
        })`,
      );
    }
    const ext = att.name.includes(".") ? "" : guessExt(att.mime);
    folder?.file(`${att.kind}-${att.name}${ext}`, att.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
    onProgress?.(Math.round(meta.percent));
  });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `customer2-attachments-${stamp}.zip`);
}

function guessExt(mime: string): string {
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("pdf")) return ".pdf";
  return "";
}

/** Quick stats for the backup screen. */
export async function getStorageStats(): Promise<{
  tableCounts: Record<string, number>;
  attachments: { count: number; bytes: number };
}> {
  const [reps, customers, requests, lists, payments, tags, visaTypes, customFields, activities] =
    await Promise.all([
      db.representatives.count(),
      db.customers.count(),
      db.requests.count(),
      db.lists.count(),
      db.payments.count(),
      db.tags.count(),
      db.visaTypes.count(),
      db.customFields.count(),
      db.activities.count(),
    ]);
  const atts = await db.attachments.toArray();
  return {
    tableCounts: {
      representatives: reps,
      customers,
      requests,
      lists,
      payments,
      tags,
      visaTypes,
      customFields,
      activities,
      attachments: atts.length,
    },
    attachments: { count: atts.length, bytes: atts.reduce((s, a) => s + a.size, 0) },
  };
}

export function exportBackupFile(backup: BackupFile): void {
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10);
  const json = JSON.stringify(backup, null, 2);
  downloadBlob(
    new Blob([json], { type: "application/json" }),
    `customer2-backup-${stamp}.json`,
  );
  try {
    localStorage.setItem("customer2-last-backup", String(Date.now()));
  } catch {
    /* ignore */
  }
}

export type { Customer };
