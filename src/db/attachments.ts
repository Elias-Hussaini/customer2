import { db } from "./schema";
import type { Attachment } from "../types";
import { uid } from "../utils/id";

/** Decode a data-URL into its bytes (used by the AI document flow). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Downscale large photos before storing so IndexedDB stays lean. */
export async function processImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function saveAttachment(
  customerId: string,
  kind: string,
  file: File,
): Promise<Attachment> {
  const blob = await processImage(file);
  const att: Attachment = {
    id: uid(),
    customerId,
    paymentId: null,
    kind,
    name: file.name || `${kind}.jpg`,
    mime: blob.type || file.type,
    size: blob.size,
    blob: blob instanceof Blob ? blob : new Blob([blob]),
    createdAt: Date.now(),
  };
  await db.attachments.add(att);
  return att;
}

/** Optional receipt photo attached to a payment (customerId stays null). */
export async function saveReceipt(paymentId: string, file: File): Promise<Attachment> {
  const blob = await processImage(file);
  const att: Attachment = {
    id: uid(),
    customerId: null,
    paymentId,
    kind: "receipt",
    name: file.name || "رسید.jpg",
    mime: blob.type || file.type,
    size: blob.size,
    blob: blob instanceof Blob ? blob : new Blob([blob]),
    createdAt: Date.now(),
  };
  await db.attachments.add(att);
  return att;
}

/** The receipt of a payment, if any. */
export async function getReceipt(paymentId: string): Promise<Attachment | undefined> {
  return db.attachments.where("paymentId").equals(paymentId).first();
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.attachments.delete(id);
}

/**
 * Save an already-normalized JPEG data URL (AI pipeline output) as a
 * document attachment — no re-processing, bytes are stored as they come.
 */
export async function saveAttachmentDataUrl(
  customerId: string,
  kind: string,
  dataUrl: string,
  name: string,
): Promise<Attachment> {
  const blob = dataUrlToBlob(dataUrl);
  const att: Attachment = {
    id: uid(),
    customerId,
    paymentId: null,
    kind,
    name,
    mime: blob.type || "image/jpeg",
    size: blob.size,
    blob,
    createdAt: Date.now(),
  };
  await db.attachments.add(att);
  return att;
}

export async function getAttachmentsFor(customerId: string): Promise<Attachment[]> {
  return db.attachments.where("customerId").equals(customerId).sortBy("createdAt");
}

export async function totalAttachmentsSize(): Promise<{ count: number; bytes: number }> {
  const all = await db.attachments.toArray();
  return { count: all.length, bytes: all.reduce((s, a) => s + a.size, 0) };
}
