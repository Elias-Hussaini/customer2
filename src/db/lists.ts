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
    createdAt: now,
    updatedAt: now,
  };
  await db.lists.add(list);
  await logActivity({
    type: "create",
    entity: "list",
    entityId: list.id,
    title: `لیست «${list.name}» ساخته شد`,
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
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "list",
    entityId: id,
    title: `لیست «${input.name.trim()}» ویرایش شد`,
  });
}

export async function archiveList(id: string, name: string): Promise<void> {
  await db.lists.update(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  await logActivity({ type: "archive", entity: "list", entityId: id, title: `لیست «${name}» بایگانی شد` });
}

export async function restoreList(id: string, name: string): Promise<void> {
  await db.lists.update(id, { archivedAt: null, updatedAt: Date.now() });
  await logActivity({ type: "restore", entity: "list", entityId: id, title: `لیست «${name}» بازگردانده شد` });
}

/** Permanently delete a list; its requests are detached (kept without a list). */
export async function deleteList(id: string, name: string): Promise<void> {
  await db.transaction("rw", db.lists, db.requests, async () => {
    const linked = await db.requests.where("listId").equals(id).toArray();
    await Promise.all(
      linked.map((r) => db.requests.update(r.id, { listId: null, updatedAt: Date.now() })),
    );
    await db.lists.delete(id);
  });
  await logActivity({
    type: "delete",
    entity: "list",
    entityId: id,
    title: `لیست «${name}» حذف شد`,
    detail: "درخواست‌های داخل لیست حذف نشدند.",
  });
}
