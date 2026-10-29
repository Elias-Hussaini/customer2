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

## قوانین ضدتوهم (حیاتی — تخطی مطلقاً ممنوع)
- هرگز هیچ عدد، آمار، تاریخ یا نتیجه‌ای را از خودت نساز. هر عدد در جواب نهایی باید عیناً از TOOL RESULTS واقعی همین گفتگو آمده باشد؛ اگر نداری، ابزار صدا بزن.
- «TOOL RESULTS» را فقط سیستم بعد از اجرای واقعی ابزار می‌فرستد. تو هرگز خودت چنین بخشی نساز و نتیجهٔ ابزار را شبیه‌سازی نکن.
- وقتی ابزار لازم است، جواب تو فقط و فقط JSON خالص پروتکل است — هیچ متن، توضیح یا بلوکِ کد قبل و بعدش ننویس.
- نام ابزار را دقیقاً با زیرخط (_) از فهرست پایین کپی کن (مثلاً count_customers نه countcustomers).
- برای هر سؤال آماری/تعدادی، قبل از جواب دادن حتماً ابزار مربوطه (db_stats، count_customers، …) را صدا بزن؛ حدس و تخمین ممنوع.
- اگر ابزار خطا داد، args را اصلاح کن و دوباره امتحان کن؛ از جواب خطا چیزی نساز.

## تقویم و تاریخ
- «امروز» و ساعت فعلی بالاتر آمده، اما برای اطمینان یا سؤالات تقویمی از ابزارهای get_current_date و date_info استفاده کن.
- date_info هر تاریخ شمسی (مثل 1404/07/12 حتی با ارقام فارسی ۱۴۰۴/۰۷/۱۲) یا میلادی را به هر دو تقویم تبدیل می‌کند، روز هفته و فاصله تا امروز را می‌دهد.
- تاریخ‌های ذخیره‌شده در داده‌ها میلادی ISO هستند (در نتایج ابزار، شکل شمسی‌شان کنارشان با پسوند _jalali آمده). در فیلترهای ابزار می‌توانی تاریخ شمسی هم بدهی؛ خودکار تبدیل می‌شود.

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
  | { kind: "final"; text?: string };

/** Normalize a tool name for matching: lowercase + strip separators.
 *  "count_customers" ≡ "countcustomers" ≡ "Count Customers" */
export function normalizeToolName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]/g, "");
}

/** Keys that UNAMBIGUOUSLY mean "run these tools" (strong aliases). */
const STRONG_CALL_KEYS = new Set(["toolcalls", "functioncalls", "toolcall"]);
/** Weaker aliases — only accepted when a call matches a real registered tool. */
const WEAK_CALL_KEYS = new Set(["calls", "tools", "invocations", "actions"]);
/** Where the call's name may live. */
const NAME_KEYS = ["name", "tool", "tool_name", "toolname", "function", "function_name"];
/** Where the call's args may live. */
const ARGS_KEYS = ["args", "arguments", "parameters", "params", "input"];
/** Models sometimes wrap their final answer in JSON — unwrap these. */
const FINAL_KEYS = ["final", "answer", "text", "reply", "response", "message"];

/** Skip a JSON string literal starting at `start` (quote char at start). */
function skipStringLiteral(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === '"') return i + 1;
    else i++;
  }
  return i;
}

/** Find the index of the bracket matching the one at `start` (or text end). */
function findMatchingBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return text.length - 1; // truncated tail — the loose parser will try to repair it
}

/** Every balanced (or trailing truncated) {...}/[...] span in the text. */
function jsonSpans(text: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === "{" || ch === "[") {
      const end = findMatchingBracket(text, i);
      spans.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    i++;
  }
  return spans;
}

function parseCall(e: unknown, i: number): { call: ToolCallRequest; hadArgs: boolean } | null {
  if (e == null || typeof e !== "object" || Array.isArray(e)) return null;
  const rec = e as Record<string, unknown>;
  let name = "";
  for (const k of NAME_KEYS) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) {
      name = v.trim();
      break;
    }
  }
  if (!name) return null;
  let args: Record<string, unknown> = {};
  let hadArgs = false;
  for (const k of ARGS_KEYS) {
    const v = rec[k];
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      args = v as Record<string, unknown>;
      hadArgs = true;
      break;
    }
  }
  return {
    call: {
      id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `c${i + 1}`,
      name,
      args,
    },
    hadArgs,
  };
}

/** Does this (possibly mangled) name refer to a real registered tool? */
function matchesKnown(name: string, known: Set<string>): boolean {
  const nk = normalizeToolName(name);
  if (known.has(nk)) return true;
  if (nk.length >= 4) {
    for (const k of known) if (k.includes(nk) || nk.includes(k)) return true;
  }
  return false;
}

