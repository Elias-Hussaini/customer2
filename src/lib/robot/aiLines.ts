/**
 * Robot Companion — AI-generated reaction lines (اتصال به هوش مصنوعی اصلی).
 *
 * The robot no longer only reads pre-defined lines: every reaction (and every
 * tap) is a REAL request to the user's main AI (the same Cloudflare workers
 * that power the agent chat, via `aiChat`). The pre-defined phrase
 * DICTIONARY (reactions.ts) is fed to the model as the robot's character
 * sheet — the AI learns its tone from it but must always say something NEW.
 *
 * Design constraints:
 *  - the bubble is tiny → exactly ONE short Persian sentence (≤ ~12 words)
 *  - the robot is a companion, not an analyst → never invents app data/numbers
 *  - quota-friendly → tiny max_tokens, short timeout, injectable chat fn
 *  - anti-repetition → the last lines are sent as a "don't repeat" list and a
 *    reply that matches one verbatim is rejected (caller falls back to the
 *    local dictionary line)
 *
 * Everything here fails soft: any error resolves `null` and the caller shows
 * the local line instead. The robot must NEVER go silent because the AI did.
 */

import { aiChat, type ChatMessage } from "../ai/client";
import type { RobotAppEvent } from "./types";
import { ROBOT_DICTIONARY, ROBOT_DICTIONARY_LABELS } from "./reactions";

/** A tap on the robot — the only non-event "happening". */
export type RobotLineSource = RobotAppEvent | { type: "user:tap" };

/* ---------------------------- the event, in words --------------------------- */

/** Describe what just happened, in Persian, for the model. */
export function describeRobotEvent(source: RobotLineSource): string {
  const e = source as {
    type: string;
    title?: string;
    to?: string;
    name?: string;
    query?: string;
    dark?: boolean;
  };
  switch (e.type) {
    case "user:tap":
      return "کاربر همین حالا مستقیم روی خودِ ربات کلیک کرد و منتظر یک جملهٔ بامزه از توست.";
    case "nav:change": {
      const where = e.title?.trim() || e.to?.trim() || "صفحهٔ دیگری";
      return `کاربر وارد صفحهٔ «${where}» شد.`;
    }
    case "app:save_success":
      return "یک ثبت/ذخیره‌سازی همین حالا با موفقیت انجام شد.";
    case "app:save_error":
      return "ذخیره‌سازی با خطا مواجه شد.";
    case "app:upload_start":
      return "آپلود یک فایل شروع شد.";
    case "app:upload_done":
      return `آپلود فایل${e.name ? ` «${e.name}»` : ""} با موفقیت تمام شد.`;
    case "app:upload_error":
      return `آپلود فایل${e.name ? ` «${e.name}»` : ""} با خطا مواجه شد.`;
    case "app:export_start":
      return "در حال گرفتن خروجی هستیم.";
    case "app:export_done":
      return "خروجی با موفقیت ساخته و دانلود شد.";
    case "app:export_error":
      return "گرفتن خروجی با خطا مواجه شد.";
    case "app:import_start":
      return "بازیابی نسخهٔ پشتیبان شروع شد.";
    case "app:import_done":
      return "بازیابی نسخهٔ پشتیبان با موفقیت کامل شد.";
    case "app:import_error":
      return "بازیابی نسخهٔ پشتیبان با خطا مواجه شد.";
    case "app:report_generated":
      return `گزارش${e.title ? ` «${e.title}»` : ""} همین حالا ساخته شد.`;
    case "app:search": {
      const q = (e.query ?? "").trim();
      return q
        ? `کاربر در برنامه دنبال «${q.slice(0, 40)}» می‌گردد.`
        : "کاربر جستجو را باز کرد و دنبال چیزی می‌گردد.";
    }
    case "app:theme_toggle":
      return e.dark
        ? "کاربر حالت تاریک را روشن کرد."
        : "کاربر حالت روشن را برگرداند.";
    case "app:layout_change":
      return "کاربر چیدمان دکمه‌های برنامه را دستکاری و شخصی‌سازی کرد.";
    case "user:idle":
      return "کاربر مدتی است کاری نکرده و تو خواسته‌ای چرت کوتاهی بزنی.";
    case "user:active":
      return "کاربر برگشت و تو تازه بیدار شدی.";
    default:
      return "کاربر دارد از برنامه استفاده می‌کند.";
  }
}

/* ------------------------------- sanitizing -------------------------------- */

