/**
 * PDF template storage — Dexie table v4. Templates hold the operator's own
 * visa-application PDFs + their field mappings. They are intentionally NOT
 * part of JSON backups (they are re-creatable and may be large); the
 * attachments ZIP archive is the right vehicle for them.
 */
import { db } from "../../db/schema";
import { uid } from "../../utils/id";
import type { PdfTemplate } from "./fill";

export async function listTemplates(): Promise<PdfTemplate[]> {
  const all = await db.table("pdfTemplates").toArray();
  return (all as PdfTemplate[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveTemplate(t: PdfTemplate): Promise<void> {
  await db.table("pdfTemplates").put({ ...t, updatedAt: Date.now() });
}

export async function createTemplate(
  name: string,
  file: Uint8Array,
  fileName: string,
  kind: PdfTemplate["kind"],
  pageCount: number,
  mappings: PdfTemplate["mappings"],
): Promise<PdfTemplate> {
  const t: PdfTemplate = {
    id: uid(),
    name,
    kind,
    file,
    fileName,
    pageCount,
    mappings,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveTemplate(t);
  return t;
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.table("pdfTemplates").delete(id);
}

export async function getTemplate(id: string): Promise<PdfTemplate | undefined> {
  return (await db.table("pdfTemplates").get(id)) as PdfTemplate | undefined;
}
