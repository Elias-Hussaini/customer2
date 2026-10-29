/**
 * Data collection for the Smart Archive: turn a customer scope + content
 * toggles into ArchiveEntry rows (original bytes, never mutated).
 */
import { db } from "../../db/schema";
import { dataUrlToBlob, ISSUED_VISA_KIND } from "../../db/attachments";
import { customerFullName } from "../../db/customers";
import { isoFromDate } from "../jalali";
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
 *
 * Each entry also carries the owner's representative name, passport number
 * and the file date — powering the agent-folder modes and the template tokens.
 */
export async function collectEntries(opts: CollectOptions): Promise<ArchiveEntry[]> {
  const ids = [...new Set(opts.customerIds)];
  if (ids.length === 0) return [];
  const [customers, attachments, docTypes, representatives, employers] = await Promise.all([
    db.customers.bulkGet(ids),
    db.attachments.where("customerId").anyOf(ids).toArray(),
    db.docTypes.toArray(),
    db.representatives.toArray(),
    db.employers.toArray(),
  ]);
  const labelByType = new Map(docTypes.map((d) => [d.id, d.label]));
  const repById = new Map(representatives.map((r) => [r.id, r.name]));
  const employerById = new Map(employers.map((e) => [e.id, e.name]));
  const nameById = new Map<string, string>();
  /** per-customer context (representative / passport) shared by all their files */
  const ctxById = new Map<
    string,
    { name: string; repName: string; passportNo: string; employerName: string }
  >();
  const entries: ArchiveEntry[] = [];

  for (const c of customers) {
    if (!c) continue;
    const name = customerFullName(c).trim() || "بدون نام";
    nameById.set(c.id, name);
    ctxById.set(c.id, {
      name,
      repName: repById.get(c.representativeId ?? "") ?? "",
      passportNo: c.passportNo ?? "",
      employerName: employerById.get(c.employerId ?? "") ?? "",
    });
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
        repName: repById.get(c.representativeId ?? "") ?? "",
        employerName: employerById.get(c.employerId ?? "") ?? "",
        passportNo: c.passportNo ?? "",
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
    const ctx = ctxById.get(a.customerId);
    const customerName = ctx?.name ?? "بدون نام";
    // the date the file was registered — powers {تاریخ}/{سال}/{ماه} tokens
    const dateIso = isoFromDate(new Date(a.createdAt));
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
        repName: ctx?.repName ?? "",
        employerName: ctx?.employerName ?? "",
        passportNo: ctx?.passportNo ?? "",
        dateIso,
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
        repName: ctx?.repName ?? "",
        employerName: ctx?.employerName ?? "",
        passportNo: ctx?.passportNo ?? "",
        dateIso,
      });
    }
  }
  return entries;
}
