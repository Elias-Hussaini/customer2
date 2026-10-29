/**
 * Central AI Agent — RUNTIME (مغز متفکر).
 *
 * A multi-round tool-calling loop on a TEXT protocol (works on ANY chat
 * model — no native function-calling support required):
 *
 *   model → {"tool_calls":[{id,name,args}…]}   (one round)
 *   app   → "TOOL RESULTS: …" (+ images from view_document)
 *   …up to maxRounds, then the model must answer.
 *
 * Any other reply is the final answer (rich markdown, rendered by the chat
 * UI). Multi-account failover + parallel racing is handled by
 * aiChatRace — under rate limits the remaining accounts are fired in
 * parallel and the first usable reply wins.
 */

import { aiChatRace, AiAllWorkersFailedError, type ChatMessage, type ContentPart } from "../ai/client";
import { parseJsonLoose } from "../ai/jsonrepair";
import { buildToolRegistry, type ToolCtx } from "./tools";
import { todayIso, formatJalali, toPersianDigits } from "../../utils/jalali";
import type {
  AgentAttachment,
  AgentMessage,
  AgentRunEvents,
  AgentRunOptions,
  AgentToolStep,
  AgentTurnInput,
  AgentTurnResult,
  ToolCallRequest,
  ToolCallResult,
  ToolDef,
} from "./types";

/* ------------------------------ system prompt ------------------------------ */

function renderTool(t: ToolDef): string {
  const params = t.params.length > 0 ? t.params.map((p) => (p.required ? p.name : `${p}?`)).join(", ") : "";
  return `- ${t.name}(${params}) — ${t.description}${t.writes ? " 〔نوشتاری〕" : ""}`;
}

function buildSystemPrompt(tools: ToolDef[], maxRounds: number): string {
  const now = new Date();
  const g = todayIso();
  const j = formatJalali(g);
  const weekday = now.toLocaleDateString("fa-IR", { weekday: "long" });
  return `تو «دستیار هوشمند» سامانهٔ مدیریت ویزا هستی — ایجنت مرکزی برنامه که به تمام داده‌ها و امکانات آن دسترسی داری. با هر درخواستی که می‌آید (هرچقدر هم خاص باشد) بهترین ترکیب ابزارها را انتخاب کن؛ هیچ قابلیتی از پیش محدود نشده و ابزارهای عمومی (query_table / describe_schema) هر جدولی — حتی جدول‌های آیندهٔ برنامه — را پوشش می‌دهند.

## زمان حال
- میلادی: ${g} — ${now.toLocaleDateString("en-US", { weekday: "long" })}
- شمسی: ${j} — ${weekday}

## پروتکل ابزار
- وقتی داده یا اقدام لازم داری، جواب تو ONLY این JSON است (بدون متن اضافه):
  {"tool_calls":[{"id":"c1","name":"نام_ابزار","args":{…}},{"id":"c2","name":"…","args":{…}}]}
- می‌توانی چند ابزار را در یک دور با هم صدا بزنی. نتیجه‌ها به‌صورت پیام «TOOL RESULTS» برمی‌گردند و تو دور بعدی را ادامه می‌دهی (حداکثر ${toPersianDigits(maxRounds)} دور).
- وقتی جواب نهایی آماده است، متن عادی بنویس (نه JSON). هرگز بعد از گرفتن نتیجه، ابزار بی‌مورد تکرار نکن.
- برای پاسخ‌های بلند، خودت ابتدا با ابزارها داده جمع کن و بعد گزارش کامل بساز.

## قوانین ثبت (نوشتاری)
- هر مشتری الزاماً یک «نماینده» و یک «لیست» دارد. اگر کاربر نگفته، اول بپرس — حدس نزن، چیز را خودسر ثبت نکن.
- کارفرما اختیاری است؛ «بدون کارفرما» یعنی employer=null.
- شماره پاسپورت تکراری = خطا؛ به کاربر اطلاع بده و بپرس.
- اگر چند هم‌نام پیدا شد، از کاربر بپرس کدام منظورش است.

## سبک جواب نهایی
- فارسیِ روان و دقیق (لهجهٔ اداری محترمانه)؛ اعداد با ارقام فارسی.
- markdown کامل و زیبا: تیتر ##، جدول‌های مرتب، فهرست، **پررنگ**. جواب‌ها باید خوانا و چیده‌شده باشند، نه متنیِ درهم.
- تاریخ‌ها شمسی نمایش بده (در نتایج ابزار، jalali آمده). مبالغ با واحد (تومان/دلار/افغانی).
- اگر کاربر عکس/PDF پیوست کرده، تصاویر را خودت می‌بینی — اطلاعات را از خودِ تصویر بخوان (نام، شماره پاسپورت و…) و مثل یک کارشناس استفاده کن.
- جواب کوتاه برای سؤال کوتاه؛ گزارش کامل برای درخواست گزارش.

## ابزارها (${toPersianDigits(tools.length)} عدد)
${tools.map(renderTool).join("\n")}`;
}

