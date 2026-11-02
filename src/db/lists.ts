import { db } from "./schema";
import { logActivity } from "./activities";
import type { ListFolder } from "../types";
import { uid } from "../utils/id";

export interface ListInput {
  name: string;
  description?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  /** Folder this list lives inside — null/undefined = root level. */
  parentId?: string | null;
}

export async function createList(input: ListInput): Promise<ListFolder> {
  const now = Date.now();
  const list: ListFolder = {
    id: uid(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    category: input.category?.trim() || undefined,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    parentId: input.parentId || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.lists.add(list);
  await logActivity({
    type: "create",
    entity: "list",
    entityId: list.id,
    title: list.parentId
      ? `زیرپوشه «${list.name}» ساخته شد`
      : `پوشه «${list.name}» ساخته شد`,
  });
  return list;
}

export async function updateList(id: string, input: ListInput): Promise<void> {
  await db.lists.update(id, {
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    category: input.category?.trim() || undefined,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    parentId: input.parentId || null,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "list",
    entityId: id,
    title: `پوشه «${input.name.trim()}» ویرایش شد`,
  });
}

/** Move a folder (and everything inside it) into another folder / to root.
 *  Moving a folder into itself or one of its own descendants is rejected. */
export async function moveList(id: string, parentId: string | null): Promise<void> {
  if (id === parentId) return;
  if (parentId != null) {
    const chain = await buildFolderPath(parentId);
    if (chain.some((f) => f.id === id)) return; // never create a cycle
  }
  await db.lists.update(id, { parentId, updatedAt: Date.now() });
}

/** The breadcrumb chain from root down to the given folder (inclusive). */
export async function buildFolderPath(id: string): Promise<ListFolder[]> {
  const chain: ListFolder[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break; // cycle guard (corrupted data)
    seen.add(cursor);
    const folder: ListFolder | undefined = await db.lists.get(cursor);
    if (!folder) break;
    chain.unshift(folder);
    cursor = folder.parentId ?? null;
  }
  return chain;
}

/** Direct children of a folder (null = root level), name-sorted, RTL-safe. */
export function childrenOf(lists: ListFolder[], parentId: string | null): ListFolder[] {
  return lists
    .filter((l) => (l.parentId ?? null) === parentId && !l.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

/** Is `maybeChild` reachable by walking down from `ancestor`? */
export function isDescendant(lists: ListFolder[], ancestor: string, maybeChild: string): boolean {
  const byId = new Map(lists.map((l) => [l.id, l]));
  let cursor = byId.get(maybeChild)?.parentId ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === ancestor) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export async function archiveList(id: string, name: string): Promise<void> {
  await db.lists.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({ type: "archive", entity: "list", entityId: id, title: `پوشه «${name}» بایگانی شد` });
}

export async function restoreList(id: string, name: string): Promise<void> {
  await db.lists.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({ type: "restore", entity: "list", entityId: id, title: `پوشه «${name}» بازگردانده شد` });
}

/** Permanently delete a folder. Sub-folders move UP to the deleted folder's
 *  parent (Windows-style "children are not deleted with it"); requests and
 *  customers inside are detached but never deleted. */
export async function deleteList(id: string, name: string): Promise<void> {
  const folder = await db.lists.get(id);
  const parent = folder?.parentId ?? null;
  await db.transaction("rw", db.lists, db.requests, db.customers, async () => {
    const kids = await db.lists.where("parentId").equals(id).toArray();
    await Promise.all(
      kids.map((k) => db.lists.update(k.id, { parentId: parent, updatedAt: Date.now() })),
    );
    const linked = await db.requests.where("listId").equals(id).toArray();
    await Promise.all(
      linked.map((r) => db.requests.update(r.id, { listId: null, updatedAt: Date.now() })),
    );
    // Customers registered inside this list are kept, but detached from it.
    const linkedCustomers = await db.customers.where("listId").equals(id).toArray();
    await Promise.all(
      linkedCustomers.map((c) => db.customers.update(c.id, { listId: null, updatedAt: Date.now() })),
    );
    await db.lists.delete(id);
  });
  await logActivity({
    type: "delete",
    entity: "list",
    entityId: id,
    title: `پوشه «${name}» حذف شد`,
    detail: "محتویات و زیرپوشه‌ها حذف نشدند.",
  });
}
