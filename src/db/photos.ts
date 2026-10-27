/**
 * Round profile photos for customers and representatives.
 *
 * Any picked image is square-cropped (center), downscaled to 256×256 and
 * stored as a compact JPEG data URL directly on the record — small enough
 * to live inside the JSON backup, so photos survive backup/restore.
 */

import { db } from "./schema";
import { logActivity } from "./activities";

/** Largest accepted source file (photos are re-encoded anyway). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const PHOTO_SIZE = 256;
const PHOTO_QUALITY = 0.85;

/** Center-crop any bitmap to a square 256×256 JPEG data URL. */
function bitmapToSquareDataUrl(bitmap: ImageBitmap): string {
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

/** Any image file → square-cropped 256×256 JPEG data URL. */
export async function fileToSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return bitmapToSquareDataUrl(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Any image data URL → square-cropped 256×256 JPEG data URL (AI photo target). */
export async function dataUrlToSquareDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return bitmapToSquareDataUrl(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Persian error for an unusable file, or null when it is fine. */
export function validatePhotoFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "فقط فایل عکس (JPG/PNG/WebP) پذیرفته می‌شود.";
  if (file.size > MAX_PHOTO_BYTES) return "حجم عکس بیشتر از ۱۵ مگابایت است.";
  return null;
}

export async function setCustomerPhoto(
  id: string,
  photo: string | null,
  name: string,
): Promise<void> {
  await db.customers.update(id, { photo, updatedAt: Date.now() });
  await logActivity({
    type: "update",
    entity: "customer",
    entityId: id,
    title: photo ? `عکس پروفایل «${name}» ثبت شد` : `عکس پروفایل «${name}» حذف شد`,
  });
}

export async function setRepresentativePhoto(
  id: string,
  photo: string | null,
  name: string,
): Promise<void> {
  await db.representatives.update(id, { photo, updatedAt: Date.now() });
  await logActivity({
    type: "update",
    entity: "representative",
    entityId: id,
    title: photo ? `عکس پروفایل «${name}» ثبت شد` : `عکس پروفایل «${name}» حذف شد`,
  });
}
