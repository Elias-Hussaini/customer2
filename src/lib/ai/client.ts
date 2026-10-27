/**
 * Chat client for the user's Cloudflare AI workers.
 *
 * Request shape (fixed by the user's existing working integration):
 *   POST <worker.url>                     — base URL, no path appended
 *   Authorization: Bearer <worker.key>
 *   { model, messages, max_tokens, temperature, stream: false }
 *
 * Failover: enabled workers are tried in priority order. Rate limits
 * (HTTP 429), auth errors, server errors, network errors and empty replies
 * all move on to the next account automatically.
 */

import { db } from "../../db/schema";
import type { AiWorker } from "./types";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatResult {
  text: string;
  worker: AiWorker;
}

export interface WorkerAttempt {
  label: string;
  url: string;
  /** HTTP status when the server answered, else 0 (network/timeout). */
  status: number;
  message: string;
}

export class AiAllWorkersFailedError extends Error {
  attempts: WorkerAttempt[];
  constructor(attempts: WorkerAttempt[]) {
    super(
      attempts.length === 0
        ? "هیچ ورکر هوش مصنوعی فعالی تنظیم نشده است."
        : `همه ورکرها ناموفق بودند (${attempts.length} حساب)`,
    );
    this.name = "AiAllWorkersFailedError";
    this.attempts = attempts;
  }
}

/** Enabled workers in failover order (priority, then creation time). */
export async function getEnabledWorkers(): Promise<AiWorker[]> {
  const all = await db.aiWorkers.toArray();
  return all
    .filter((w) => w.enabled && w.url.trim() && w.key.trim())
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
}

/**
 * Session-level cooldown: workers that just failed (rate limit, network…)
 * rotate to the BACK of the chain for a while, so quota is spread across
 * accounts and a 429'd account is not hammered first on every request.
 * Never removes a worker — only reorders.
 */
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 90_000;

function orderWithCooldown<T extends { id: string }>(workers: T[]): T[] {
  const now = Date.now();
  return [...workers].sort((a, b) => {
    const ca = (cooldown.get(a.id) ?? 0) > now ? 1 : 0;
    const cb = (cooldown.get(b.id) ?? 0) > now ? 1 : 0;
    return ca - cb; // stable: keeps priority order inside each group
  });
}

/** Read the generated text from any of the known response shapes. */
export function extractReplyText(data: unknown): string {
  if (data == null || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const result = d.result as Record<string, unknown> | undefined;
  const pickChoice = (owner: Record<string, unknown> | undefined) => {
    const choices = owner?.choices as Array<Record<string, unknown>> | undefined;
    const first = choices?.[0] as Record<string, unknown> | undefined;
    if (!first) return "";
    const message = first.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
    const delta = first.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string") return delta.content;
    return "";
  };
  if (result && typeof result === "object") {
    if (typeof result.response === "string") return result.response;
    const fromChoices = pickChoice(result);
    if (fromChoices) return fromChoices;
  }
  const fromTopChoices = pickChoice(d);
  if (fromTopChoices) return fromTopChoices;
  if (typeof d.response === "string") return d.response;
  return "";
}

/** Best-effort error message from a non-OK response body. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const err = (json.error ?? (json.result as Record<string, unknown>)?.error) as
        | Record<string, unknown>
        | undefined;
      if (err && typeof err.message === "string") return err.message;
      if (typeof json.message === "string") return json.message;
      // Cloudflare-style { errors: [{ code, message }] }
      if (Array.isArray(json.errors)) {
        const first = json.errors[0] as Record<string, unknown> | undefined;
        if (first && typeof first.message === "string") return first.message;
      }
    } catch {
      /* not JSON — fall through */
    }
    return text.slice(0, 120).trim();
  } catch {
    return "";
  }
}

export function statusLabel(status: number): string {
  if (status === 429) return "محدودیت نرخ (429)";
  if (status === 401 || status === 403) return `کلید/دسترسی رد شد (${status})`;
  if (status === 404) return "آدرس ورکر پیدا نشد (404)";
  if (status >= 500) return `خطای سرور (${status})`;
  return `HTTP ${status}`;
}

async function requestWorker(
  worker: AiWorker,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  let res: Response;
  try {
    res = await fetch(worker.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${worker.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: worker.model,
        messages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new Error("اتصال به ورکر برقرار نشد (شبکه/CORS)");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`${statusLabel(res.status)}${detail ? ` — ${detail}` : ""}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("پاسخ ورکر JSON معتبر نبود");
  }
  const text = extractReplyText(data).trim();
  if (!text) throw new Error("ورکر پاسخ خالی برگرداند");
  return text;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** Per-worker timeout — vision requests can be slow. Default 120s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called right before each worker attempt (for progress UI). */
  onAttempt?: (info: { worker: AiWorker; index: number; total: number }) => void;
}

/**
 * Send a chat request through the failover chain. Tries every enabled
 * worker in order; the first successful reply wins. Throws
 * AiAllWorkersFailedError when the whole chain fails.
 */
export async function aiChat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const enabled = await getEnabledWorkers();
  if (enabled.length === 0) throw new AiAllWorkersFailedError([]);
  const workers = orderWithCooldown(enabled);

  const attempts: WorkerAttempt[] = [];
  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    opts.onAttempt?.({ worker, index: i, total: workers.length });
    try {
      const text = await requestWorker(worker, messages, {
        maxTokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.1,
        timeoutMs: opts.timeoutMs ?? 120_000,
        signal: opts.signal,
      });
      cooldown.delete(worker.id); // healthy again — restore its priority
      return { text, worker };
    } catch (e) {
      if (opts.signal?.aborted) throw new AiAllWorkersFailedError(attempts);
      cooldown.set(worker.id, Date.now() + COOLDOWN_MS); // try other accounts first
      attempts.push({
        label: worker.label || worker.url,
        url: worker.url,
        status: 0,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  throw new AiAllWorkersFailedError(attempts);
}

export type WorkerTestResult =
  | { ok: true; ms: number; reply: string }
  | { ok: false; ms: number; error: string };

/** Ping a single worker with a tiny text-only request. */
export async function testWorker(worker: AiWorker): Promise<WorkerTestResult> {
  const started = performance.now();
  try {
    const reply = await requestWorker(
      worker,
      [
        { role: "system", content: "Reply with the single word: OK" },
        { role: "user", content: "ping" },
      ],
      { maxTokens: 512, temperature: 0, timeoutMs: 45_000 },
    );
    return { ok: true, ms: Math.round(performance.now() - started), reply: reply.slice(0, 120) };
  } catch (e) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