/* ---------------------------- protocol parsing ----------------------------- */

export type Protocol =
  | { kind: "tool_calls"; calls: ToolCallRequest[] }
  | { kind: "final" };

/**
 * Decide whether a model reply is a tool round. Only a JSON object that
 * actually contains a "tool_calls" array counts — anything else (including
 * JSON the user asked to see) is a final answer.
 */
export function parseProtocol(text: string): Protocol {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) return { kind: "final" };
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(trimmed);
  } catch {
    return { kind: "final" };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "final" };
  const obj = parsed as Record<string, unknown>;
  const rawCalls = obj.tool_calls ?? obj.toolCalls ?? obj.calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return { kind: "final" };
  const calls: ToolCallRequest[] = [];
  for (let i = 0; i < rawCalls.length; i++) {
    const e = rawCalls[i];
    if (e == null || typeof e !== "object") continue;
    const rec = e as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : typeof rec.tool === "string" ? rec.tool.trim() : "";
    if (!name) continue;
    calls.push({
      id: typeof rec.id === "string" ? rec.id : `c${i + 1}`,
      name,
      args: (rec.args && typeof rec.args === "object" && !Array.isArray(rec.args) ? rec.args : rec.arguments && typeof rec.arguments === "object" ? rec.arguments : {}) as Record<string, unknown>,
    });
  }
  if (calls.length === 0) return { kind: "final" };
  return { kind: "tool_calls", calls };
}

