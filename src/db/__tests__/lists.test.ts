/**
 * لیست‌ها — Windows-style folder hierarchy:
 * nesting, breadcrumbs, cycle-proof moves, cascade-safe deletes.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  buildFolderPath,
  childrenOf,
  createList,
  deleteList,
  isDescendant,
  moveList,
} from "../lists";

beforeEach(async () => {
  await Promise.all([
    db.lists.clear(),
    db.requests.clear(),
    db.customers.clear(),
    db.activities.clear(),
  ]);
});

describe("hierarchy basics", () => {
  it("creates folders at root and nested", async () => {
    const root = await createList({ name: "ویزای دوبی" });
    const child = await createList({ name: "آبان", parentId: root.id });
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);

    const all = await db.lists.toArray();
    expect(childrenOf(all, null).map((l) => l.id)).toEqual([root.id]);
    expect(childrenOf(all, root.id).map((l) => l.id)).toEqual([child.id]);
  });

  it("childrenOf sorts by Persian name and skips archived", async () => {
    const a = await createList({ name: "پوشه ب" });
    await createList({ name: "پوشه آ" });
    const c = await createList({ name: "پوشه بایگانی" });
    await db.lists.update(c.id, { archivedAt: Date.now() });
    const all = await db.lists.toArray();
    expect(childrenOf(all, null).map((l) => l.name)).toEqual(["پوشه آ", "پوشه ب"]);
    expect(a.name).toBe("پوشه ب");
  });

  it("builds the breadcrumb chain root → deep child", async () => {
    const l1 = await createList({ name: "سال ۱۴۰۴" });
    const l2 = await createList({ name: "مهر", parentId: l1.id });
    const l3 = await createList({ name: "هفته اول", parentId: l2.id });
    const path = await buildFolderPath(l3.id);
    expect(path.map((f) => f.id)).toEqual([l1.id, l2.id, l3.id]);
  });

  it("survives a corrupted cycle without looping", async () => {
    const a = await createList({ name: "A" });
    const b = await createList({ name: "B", parentId: a.id });
    // Corrupt: A points back at B → infinite loop without the guard.
    await db.lists.update(a.id, { parentId: b.id });
    const path = await buildFolderPath(b.id);
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThan(5);
  });
});

describe("moves", () => {
  it("moves a folder into another folder", async () => {
    const x = await createList({ name: "X" });
    const y = await createList({ name: "Y" });
    await moveList(x.id, y.id);
    expect((await db.lists.get(x.id))?.parentId).toBe(y.id);
  });

  it("refuses to move a folder into its own descendant", async () => {
    const root = await createList({ name: "ریشه" });
    const kid = await createList({ name: "بچه", parentId: root.id });
    await moveList(root.id, kid.id);
    // Root must still be at the top level — the cycle move was rejected.
    expect((await db.lists.get(root.id))?.parentId).toBeNull();
  });

  it("refuses to move a folder into itself", async () => {
    const f = await createList({ name: "خودش" });
    await moveList(f.id, f.id);
    expect((await db.lists.get(f.id))?.parentId).toBeNull();
  });

  it("isDescendant walks the chain", async () => {
    const a = await createList({ name: "A" });
    const b = await createList({ name: "B", parentId: a.id });
    const c = await createList({ name: "C", parentId: b.id });
    const other = await createList({ name: "D" });
    const all = await db.lists.toArray();
    expect(isDescendant(all, a.id, c.id)).toBe(true);
    expect(isDescendant(all, a.id, b.id)).toBe(true);
    expect(isDescendant(all, c.id, a.id)).toBe(false);
    expect(isDescendant(all, a.id, other.id)).toBe(false);
  });
});

describe("cascade-safe delete", () => {
  it("lifts sub-folders to the deleted folder's parent and keeps requests", async () => {
    const root = await createList({ name: "ریشه" });
    const mid = await createList({ name: "میانی", parentId: root.id });
    const leaf = await createList({ name: "برگی", parentId: mid.id });

    const reqId = "req-1";
    await db.requests.add({
      id: reqId,
      customerId: "c1",
      listId: mid.id,
      visaType: "توریستی",
      currency: "usd",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    await deleteList(mid.id, "میانی");

    // leaf moved UP to root
    expect((await db.lists.get(leaf.id))?.parentId).toBe(root.id);
    // request detached but kept
    const req = await db.requests.get(reqId);
    expect(req).toBeTruthy();
    expect(req?.listId).toBeNull();
    // mid is gone
    expect(await db.lists.get(mid.id)).toBeUndefined();
  });
});
