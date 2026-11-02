/**
 * ابزار عکس — the studio library repo: folders, images, moves, in-place
 * replaces, and stats.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  childrenOfStudio,
  createFolder,
  deleteFolder,
  isStudioDescendant,
  moveFolder,
  renameFolder,
  deleteImage,
  moveImage,
  replaceStudioImage,
  saveStudioImage,
  renameImage,
  getImagesInFolder,
  getStudioStats,
  studioFolderChain,
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

describe("studio folders — Windows-style hierarchy (round 21)", () => {
  it("nests folders via parentId and childrenOfStudio lists one level, fa-sorted", async () => {
    const root = await createFolder("سفرها");
    const b = await createFolder("مدارک", root.id);
    const a = await createFolder("آلبوم", root.id);
    const deep = await createFolder("صفحه اول", b.id);

    const all = await db.studioFolders.toArray();
    expect(childrenOfStudio(all, null).map((f) => f.id)).toEqual([root.id]);
    expect(childrenOfStudio(all, root.id).map((f) => f.name)).toEqual(["آلبوم", "مدارک"]); // fa sort
    expect(childrenOfStudio(all, b.id).map((f) => f.id)).toEqual([deep.id]);
    expect((await db.studioFolders.get(deep.id))?.parentId).toBe(b.id);
  });

  it("duplicate names only clash inside the SAME level (Windows behavior)", async () => {
    const root = await createFolder("سفرها");
    await createFolder("مدارک", root.id);
    // same name at root → fine; same name inside سفرها → clash
    const other = await createFolder("مدارک");
    expect(other.parentId).toBeNull();
    await expect(createFolder("مدارک", root.id)).rejects.toThrow(/همین سطح/);
  });

  it("builds the breadcrumb chain and detects descendants", async () => {
    const a = await createFolder("الف");
    const b = await createFolder("ب", a.id);
    const c = await createFolder("ج", b.id);
    const all = await db.studioFolders.toArray();

    expect(studioFolderChain(all, c.id).map((f) => f.name)).toEqual(["الف", "ب", "ج"]);
    expect(studioFolderChain(all, null)).toEqual([]);
    expect(isStudioDescendant(all, a.id, c.id)).toBe(true);
    expect(isStudioDescendant(all, c.id, a.id)).toBe(false);
  });

  it("moveFolder nests whole subtrees and refuses cycles", async () => {
    const a = await createFolder("الف");
    const b = await createFolder("ب", a.id);
    const c = await createFolder("ج", b.id);
    const target = await createFolder("مقصد");

    // move a WHOLE subtree (الف → inside ج, which is a's own descendant) → rejected
    await expect(moveFolder(a.id, c.id)).rejects.toThrow(/خودش|زیرپوشه/);
    // moving ج under مقصد is fine
    await moveFolder(c.id, target.id);
    expect((await db.studioFolders.get(c.id))?.parentId).toBe(target.id);
    // ...and الف's chain is untouched
    const all = await db.studioFolders.toArray();
    expect(studioFolderChain(all, b.id).map((f) => f.name)).toEqual(["الف", "ب"]);
    // move to root = null
    await moveFolder(c.id, null);
    expect((await db.studioFolders.get(c.id))?.parentId).toBeNull();
  });

  it("deleting a folder lifts sub-folders UP and unfiles only its OWN images (like lists)", async () => {
    const root = await createFolder("سفرها");
    const kid = await createFolder("مدارک", root.id);
    const grandKid = await createFolder("پاسپورت", kid.id);
    await saveStudioImage({ folderId: kid.id, name: "direct.webp", mime: "image/webp", blob: imgBlob(5), width: 10, height: 10 });
    await saveStudioImage({ folderId: grandKid.id, name: "deep.webp", mime: "image/webp", blob: imgBlob(7), width: 10, height: 10 });

    await deleteFolder(kid.id);

    // پاسپورت climbed to سفرها (its deleted parent's parent)
    expect((await db.studioFolders.get(grandKid.id))?.parentId).toBe(root.id);
    // the image DIRECTLY inside the deleted folder became «سایر»…
    expect((await getImagesInFolder(null)).map((i) => i.name)).toEqual(["direct.webp"]);
    // …while the image inside the surviving sub-folder stayed right there
    expect((await getImagesInFolder(grandKid.id)).map((i) => i.name)).toEqual(["deep.webp"]);
  });

  it("renaming stays sibling-scoped after a move", async () => {
    const r1 = await createFolder("صندوق یک");
    const r2 = await createFolder("صندوق دو");
    const f1 = await createFolder("قراردادها", r1.id);
    const f2 = await createFolder("قراردادها", r2.id);
    // both keep the same name in different levels
    expect(f1.name).toBe(f2.name);
    await createFolder("گواهی", r1.id); // a SIBLING of f1
    await expect(renameFolder(f1.id, "گواهی")).rejects.toThrow(/همین سطح/);
    // the parent's own name (or a root folder's name) is NOT a sibling clash
    await expect(renameFolder(f1.id, "صندوق یک")).resolves.toBeUndefined();
    await renameFolder(f1.id, "عقدد");
    expect((await db.studioFolders.get(f1.id))?.name).toBe("عقدد");
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
