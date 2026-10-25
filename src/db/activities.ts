import { db } from "./schema";
import type { Activity, ActivityEntity, ActivityType } from "../types";
import { uid } from "../utils/id";

/** Append an entry to the local audit trail. Never throws. */
export async function logActivity(entry: {
  type: ActivityType;
  entity: ActivityEntity;
  entityId?: string;
  title: string;
  detail?: string;
}): Promise<void> {
  try {
    const record: Activity = {
      id: uid(),
      ts: Date.now(),
      ...entry,
    };
    await db.activities.add(record);
    // Keep the trail bounded — trim anything beyond the latest 800 entries.
    const count = await db.activities.count();
    if (count > 800) {
      const old = await db.activities.orderBy("ts").limit(count - 800).primaryKeys();
      await db.activities.bulkDelete(old);
    }
  } catch (e) {
    console.warn("activity log failed", e);
  }
}

export async function getRecentActivities(limit = 20, entityId?: string) {
  if (entityId) {
    const all = await db.activities.where("entityId").equals(entityId).toArray();
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  return db.activities.orderBy("ts").reverse().limit(limit).toArray();
}
