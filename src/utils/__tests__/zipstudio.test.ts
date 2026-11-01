/**
 * ZIP v3 (studio) — round trips for the ابزار عکس library inside the
 * complete-system backup, the v2-preserve rule on replace, and the
 * torn-out-JSON guard for studio images.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db/schema";
import {
  applyZipRestore,
  buildFullZipBackup,
  parseZipBackup,
  type ParsedZipBackup,
} from "../zipbackup";
import { applyRestore, buildBackup } from "../backup";
import type { BackupFile } from "../../types";
import { createFolder, saveStudioImage } from "../../db/studio";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function seedStudio() {
  const f1 = await createFolder("پاسپورت‌ها");
  await createFolder("مدارک اداری");
  await saveStudioImage({
    folderId: f1.id,
    name: "پاسپورت-۱.webp",
    mime: "image/webp",
    blob: new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/webp" }),
    width: 640,
    height: 480,
  });
  await saveStudioImage({
    folderId: null,
    name: "سایر-۱.png",
    mime: "image/png",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    width: 30,
    height: 40,
  });
  return f1.id;
}

describe("studio in the complete ZIP backup", () => {
  it("round trips folders and images byte-for-byte on replace", async () => {
    const folderId = await seedStudio();
    const built = await buildFullZipBackup();
    const parsed: ParsedZipBackup = await parseZipBackup(built.blob);

    expect(parsed.manifest.version).toBe(3);
    expect(parsed.manifest.counts.studioFolders).toBe(2);
    expect(parsed.manifest.counts.studioImages).toBe(2);
    expect(parsed.studioAssets.size).toBe(2);
    expect(parsed.manifest.studioImages.bytes).toBe(7);

    // Wipe the studio tables only, then replace-restore the whole archive.
    await db.studioFolders.clear();
    await db.studioImages.clear();
    await applyZipRestore(parsed, "replace");

    const folders = await db.studioFolders.toArray();
    expect(folders.length).toBe(2);
    const images = await db.studioImages.toArray();
    expect(images.length).toBe(2);

    const filed = images.find((i) => i.name === "پاسپورت-۱.webp")!;
    expect(filed.folderId).toBe(folderId);
    expect(filed.size).toBe(4);
    expect(Array.from(new Uint8Array(await filed.blob.arrayBuffer()))).toEqual([9, 8, 7, 6]);
    const unfiled = images.find((i) => i.name === "سایر-۱.png")!;
    expect(unfiled.folderId).toBeNull();
    expect(unfiled.width).toBe(30);
    expect(unfiled.height).toBe(40);
  });

  it("merge keeps local rows and upserts archive rows", async () => {
    await seedStudio();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);

    // A local-only row survives a merge.
    await saveStudioImage({
      folderId: null,
      name: "فقط-محلی.webp",
      mime: "image/webp",
      blob: new Blob([new Uint8Array([5])], { type: "image/webp" }),
      width: 5,
      height: 5,
    });
    await applyZipRestore(parsed, "merge");
    const names = (await db.studioImages.toArray()).map((i) => i.name).sort();
    expect(names).toEqual(["سایر-۱.png", "فقط-محلی.webp", "پاسپورت-۱.webp"].sort());
  });

  it("replace from a v2-shaped archive does NOT wipe the local studio", async () => {
    await seedStudio();
    const built = await buildFullZipBackup();

    // Rewrite the manifest to look like v2 (strip the studio markers).
    const { default: JSZip } = await import("jszip");
    const raw = await JSZip.loadAsync(built.blob);
    const out = new JSZip();
    const manifestJson = await raw.file("manifest.json")!.async("string");
    const manifest = JSON.parse(manifestJson);
    manifest.version = 2;
    delete manifest.counts.studioFolders;
    delete manifest.counts.studioImages;
    delete manifest.studioImages;
    out.file("manifest.json", JSON.stringify(manifest));
    out.file("data/database.json", await raw.file("data/database.json")!.async("string"));

    // checksums: the v2 archive carries no studio assets, so only the
    // database.json checksum is needed (manifest.json is never hashed).
    const { sha256Hex } = await import("../zipbackup");
    const dbString = await raw.file("data/database.json")!.async("string");
    const files: Record<string, string> = {
      "data/database.json": await sha256Hex(dbString),
    };
    out.file(
      "integrity/checksums.json",
      JSON.stringify({ algorithm: "SHA-256", files }),
    );

    const v2blob = await out.generateAsync({ type: "blob" });
    const parsed = await parseZipBackup(v2blob);
    expect(parsed.manifest.version).toBe(2);

    await applyZipRestore(parsed, "replace");
    // The local studio library is untouched by the v2 replace.
    expect((await db.studioFolders.toArray()).length).toBe(2);
    expect((await db.studioImages.toArray()).length).toBe(2);
  });

  it("legacy JSON restore refuses a database.json torn out of a ZIP (studio images)", async () => {
    await seedStudio();
    const built = await buildFullZipBackup();
    const parsed = await parseZipBackup(built.blob);

    const torn: BackupFile = {
      ...(await buildBackup()),
      data: {
        ...parsed.backup.data,
        attachments: undefined,
        studioImages: parsed.backup.data.studioImages,
      } as BackupFile["data"],
    } as BackupFile;
    // Strip the tables the legacy path cannot carry anyway.
    void torn;
    await expect(applyRestore(torn, "merge")).rejects.toThrow(/ZIP/);
  });
});