/** A reply is usable as a final answer (drives the parallel race). */
function usableReply(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && !/^[\s`*\-_.]+$/.test(t);
}

/* ------------------------------ history shaping ---------------------------- */

const HISTORY_KEEP = 12;

/** Compact prior turns for the model: text only (files/steps dropped). */
function compactHistory(history: AgentMessage[]): ChatMessage[] {
  const slice = history.slice(-HISTORY_KEEP);
  const out: ChatMessage[] = [];
  for (const m of slice) {
    const text = m.text.trim();
    if (!text) continue;
    out.push({ role: m.role, content: text });
  }
  return out;
}

/** The new user turn: text + attached images the model should see. */
function currentUserMessage(text: string, files: AgentAttachment[]): ChatMessage {
  if (files.length === 0) return { role: "user", content: text };
  const parts: ContentPart[] = [
    {
      type: "text",
      text: text || "(بدون متن — فقط فایل پیوست شده است)",
    },
  ];
  for (const f of files) parts.push({ type: "image_url", image_url: { url: f.full } });
  return { role: "user", content: parts };
}

/* --------------------------------- the loop -------------------------------- */

export interface RunTurnArgs extends AgentRunOptions {
  ctx: ToolCtx;
  events?: AgentRunEvents;
}

export async function runAgentTurn(input: AgentTurnInput, args: RunTurnArgs): Promise<AgentTurnResult> {
  const { ctx, events, signal } = args;
  const maxRounds = args.maxRounds ?? 8;
  const registry = await buildToolRegistry(ctx);
  const steps: AgentToolStep[] = [];

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(registry.tools, maxRounds) },
    ...compactHistory(input.history),
    currentUserMessage(input.text, input.files),
  ];

  const ask = (msgs: ChatMessage[]) =>
    aiChatRace(msgs, {
      maxTokens: 4096,
      temperature: 0.2,
      timeoutMs: 150_000,
      signal,
      validate: usableReply,
      onAttempt: ({ worker, index, total }) =>
        events?.onStatus?.(
          total > 1 && index > 0
            ? `حساب قبلی پاسخ نداد — تلاش موازی با «${worker.label}»…`
            : `در حال فکر کردن با «${worker.label}»…`,
        ),
    });

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) return { kind: "aborted" };
    events?.onStatus?.(round === 0 ? "در حال فکر کردن…" : `دور ${toPersianDigits(round + 1)} — در حال فکر کردن…`);
    let reply: { text: string; worker: string; parallel: boolean };
    try {
      const res = await ask(messages);
      reply = { text: res.text, worker: res.worker.label || res.worker.url, parallel: res.parallel };
    } catch (e) {
      if (signal?.aborted) return { kind: "aborted" };
      const message =
        e instanceof AiAllWorkersFailedError
          ? e.attempts.length === 0
            ? "هیچ ورکر هوش مصنوعی فعالی تنظیم نشده است."
            : `همه حساب‌ها ناموفق بودند:\n${e.attempts.map((a) => `• ${a.label}: ${a.message}`).join("\n")}`
          : e instanceof Error
            ? e.message
            : String(e);
      return { kind: "error", message, steps };
    }
    if (signal?.aborted) return { kind: "aborted" };

    const proto = parseProtocol(reply.text);
    if (proto.kind === "final") {
      const worker = reply.parallel ? `${reply.worker} (موازی)` : reply.worker;
      events?.onFinal?.(reply.text, worker);
      return { kind: "answer", text: reply.text, worker, steps };
    }

    // A tool round — execute every call, then feed compact results back.
    events?.onToolCalls?.(proto.calls);
    const roundResults: ToolCallResult[] = [];
    for (const call of proto.calls) {
      if (signal?.aborted) return { kind: "aborted" };
      events?.onStatus?.(`اجرای ${call.name}…`);
      const result = await registry.execute(call);
      steps.push({ call, result });
      roundResults.push(result);
      events?.onToolResult?.(result);
    }

    const textPart = [
      "TOOL RESULTS (use them; do NOT repeat these calls unless the data is insufficient):",
      ...roundResults.map((r) =>
        [
          `[${r.ok ? "OK" : "ERROR"}] ${r.name} #${r.id} (${r.ms}ms)`,
          JSON.stringify(r.data),
          r.ok ? undefined : `راهنمای خطا: ${typeof r.data === "object" && r.data && "hint" in (r.data as object) ? String((r.data as { hint?: string }).hint) : "—"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n\n");
    const contentParts: ContentPart[] = [{ type: "text", text: textPart }];
    for (const r of roundResults) if (r.image) contentParts.push({ type: "image_url", image_url: { url: r.image } });

    messages.push({ role: "assistant", content: reply.text });
    messages.push({ role: "user", content: contentParts.length > 1 ? contentParts : textPart });
  }

  // Rounds exhausted — force a final answer without any more tools.
  events?.onStatus?.("جمع‌بندی…");
  try {
    messages.push({
      role: "user",
      content: "دیگر ابزاری صدا نزن. همین حالا جواب نهایی را با اطلاعات موجود بده.",
    });
    const res = await ask(messages);
    const text = parseProtocol(res.text).kind === "tool_calls" ? "متأسفانه بعد از چند دور ابزار، مدل جواب نهایی نداد. دوباره بپرس." : res.text;
    const worker = res.parallel ? `${res.worker.label || res.worker.url} (موازی)` : res.worker.label || res.worker.url;
    events?.onFinal?.(text, worker);
    return { kind: "answer", text, worker, steps };
  } catch (e) {
    if (signal?.aborted) return { kind: "aborted" };
    return {
      kind: "error",
      message: e instanceof AiAllWorkersFailedError
        ? `همه حساب‌ها ناموفق بودند:\n${e.attempts.map((a) => `• ${a.label}: ${a.message}`).join("\n")}`
        : e instanceof Error ? e.message : String(e),
      steps,
    };
  }
}
