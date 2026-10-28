/**
 * Accounting backup & restore — LEGACY JSON path.
 *
 * The complete system lives in zipbackup.ts (single ZIP with every record +
 * every document FILE + settings + checksums, optional AES-GCM password,
 * verified atomic restore). This module keeps the legacy JSON export/import
 * working for compatibility: metadata only, no document files.
 */

import { db } from "../db/schema";
import { logActivity } from "../db/activities";
import { downloadBlob } from "../utils/export/tabular";
import type { AccBackupData, AccBackupFile, AccDoc, AccParty, FinAccount, FinTransaction, OutstandingItem } from "./types";

export const ACC_BACKUP_VERSION = 1;
export const ACC_BACKUP_FORMAT = "emanagement-acc-backup";

/** Collect all accounting data (documents as metadata only). */
export async function buildAccBackupData(): Promise<AccBackupData> {
  const [parties, accounts, transactions, outstanding, docs, settings] = await Promise.all([
    db.accParties.toArray(),
    db.accAccounts.toArray(),
    db.accTransactions.orderBy("date").toArray(),
    db.accOutstanding.toArray(),
    db.accDocs.orderBy("createdAt").toArray(),
    db.accMeta.get("acc"),
  ]);
  const docsMeta = docs.map(({ blob: _blob, ...meta }) => meta);
  return { parties, accounts, transactions, outstanding, docsMeta, settings: settings ?? null };
}

export async function buildAccBackup(): Promise<AccBackupFile> {
  const data = await buildAccBackupData();
  return {
    format: ACC_BACKUP_FORMAT,
    version: ACC_BACKUP_VERSION,
    exportedAt: Date.now(),
    schemaVersion: db.verno,
    counts: {
      parties: data.parties.length,
      accounts: data.accounts.length,
      transactions: data.transactions.length,
      outstanding: data.outstanding.length,
      docs: data.docsMeta.length,
    },
    data,
  };
}

export function exportAccBackupFile(backup: AccBackupFile): void {
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10);
  downloadBlob(
    new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    `emanagement-acc-backup-${stamp}.json`,
  );
}

/* ------------------------------ Restore flow ------------------------------ */

export interface AccRestorePreview {
  backup: AccBackupFile;
  duplicates: number;
  existingCounts: Record<string, number>;
  warnings: string[];
}

export async function readAccBackupFile(file: File): Promise<AccBackupFile> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("فایل انتخاب‌شده یک JSON معتبر نیست.");
  }
  const obj = parsed as { format?: string };
  if (obj?.format !== ACC_BACKUP_FORMAT) {
    throw new Error("این فایل یک پشتیبان حسابداری E-managment نیست.");
  }
  const backup = parsed as AccBackupFile;
  if (backup.version > ACC_BACKUP_VERSION) {
    throw new Error(`این پشتیبان با نسخه جدیدتری ساخته شده (${backup.version}) و قابل بازیابی نیست.`);
  }
  if (!backup.data) throw new Error("ساختار فایل پشتیبان نامعتبر است.");
  return backup;
}

export async function buildAccRestorePreview(backup: AccBackupFile): Promise<AccRestorePreview> {
  const existingCounts = {
    parties: await db.accParties.count(),
    accounts: await db.accAccounts.count(),
    transactions: await db.accTransactions.count(),
    outstanding: await db.accOutstanding.count(),
  };
  let duplicates = 0;
  for (const [key, table] of [
    ["parties", db.accParties],
    ["accounts", db.accAccounts],
    ["transactions", db.accTransactions],
    ["outstanding", db.accOutstanding],
  ] as const) {
    const ids = new Set((await table.toArray()).map((r) => (r as { id: string }).id));
    duplicates += (backup.data[key] as { id: string }[]).filter((r) => ids.has(r.id)).length;
  }
  const warnings: string[] = [];
  if (backup.schemaVersion > db.verno) {
    warnings.push("این پشتیبان با نسخه جدیدتری از ساختار داده ساخته شده است.");
  }
  warnings.push("پشتیبان JSON قدیمی فقط متادیتای اسناد را دارد — فایل‌های اسناد فقط در پشتیبان کامل ZIP موجودند.");
  return { backup, duplicates, existingCounts, warnings };
}

export type AccRestoreMode = "merge" | "replace";

/** Apply an accounting backup — atomic per table, upsert by id. */
export async function applyAccBackup(
  data: AccBackupData,
  mode: AccRestoreMode,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  await db.transaction(
    "rw",
    [db.accParties, db.accAccounts, db.accTransactions, db.accOutstanding, db.accMeta],
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.accParties.clear(),
          db.accAccounts.clear(),
          db.accTransactions.clear(),
          db.accOutstanding.clear(),
        ]);
      }
      const upsert = async (
        table:
          | typeof db.accParties
          | typeof db.accAccounts
          | typeof db.accTransactions
          | typeof db.accOutstanding,
        records: { id: string }[],
      ) => {
        for (const rec of records) {
          if (mode === "replace") {
            inserted++;
            await table.put(rec as never);
          } else {
            const exists = (await table.get(rec.id)) != null;
            exists ? updated++ : inserted++;
            await table.put(rec as never);
          }
        }
      };
      await upsert(db.accParties, data.parties);
      await upsert(db.accAccounts, data.accounts);
      await upsert(db.accTransactions, data.transactions);
      await upsert(db.accOutstanding, data.outstanding);
      if (data.settings) {
        await db.accMeta.put(data.settings);
      }
    },
  );

  await logActivity({
    type: "restore",
    entity: "accBackup",
    title: mode === "replace" ? "بازیابی کامل حسابداری انجام شد" : "بازیابی ادغامی حسابداری انجام شد",
    detail: `${inserted} رکورد جدید، ${updated} رکورد به‌روزرسانی شد`,
  });
  return { inserted, updated };
}

/* --------------------------- Documents archive ---------------------------- */

/** ZIP archive of all accounting documents, organized per party. */
export async function buildAccDocsZip(
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const docs = await db.accDocs.toArray();
  if (docs.length === 0) throw new Error("هیچ سندی برای بایگانی وجود ندارد.");
  const parties = await db.accParties.toArray();
  const nameById = new Map(parties.map((p) => [p.id, p.name]));
  const zip = new JSZip();
  for (const doc of docs) {
    const partyName = doc.partyId ? nameById.get(doc.partyId) : undefined;
    const folderName = partyName ?? "اسناد عمومی";
    const folder = zip.folder(`اسناد-حسابداری/${folderName.replace(/[\\/:*?"<>|]/g, "-")}`);
    folder?.file(doc.name, doc.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
    onProgress?.(Math.round(meta.percent));
  });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `emanagement-acc-docs-${stamp}.zip`);
}
