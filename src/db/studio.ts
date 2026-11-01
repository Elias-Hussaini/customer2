import { db } from "./schema";
import { logActivity } from "./activities";
import { uid } from "../utils/id";
import type { StudioFolder, StudioImage } from "../types";

// Domain types live in types/index.ts (single source of truth for backups);
// re-exported here for the `import("../db/studio")` type references.
export type { StudioFolder, StudioImage, StudioImageMeta } from "../types";

/**
 * ابزار عکس (Image Studio) — the in-app organized save system.
 *
 * Instead of downloading edited images to the OS, everything can live here:
 * named folders (created/renamed/deleted by the user) and the saved images
 * inside them — editable, movable, re-openable in the editor, downloadable
 * (single, whole-folder ZIP, or straight into an OS folder on Chrome).
 *
 * Bytes are stored exactly as the editor produced them (the user explicitly
 * chose format + quality there) — the background at-rest compressor does NOT
 * touch this table.
 */

/* ------------------------------- Folders ---------------------------------- */

export async function createFolder(name: string): Promise<StudioFolder> {
  const clean = name.trim();
  if (!clean) throw new Error("نام پوشه الزامی است.");
  const dupe = (await db.studioFolders.toArray()).find((f) => f.name.trim() === clean);
  if (dupe) throw new Error("پوشه‌ای با این نام وجود دارد.");
  const now = Date.now();
  const folder: StudioFolder = { id: uid(), name: clean, createdAt: now, updatedAt: now };
  await db.studioFolders.add(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("نام پوشه الزامی است.");
  const dupe = (await db.studioFolders.toArray()).find((f) => f.id !== id && f.name.trim() === clean);
  if (dupe) throw new Error("پوشه‌ای با این نام وجود دارد.");
  await db.studioFolders.update(id, { name: clean, updatedAt: Date.now() });
}

/** Delete a folder — its images survive and become «سایر» (unfiled). */
export async function deleteFolder(id: string): Promise<void> {
  await db.transaction("rw", db.studioFolders, db.studioImages, async () => {
    await db.studioFolders.delete(id);
    const inside = await db.studioImages.where("folderId").equals(id).toArray();
    if (inside.length > 0) {
      await db.studioImages.bulkPut(
        inside.map((img) => ({ ...img, folderId: null, updatedAt: Date.now() })),
      );
    }
  });
}

/* -------------------------------- Images ---------------------------------- */

export async function saveStudioImage(input: {
  folderId: string | null;
  name: string;
  mime: string;
  blob: Blob;
  width: number;
  height: number;
}): Promise<StudioImage> {
  const now = Date.now();
  const image: StudioImage = {
    id: uid(),
    folderId: input.folderId ?? null,
    name: input.name.trim() || "تصویر",
    mime: input.mime,
    size: input.blob.size,
    blob: input.blob,
    width: input.width,
    height: input.height,
    createdAt: now,
    updatedAt: now,
  };
  await db.studioImages.add(image);
  await logActivity({
    type: "create",
    entity: "settings",
    entityId: image.id,
    title: `تصویر «${image.name}» در ابزار عکس ذخیره شد`,
    detail: input.folderId ? undefined : "پوشه: سایر",
  });
  return image;
}

export async function renameImage(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("نام تصویر الزامی است.");
  await db.studioImages.update(id, { name: clean, updatedAt: Date.now() });
}

export async function moveImage(id: string, folderId: string | null): Promise<void> {
  await db.studioImages.update(id, { folderId, updatedAt: Date.now() });
}

export async function setImageNote(id: string, note: string): Promise<void> {
  await db.studioImages.update(id, { note: note.trim() || undefined, updatedAt: Date.now() });
}

export async function deleteImage(id: string): Promise<void> {
  await db.studioImages.delete(id);
}

/** Replace the bytes of a library image in place (re-opened + re-edited). */
export async function replaceStudioImage(
  id: string,
  next: { blob: Blob; mime: string; width: number; height: number },
): Promise<void> {
  await db.studioImages.update(id, {
    blob: next.blob,
    mime: next.mime,
    size: next.blob.size,
    width: next.width,
    height: next.height,
    updatedAt: Date.now(),
  });
}

/* -------------------------------- Queries --------------------------------- */

export async function getFolders(): Promise<StudioFolder[]> {
  return db.studioFolders.orderBy("createdAt").toArray();
}

export async function getAllImages(): Promise<StudioImage[]> {
  return db.studioImages.orderBy("createdAt").reverse().toArray();
}

export async function getImagesInFolder(folderId: string | null): Promise<StudioImage[]> {
  const all = await db.studioImages.toArray();
  return all
    .filter((img) => (folderId == null ? img.folderId == null : img.folderId === folderId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getStudioStats(images: StudioImage[]): {
  count: number;
  bytes: number;
} {
  return { count: images.length, bytes: images.reduce((s, i) => s + i.size, 0) };
}
