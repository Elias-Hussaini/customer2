import { db } from "./schema";
import type { Attachment } from "../types";
import { uid } from "../utils/id";
import { compressImage, type CompressImageResult } from "../utils/imageCompress";

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

/**
 * Back-compat wrapper: any image → a (possibly) much smaller blob.
 * Kept for its two internal call sites and any tests; the richer result
 * (mime/name changes) is consumed directly by the save functions below.
 */
export async function processImage(file: File | Blob): Promise<Blob> {
  return (await compressImage({ blob: file, name: file instanceof File ? file.name : undefined })).blob;
}

/** Shared tail: build the attachment row from a compression result. */
function rowFrom(
  customerId: string | null,
  paymentId: string | null,
  kind: string,
  res: CompressImageResult,
  fallbackName: string,
): Attachment {
  return {
    id: uid(),
    customerId,
    paymentId,
    kind,
    name: res.name || fallbackName,
    mime: res.mime || res.blob.type,
    size: res.blob.size,
    blob: res.blob,
    createdAt: Date.now(),
    // Already optimized at rest — the background pass skips it.
    opt: Date.now(),
  };
}

export async function saveAttachment(
  customerId: string,
  kind: string,
  file: File,
): Promise<Attachment> {
  const res = await compressImage({ blob: file, name: file.name });
  const att = rowFrom(customerId, null, kind, res, file.name || `${kind}.jpg`);
  await db.attachments.add(att);
  return att;
}

/** Optional receipt photo attached to a payment (customerId stays null). */
export async function saveReceipt(paymentId: string, file: File): Promise<Attachment> {
  const res = await compressImage({ blob: file, name: file.name });
  const att = rowFrom(null, paymentId, "receipt", res, file.name || "رسید.jpg");
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
 * document attachment. The bytes pass through the same at-rest compressor,
 * so oversized AI renders shrink to WebP/JPEG without any visible loss.
 */
export async function saveAttachmentDataUrl(
  customerId: string,
  kind: string,
  dataUrl: string,
  name: string,
): Promise<Attachment> {
  const raw = dataUrlToBlob(dataUrl);
  const res = await compressImage({ blob: raw, name, mime: raw.type });
  const att = rowFrom(customerId, null, kind, res, name);
  await db.attachments.add(att);
  return att;
}

export async function getAttachmentsFor(customerId: string): Promise<Attachment[]> {
  return db.attachments.where("customerId").equals(customerId).sortBy("createdAt");
}

/**
 * Rotate a stored image by a multiple of 90° and persist the re-encoded
 * JPEG in place — the fix is permanent, so thumbnails, exports, backups and
 * the AI pipeline all see the rotated image afterwards.
 */
export async function rotateAttachmentImage(att: Attachment, degrees: number): Promise<Attachment> {
  if (!att.mime.startsWith("image/")) throw new Error("not an image");
  const net = ((degrees % 360) + 360) % 360;
  if (net === 0) return att;
  const bitmap = await createImageBitmap(att.blob);
  try {
    const swap = net % 180 === 90;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? bitmap.height : bitmap.width;
    canvas.height = swap ? bitmap.width : bitmap.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((net * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("re-encode failed");
    const name = att.name.replace(/\.(png|webp|gif|bmp|heic|avif|jfif)$/i, ".jpg");
    await db.attachments.update(att.id, { blob, mime: "image/jpeg", size: blob.size, name });
    return { ...att, blob, mime: "image/jpeg", size: blob.size, name };
  } finally {
    bitmap.close();
  }
}

export async function totalAttachmentsSize(): Promise<{ count: number; bytes: number }> {
  const all = await db.attachments.toArray();
  return { count: all.length, bytes: all.reduce((s, a) => s + a.size, 0) };
}