/** Strip the decorations models love to add around a one-line answer. */
export function sanitizeRobotLine(raw: string): string | null {
  let t = (raw ?? "").trim();
  // strip code fences / markdown decorations
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "");
  t = t.replace(/[*_#>`]+/g, "");
  // strip wrapping quotes (Persian + Latin) and label prefixes
  t = t.replace(/^[«"'\u201c\u2018]+/, "").replace(/[»"'\u201d\u2019]+$/, "");
  t = t.replace(/^(ربات|جمله|پاسخ|خط)\s*[:：-]\s*/, "");
  // one paragraph, single spaces
  t = t.replace(/\s+/g, " ").trim();
  // no emoji — the dictionary voice is plain text
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    "",
  ).trim();
  if (t.length < 2 || t.length > 90) return null;
  return t;
}

/* ------------------------------ the prompt --------------------------------- */

/** Render the pre-defined dictionary compactly: «موضوع: جمله · جمله …». */
function renderDictionary(): string {
  return (Object.keys(ROBOT_DICTIONARY) as (keyof typeof ROBOT_DICTIONARY)[])
    .map((key) => {
      const label = ROBOT_DICTIONARY_LABELS[key] ?? key;
      const lines = ROBOT_DICTIONARY[key] as readonly string[];
      return `- ${label}: ${lines.join(" · ")}`;
    })
    .join("\n");
}

export interface RobotLineRequest {
  source: RobotLineSource;
  /** Current page title (helps the model stay contextual). */
  page?: string;
  /** Lines the robot recently said — the model must not repeat them. */
  recent?: string[];
}

/** Build the chat messages for a reaction line (pure — unit tested). */
export function buildRobotLineMessages(req: RobotLineRequest): ChatMessage[] {
  const recent = (req.recent ?? []).filter(Boolean).slice(-8);
  const recentBlock =
    recent.length > 0
      ? `\n## جمله‌هایی که همین اخیراً گفته‌ای — مطلقاً تکرارشان نکن\n${recent.map((l) => `- «${l}»`).join("\n")}`
      : "";
  const page = req.page?.trim();
  const system = `تو «رباتِ همراهِ» برنامهٔ مدیریت ویزا «E-managment» هستی: یک ربات کوچولوی سه‌بعدی بامزه با هدفون و آنتن، که گوشهٔ صفحه همراه کاربر می‌ماند و به کارهایش واکنش نشان می‌دهد.

## دیکشنری جمله‌های تو — لحن و شخصیتت اینجا تعریف شده
این‌ها جمله‌های از پیش‌تعیین‌شدهٔ قدیمی توست. لحن، انرژی، کوتاهی و شیطنت را از آن‌ها یاد بگیر، اما هرگز عین همین جمله‌ها را تکرار نکن — همیشه جملهٔ کاملاً تازه بساز:
${renderDictionary()}${recentBlock}

## قوانین (تخلف مطلقاً ممنوع)
- خروجی تو فقط و فقط یک جملهٔ فارسی کوتاه است: حداکثر ۱۲ کلمه، بدون هیچ توضیح، مقدمه، گیومه، ایموجی یا markdown.
- لحن: صمیمی، شاد، بازیگوش و کمی خودستا؛ مثل یک رفیقِ رباتیِ کوچولو.
- دقیقاً به اتفاقی که گفته می‌شود واکنش نشان بده؛ اگر نام یا عبارتی در آن هست، می‌توانی با همان بازی کنی.
- هرگز عدد، آمار یا ادعایی دربارهٔ داده‌های برنامه از خودت نساز — تو همراهی، نه گزارشگر.
- فارسیِ درست و روان؛ کلمات نامفهوم و دگرگون‌شده ممنوع.`;
  const user = `اتفاق: ${describeRobotEvent(req.source)}${page ? `\nصفحهٔ فعلی کاربر: «${page}»` : ""}\n\nفقط جملهٔ ربات را بنویس.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------ generation --------------------------------- */

export interface RobotLineResult {
  text: string;
  /** Which worker account produced the line. */
  worker: string;
}

/** Injectable chat transport (tests pass a fake; production uses aiChat). */
export type RobotLineChat = (
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ text: string; worker: { label?: string; url: string } }>;

/** Session memory — the last lines said (anti-repetition across requests). */
const recentLines: string[] = [];
const RECENT_MAX = 10;

export function recentRobotLines(): readonly string[] {
  return recentLines;
}

/** Tests only — wipe the session memory. */
export function __resetRobotLineMemoryForTests(): void {
  recentLines.length = 0;
}

export interface GenerateRobotLineOptions {
  signal?: AbortSignal;
  /** Injectable for tests. */
  chat?: RobotLineChat;
  page?: string;
}

/**
 * Ask the MAIN AI (the user's workers) for one reaction line.
 * Resolves `null` whenever there is no usable reply — the caller then falls
 * back to the local dictionary line. Never throws.
 */
export async function generateRobotLine(
  source: RobotLineSource,
  opts: GenerateRobotLineOptions = {},
): Promise<RobotLineResult | null> {
  if (opts.signal?.aborted) return null;
  const chat = opts.chat ?? aiChat;
  const messages = buildRobotLineMessages({
    source,
    page: opts.page,
    recent: [...recentLines],
  });
  let reply: { text: string; worker: { label?: string; url: string } };
  try {
    reply = await chat(messages, {
      maxTokens: 90,
      temperature: 1,
      timeoutMs: 12_000,
      signal: opts.signal,
    });
  } catch {
    return null; // no workers / network / timeout — fallback locally
  }
  if (opts.signal?.aborted) return null;
  const text = sanitizeRobotLine(reply.text);
  if (!text) return null;
  // verbatim repeat of a recent line → prefer the local fallback instead
  if (recentLines.includes(text)) return null;
  recentLines.push(text);
  if (recentLines.length > RECENT_MAX) recentLines.shift();
  return { text, worker: reply.worker.label?.trim() || reply.worker.url };
}
