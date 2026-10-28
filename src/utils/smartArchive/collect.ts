/**
 * Data collection for the Smart Archive: turn a customer scope + content
 * toggles into ArchiveEntry rows (original bytes, never mutated).
 */
import { db } from "../../db/schema";
import { dataUrlToBlob, ISSUED_VISA_KIND } from "../../db/attachments";
import { customerFullName } from "../../db/customers";
import type { ArchiveEntry } from "./engine";

export interface CollectOptions {
  /** Customer ids in scope (already resolved by the page filters). */
  customerIds: string[];
  includeDocs: boolean;
  includeIssuedVisas: boolean;
  includeProfilePhotos: boolean;
}

/**
 * Collect every archiveable file of the given customers:
 *  - documents in their document slots (incl. «سایر مدارک»)
 *  - issued-visa files (kind "issuedVisa" — the special slot)
 *  - optionally the profile photo
 * Payment receipts are not customer documents and never included.
 */
export async function collectEntries(opts: CollectOptions): Promise<ArchiveEntry[]> {
  const ids = [...new Set(opts.customerIds)];
  if (ids.length === 0) return [];
  const [customers, attachments, docTypes] = await Promise.all([
    db.customers.bulkGet(ids),
    db.attachments.where("customerId").anyOf(ids).toArray(),
    db.docTypes.toArray(),
  ]);
  const labelByType = new Map(docTypes.map((d) => [d.id, d.label]));
  const nameById = new Map<string, string>();
  const entries: ArchiveEntry[] = [];

  for (const c of customers) {
    if (!c) continue;
    const name = customerFullName(c).trim() || "بدون نام";
    nameById.set(c.id, name);
    if (opts.includeProfilePhotos && c.photo) {
      const blob = dataUrlToBlob(c.photo);
      entries.push({
        id: `photo-${c.id}`,
        blob,
        originalName: "profile.jpg",
        mime: blob.type || "image/jpeg",
        size: blob.size,
        customerId: c.id,
        customerName: name,
        kind: "profilePhoto",
        docTypeId: "profilePhoto",
        docLabel: "پروفایل",
      });
    }
  }

  // stable order: per customer (alphabetical), then document slot, then age
  const sorted = [...attachments].sort(
    (a, b) =>
      (nameById.get(a.customerId ?? "") ?? "").localeCompare(
        nameById.get(b.customerId ?? "") ?? "",
        "fa",
      ) ||
      (a.kind ?? "").localeCompare(b.kind ?? "", "fa") ||
      a.createdAt - b.createdAt,
  );

  for (const a of sorted) {
    if (a.customerId == null) continue;
    const customerName = nameById.get(a.customerId) ?? "بدون نام";
    if (a.kind === ISSUED_VISA_KIND) {
      if (!opts.includeIssuedVisas) continue;
      entries.push({
        id: a.id,
        blob: a.blob,
        originalName: a.name,
        mime: a.mime,
        size: a.size,
        customerId: a.customerId,
        customerName,
        kind: "issuedVisa",
        docTypeId: ISSUED_VISA_KIND,
        docLabel: "ویزا",
      });
    } else if (a.kind === "receipt") {
      continue; // payment receipts are not customer documents
    } else {
      if (!opts.includeDocs) continue;
      entries.push({
        id: a.id,
        blob: a.blob,
        originalName: a.name,
        mime: a.mime,
        size: a.size,
        customerId: a.customerId,
        customerName,
        kind: "doc",
        docTypeId: a.kind,
        docLabel: labelByType.get(a.kind) ?? "مدرک",
      });
    }
  }
  return entries;
}
