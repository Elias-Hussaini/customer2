/**
 * ابزار عکس — the studio library repo: folders, images, moves, in-place
 * replaces, and stats.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  saveStudioImage,
  renameImage,
  moveImage,
  deleteImage,
  replaceStudioImage,
  getImagesInFolder,
  getStudioStats,
} from "../studio";

beforeEach(async () => {
  await db.studioFolders.clear();
  await db.studioImages.clear();
  await db.activities.clear();
});

const imgBlob = (size = 10) => new Blob([new Uint8Array(size)], { type: "image/webp" });

describe("studio folders", () => {
  it("creates, renames and rejects duplicates", async () => {
    const a = await createFolder("پاسپورت‌ها");
    expect(a.name).toBe("پاسپورت‌ها");
    await expect(createFolder("پاسپورت‌ها")).rejects.toThrow(/همین نام|وجود دارد/);
    await renameFolder(a.id, "مدارک سفر");
    expect((await db.studioFolders.get(a.id))?.name).toBe("مدارک سفر");
    const b = await createFolder("پاسپورت‌ها");
    await expect(renameFolder(b.id, "مدارک سفر")).rejects.toThrow();
  });

  it("deleting a folder keeps its images (they become «سایر»)", async () => {
    const f = await createFolder("تست");
    await saveStudioImage({
      folderId: f.id,
      name: "a.webp",
      mime: "image/webp",
      blob: imgBlob(5),
      width: 10,
      height: 10,
    });
    await saveStudioImage({ folderId: null, name: "b.webp", mime: "image/webp", blob: imgBlob(7), width: 8, height: 8 });
    await deleteFolder(f.id);
    const all = await db.studioImages.toArray();
    expect(all.length).toBe(2);
    expect(all.every((i) => i.folderId == null)).toBe(true);
  });
});

describe("studio images", () => {
  it("saves with dims and bytes, renames and moves", async () => {
    const f = await createFolder("الف");
    const img = await saveStudioImage({
      folderId: f.id,
      name: "عکس اول",
      mime: "image/webp",
      blob: imgBlob(42),
      width: 640,
      height: 480,
    });
    expect(img.size).toBe(42);
    expect((await getImagesInFolder(f.id)).length).toBe(1);
    expect((await getImagesInFolder(null)).length).toBe(0);

    await renameImage(img.id, "عکس دوم");
    expect((await db.studioImages.get(img.id))?.name).toBe("عکس دوم");

    await moveImage(img.id, null);
    expect((await db.studioImages.get(img.id))?.folderId).toBeNull();
    expect((await getImagesInFolder(f.id)).length).toBe(0);
  });

  it("replaces bytes in place (re-opened + re-edited)", async () => {
    const img = await saveStudioImage({
      folderId: null,
      name: "x.webp",
      mime: "image/webp",
      blob: imgBlob(10),
      width: 100,
      height: 50,
    });
    const nextBlob = new Blob([new Uint8Array(99)], { type: "image/webp" });
    await replaceStudioImage(img.id, { blob: nextBlob, mime: "image/webp", width: 33, height: 22 });
    const after = await db.studioImages.get(img.id);
    expect(after?.size).toBe(99);
    expect(after?.width).toBe(33);
    expect(after?.height).toBe(22);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(img.updatedAt);
  });

  it("deletes outright", async () => {
    const img = await saveStudioImage({
      folderId: null,
      name: "y",
      mime: "image/webp",
      blob: imgBlob(1),
      width: 2,
      height: 2,
    });
    await deleteImage(img.id);
    expect(await db.studioImages.get(img.id)).toBeUndefined();
  });

  it("stats aggregate count and bytes", async () => {
    await saveStudioImage({ folderId: null, name: "1", mime: "image/webp", blob: imgBlob(3), width: 1, height: 1 });
    await saveStudioImage({ folderId: null, name: "2", mime: "image/webp", blob: imgBlob(4), width: 1, height: 1 });
    const stats = getStudioStats(await db.studioImages.toArray());
    expect(stats).toEqual({ count: 2, bytes: 7 });
  });
});
