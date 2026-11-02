/**
 * Round profile photos for customers and representatives.
 *
 * Any picked image is square-cropped (center), downscaled to 256×256 and
 * stored as a compact JPEG data URL directly on the record — small enough
 * to live inside the JSON backup, so photos survive backup/restore.
 */

import { db } from "./schema";
import { logActivity } from "./activities";
import { getPrefs } from "./prefs";

/** Largest accepted source file (photos are re-encoded anyway). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const PHOTO_SIZE = 256;
const PHOTO_QUALITY = 0.85;

/** Standard profile-photo size — «عرض ۴۰۰، طول ۶۰۰، نسبت آزاد». */
export const PROFILE_PHOTO_W = 400;
export const PROFILE_PHOTO_H = 600;

/** Is the automatic 400×600 profile-photo sizing on? (تنظیمات، default ON) */
export async function profileAutoSizeEnabled(): Promise<boolean> {
  const prefs = await getPrefs();
  return prefs.profilePhotoAutoSize !== false;
}

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

/** Any image file → the stored profile photo: 400×600 exact-stretch when the
 *  auto sizing is on (تنظیمات), the classic square 256×256 when it is off. */
export async function fileToProfilePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return await bitmapToStoredPhoto(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Any image data URL → the stored profile photo (the AI photo target). */
export async function dataUrlToProfilePhoto(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return await bitmapToStoredPhoto(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Route through the settings: 400×600 «نسبت آزاد» or the classic square. */
async function bitmapToStoredPhoto(bitmap: ImageBitmap): Promise<string> {
  return (await profileAutoSizeEnabled())
    ? bitmapToProfileDataUrl(bitmap)
    : bitmapToSquareDataUrl(bitmap);
}

/** Exact W×H stretch onto a white JPEG canvas — the same «نسبت آزاد»
 *  semantics as the editor's resize (both numbers stay exactly as typed). */
function bitmapToProfileDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_PHOTO_W;
  canvas.height = PROFILE_PHOTO_H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PROFILE_PHOTO_W, PROFILE_PHOTO_H);
  ctx.drawImage(bitmap, 0, 0, PROFILE_PHOTO_W, PROFILE_PHOTO_H);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
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

export async function setEmployerPhoto(
  id: string,
  photo: string | null,
  name: string,
): Promise<void> {
  await db.employers.update(id, { photo, updatedAt: Date.now() });
  await logActivity({
    type: "update",
    entity: "employer",
    entityId: id,
    title: photo ? `عکس پروفایل «${name}» ثبت شد` : `عکس پروفایل «${name}» حذف شد`,
  });
}
