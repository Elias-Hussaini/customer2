/**
 * Persistence for AI worker accounts + AI settings (Dexie tables
 * `aiWorkers` / `aiMeta`, schema v7). Keys live only on this device —
 * they are intentionally NOT part of the customer JSON backup.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { uid } from "../../utils/id";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_MODEL,
  type AiSettings,
  type AiWorker,
} from "./types";

export function useAiWorkers(): AiWorker[] | undefined {
  return useLiveQuery(
    () =>
      db.aiWorkers.toArray().then((all) =>
        all.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt),
      ),
    [],
  );
}

export function useAiSettings(): AiSettings {
  const settings = useLiveQuery(() => db.aiMeta.get("ai"), []);
  return settings ?? DEFAULT_AI_SETTINGS;
}

export interface WorkerInput {
  label: string;
  url: string;
  key: string;
  model: string;
  enabled?: boolean;
}

function cleanUrl(url: string): string {
  return url.trim().replace(/\s+/g, "");
}

export async function addAiWorker(input: WorkerInput): Promise<AiWorker> {
  const url = cleanUrl(input.url);
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new Error("آدرس ورکر باید با http یا https شروع شود.");
  }
  if (!input.key.trim()) throw new Error("کلید ورکر را وارد کنید.");
  const count = await db.aiWorkers.count();
  const now = Date.now();
  const worker: AiWorker = {
    id: uid(),
    label: input.label.trim() || `اکانت ${(count + 1).toLocaleString("fa-IR")}`,
    url,
    key: input.key.trim(),
    model: input.model.trim() || DEFAULT_MODEL,
    enabled: input.enabled ?? true,
    priority: (await db.aiWorkers.toArray()).reduce(
      (max, w) => Math.max(max, w.priority),
      0,
    ) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.aiWorkers.add(worker);
  return worker;
}

export async function updateAiWorker(
  id: string,
  patch: Partial<Omit<AiWorker, "id" | "createdAt">>,
): Promise<void> {
  await db.aiWorkers.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteAiWorker(id: string): Promise<void> {
  await db.aiWorkers.delete(id);
}

/** Move a worker up/down in the failover chain, then re-number priorities. */
export async function moveAiWorker(id: string, dir: -1 | 1): Promise<void> {
  const all = (await db.aiWorkers.toArray()).sort(
    (a, b) => a.priority - b.priority || a.createdAt - b.createdAt,
  );
  const index = all.findIndex((w) => w.id === id);
  const swapWith = index + dir;
  if (index === -1 || swapWith < 0 || swapWith >= all.length) return;
  const current = all[index];
  all[index] = all[swapWith];
  all[swapWith] = current;
  const now = Date.now();
  await db.aiWorkers.bulkPut(
    all.map((w, i) => ({ ...w, priority: i + 1, updatedAt: now })),
  );
}

export async function updateAiSettings(patch: Partial<Omit<AiSettings, "id">>): Promise<void> {
  const existing = await db.aiMeta.get("ai");
  const next: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...existing,
    ...patch,
    id: "ai",
    updatedAt: Date.now(),
  };
  await db.aiMeta.put(next);
}

/** Switch one extraction field on/off (whether the AI may auto-fill it). */
export async function setAiFieldEnabled(key: string, enabled: boolean): Promise<void> {
  const existing = await db.aiMeta.get("ai");
  const next: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...existing,
    fieldToggles: { ...(existing?.fieldToggles ?? {}), [key]: enabled },
    id: "ai",
    updatedAt: Date.now(),
  };
  await db.aiMeta.put(next);
}

/** Switch every listed extraction field on/off at once. */
export async function setAllAiFields(keys: string[], enabled: boolean): Promise<void> {
  const existing = await db.aiMeta.get("ai");
  const toggles = { ...(existing?.fieldToggles ?? {}) };
  for (const key of keys) toggles[key] = enabled;
  const next: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...existing,
    fieldToggles: toggles,
    id: "ai",
    updatedAt: Date.now(),
  };
  await db.aiMeta.put(next);
}