function callsFromValue(val: unknown): { call: ToolCallRequest; hadArgs: boolean }[] | null {
  const arr = Array.isArray(val) ? val : [val];
  if (arr.length === 0) return null;
  const calls = arr.map(parseCall).filter((c): c is { call: ToolCallRequest; hadArgs: boolean } => !!c);
  return calls.length > 0 ? calls : null;
}

/**
 * Decide whether a model reply is a tool round. The protocol JSON is hunted
 * ANYWHERE in the reply (before/after prose, inside fences, truncated) and
 * under any key alias the model invents ("tool_calls", "toolcalls", …).
 * Tool names are matched leniently ("countcustomers" ≡ "count_customers").
 * Anything without a real tool-call payload is a final answer.
 */
export function parseProtocol(text: string, knownTools?: Set<string>): Protocol {
  const known = knownTools ?? new Set<string>();
  for (const span of jsonSpans(text)) {
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(span);
    } catch {
      continue; // not JSON — keep scanning
    }
    if (parsed == null) continue;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        const nk = normalizeToolName(key);
        const strong = STRONG_CALL_KEYS.has(nk);
        const weak = WEAK_CALL_KEYS.has(nk);
        if (!strong && !weak) continue;
        const calls = callsFromValue(val);
        if (!calls) continue;
        // Weak aliases must reference at least one REAL tool (an explanatory
        // example listing pseudo-tools is not a tool round).
        if (weak && !calls.some((c) => matchesKnown(c.call.name, known))) continue;
        return { kind: "tool_calls", calls: calls.map((c) => c.call) };
      }
      // No calls — maybe a wrapped final answer like {"final": "..."}.
      for (const k of FINAL_KEYS) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) return { kind: "final", text: v };
      }
      continue;
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      const calls = parsed.map(parseCall).filter((c): c is { call: ToolCallRequest; hadArgs: boolean } => !!c);
      // A bare array counts only when it is purely calls, references a real
      // tool AND carries args — JSON data the user asked to see must stay data.
      if (
        calls.length === parsed.length &&
        calls.some((c) => c.hadArgs) &&
        calls.some((c) => matchesKnown(c.call.name, known))
      ) {
        return { kind: "tool_calls", calls: calls.map((c) => c.call) };
      }
    }
  }
  return { kind: "final" };
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

  // Lenient tool-name matching: "countcustomers" resolves to count_customers.
  const knownTools = new Set(registry.tools.map((t) => normalizeToolName(t.name)));
  // Anti-fabrication guard: a reply that NARRATES fake "TOOL RESULTS" while no
  // tool has actually run this turn gets one corrective retry (never shown raw).
  const NARRATION_RE = /TOOL\s*RESULTS|نتیجه[هٔ]?\s*ابزار/i;
  const FAKE_CORRECTION =
    "⚠️ تذکر سیستم: در این نوبت هنوز هیچ ابزاری واقعاً اجرا نشده است؛ «TOOL RESULTS» و آمارهایی که نوشتی را خودت از خودت ساخته‌ای — این جعل است و مطلقاً ممنوع. قانون: هر عدد/آمار/نتیجه فقط از TOOL RESULTS واقعی همین گفتگو مجاز است. الان فقط یکی از این دو کار را بکن: (۱) اگر داده لازم داری، فقط و فقط JSON خالص پروتکل را بفرست تا ابزار واقعاً اجرا شود؛ (۲) اگر دادهٔ واقعی از TOOL RESULTSهای قبلی همین گفتگو داری، فقط از همان‌ها جواب نهایی بده.";
  let fakeGuardUsed = false;

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

    const proto = parseProtocol(reply.text, knownTools);
    if (proto.kind === "final") {
      // Fabricated tool results with zero real tools executed → one retry.
      if (steps.length === 0 && !fakeGuardUsed && round < maxRounds - 1 && NARRATION_RE.test(reply.text)) {
        fakeGuardUsed = true;
        messages.push({ role: "assistant", content: reply.text });
        messages.push({ role: "user", content: FAKE_CORRECTION });
        events?.onStatus?.("مدل داشت نتیجهٔ ابزار را از خود می‌ساخت — تذکر داده شد، تلاش مجدد…");
        continue;
      }
      const finalText = proto.text ?? reply.text;
      const worker = reply.parallel ? `${reply.worker} (موازی)` : reply.worker;
      events?.onFinal?.(finalText, worker);
      return { kind: "answer", text: finalText, worker, steps };
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
