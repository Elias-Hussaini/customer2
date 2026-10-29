/**
 * Robot Companion — the expandable conversation panel.
 *
 * A compact front-end over the EXISTING agent runtime: runAgentTurn (multi-
 * round tools, failover, anti-fabrication guards) + aiChats persistence +
 * the shared Markdown renderer. The robot contributes the look and the
 * write-confirmation gate — every reply shown here is produced by the user's
 * own AI workers; nothing is scripted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp,
  Check,
  MessageSquarePlus,
  PanelBottomClose,
  ShieldQuestion,
  Square,
} from "lucide-react";
import { runAgentTurn } from "../../lib/agent/agent";
import {
  appendMessages,
  createChat,
  getChat,
  listChats,
} from "../../lib/agent/chats";
import type { AgentChatRecord, AgentMessage } from "../../lib/agent/types";
import { Markdown } from "../agent/Markdown";
import { robotBus } from "../../lib/robot/eventBus";
import { uid } from "../../utils/id";

interface ConfirmState {
  name: string;
  description: string;
  args: Record<string, unknown>;
  resolve: (ok: boolean) => void;
}

export interface RobotChatPanelProps {
  onClose: () => void;
  /** Notified with the latest AI text so the bubble can preview it. */
  onAssistantText?: (text: string, worker?: string) => void;
}

export function RobotChatPanel({ onClose, onAssistantText }: RobotChatPanelProps) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<AgentChatRecord[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ------------------------------ chat loading ----------------------------- */

  const refreshChats = useCallback(async () => {
    setChats(await listChats());
  }, []);

  useEffect(() => {
    void refreshChats();
    inputRef.current?.focus();
  }, [refreshChats]);

  // Open the most recent conversation (continuity — the robot remembers).
  useEffect(() => {
    if (chats.length > 0 && chatId == null) {
      setChatId(chats[0].id);
      setMessages(chats[0].messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length > 0]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, status]);

  // Unmount safety: a pending write-confirmation must never block the agent
  // forever, and an in-flight request is aborted with the panel.
  useEffect(() => {
    return () => {
      confirmResolveRef.current?.(false);
      confirmResolveRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  /* ------------------------------ send a turn ------------------------------ */

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: AgentMessage = { role: "user", text, ts: Date.now() };
    let history: AgentMessage[];
    let targetChat: string | null;
    if (chatId == null) {
      const rec = await createChat(userMsg);
      targetChat = rec.id;
      setChatId(rec.id);
      history = [];
    } else {
      targetChat = chatId;
      const rec = await getChat(chatId);
      history = rec ? rec.messages : [];
      await appendMessages(chatId, [userMsg]);
    }
    setMessages((m) => [...m, userMsg]);
    void refreshChats();

    setBusy(true);
    setStatus("در حال فکر کردن…");
    robotBus.emit({ type: "ai:request_start", prompt: text });

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await runAgentTurn(
      { history, text, files: [] },
      {
        ctx: {
          navigate,
          confirmWrite: (req) =>
            new Promise<boolean>((resolve) => {
              // The trusted write gate — the human decides, always.
              robotBus.emit({ type: "ai:tool_running", name: req.name });
              confirmResolveRef.current = resolve;
              setConfirm({ ...req, resolve });
            }),
        },
        signal: controller.signal,
        events: {
          onStatus: (s) => setStatus(s),
          onToolCalls: () => setStatus("در حال اجرای ابزارها…"),
          onToolResult: (r) => {
            robotBus.emit({ type: "ai:tool_running", name: r.name });
          },
          onFinal: (finalText, worker) => {
            onAssistantText?.(finalText, worker);
          },
        },
      },
    );

    abortRef.current = null;
    setBusy(false);
    setStatus(null);

    if (result.kind === "aborted") {
      robotBus.emit({ type: "ai:aborted" });
      const sys: AgentMessage = {
        role: "assistant",
        text: "⏹ پاسخ متوقف شد.",
        ts: Date.now(),
      };
      setMessages((m) => [...m, sys]);
      return;
    }

    if (result.kind === "error") {
      robotBus.emit({ type: "ai:error", message: result.message });
      const errMsg: AgentMessage = {
        role: "assistant",
        text: result.message,
        ts: Date.now(),
        error: result.message,
      };
      setMessages((m) => [...m, errMsg]);
      if (targetChat) await appendMessages(targetChat, [errMsg]);
      return;
    }

    robotBus.emit({ type: "ai:response_final", text: result.text });
    const answer: AgentMessage = {
      role: "assistant",
      text: result.text,
      ts: Date.now(),
      steps: result.steps,
      worker: result.worker,
    };
    setMessages((m) => [...m, answer]);
    if (targetChat) await appendMessages(targetChat, [answer]);
    void refreshChats();
  }, [input, busy, chatId, navigate, onAssistantText, refreshChats]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    stop();
    setChatId(null);
    setMessages([]);
    setStatus(null);
    setBusy(false);
    inputRef.current?.focus();
  }, [stop]);

  /* ------------------------------- rendering ------------------------------- */

  return (
    <div
      dir="rtl"
      className="glass pointer-events-auto fixed top-[4.75rem] right-3 z-50 flex max-h-[min(72dvh,640px)] w-[min(92vw,23rem)] flex-col overflow-hidden rounded-3xl shadow-2xl shadow-ink-950/20"
      role="dialog"
      aria-label="گفتگو با ربات همراه"
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/40 px-3.5 py-2.5 dark:border-white/6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/12 text-[14px]">
            🤖
          </span>
          <div className="leading-tight">
            <p className="text-[12.5px] font-extrabold">ربات همراه</p>
            <p className="text-[10px] text-ink-500 dark:text-ink-400">
              متصل به دستیار هوشمند شما
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded-xl p-1.5 text-ink-500 transition-colors hover:bg-brand-500/10 hover:text-brand-600"
            onClick={newChat}
            title="گفتگوی جدید"
            aria-label="گفتگوی جدید"
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            className="rounded-xl p-1.5 text-ink-500 transition-colors hover:bg-brand-500/10 hover:text-brand-600"
            onClick={onClose}
            title="بستن"
            aria-label="بستن"
          >
            <PanelBottomClose size={15} />
          </button>
        </div>
      </div>

      {/* messages */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {messages.length === 0 && !busy ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-[12px] font-bold text-ink-600 dark:text-ink-300">
              سلام! چطور می‌توانم کمک کنم؟
            </p>
            <p className="mx-auto max-w-[16rem] text-[11px] leading-6 text-ink-500 dark:text-ink-400">
              از من آمار بگیرید، مشتری ثبت کنید، جستجو کنید یا هر سؤال دیگری
              درباره داده‌های برنامه بپرسید. پاسخ‌ها از هوش مصنوعی خودتان می‌آید.
            </p>
          </div>
        ) : null}

        {messages.map((m) => (
          <div key={m.ts + m.role} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 text-[12px] leading-6 ${
                m.role === "user"
                  ? "rounded-br-md bg-brand-500 text-white"
                  : m.error
                    ? "rounded-bl-md bg-red-500/10 text-red-600 dark:text-red-300"
                    : "robot-md glass rounded-bl-md"
              }`}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.text}</p>
              ) : (
                <Markdown text={m.text} />
              )}
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex justify-end">
            <div className="glass flex items-center gap-2 rounded-2xl rounded-bl-md px-3 py-2">
              <span className="dot-flash h-1.5 w-1.5 rounded-full bg-brand-500" />
              <span className="dot-flash h-1.5 w-1.5 rounded-full bg-brand-500 [animation-delay:180ms]" />
              <span className="dot-flash h-1.5 w-1.5 rounded-full bg-brand-500 [animation-delay:360ms]" />
              {status ? (
                <span className="mr-1 text-[10.5px] font-semibold text-ink-500 dark:text-ink-400">
                  {status}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* input */}
      <div className="border-t border-white/40 p-2.5 dark:border-white/6">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            dir="rtl"
            rows={1}
            className="field-scroll max-h-24 min-h-[2.4rem] flex-1 resize-none rounded-2xl border border-ink-500/12 bg-white/70 px-3 py-2 text-[12.5px] outline-none transition-colors focus:border-brand-500/50 dark:bg-ink-900/60 dark:text-ink-100"
            placeholder="پیام خود را بنویسید…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button
              className="btn btn-glass h-[2.4rem] w-[2.4rem] !rounded-2xl !p-0"
              onClick={stop}
              title="توقف"
              aria-label="توقف پاسخ"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="btn btn-primary h-[2.4rem] w-[2.4rem] !rounded-2xl !p-0"
              onClick={() => void send()}
              disabled={!input.trim()}
              title="ارسال"
              aria-label="ارسال پیام"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        {chats.length > 1 ? (
          <p className="mt-1.5 px-1 text-[9.5px] text-ink-400">
            گفتگوی فعال: {chats.find((c) => c.id === chatId)?.title ?? "—"} · با دکمه
            بالای پنل گفتگوی جدید بسازید
          </p>
        ) : null}
      </div>

      {/* write-confirmation dialog (the trusted gate) */}
      {confirm ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/35 p-4 backdrop-blur-[2px]">
          <div className="glass w-full max-w-[19rem] rounded-3xl p-4 text-right">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-extrabold text-amber-600 dark:text-amber-300">
              <ShieldQuestion size={16} />
              تأیید عملیات هوش مصنوعی
            </div>
            <p className="mb-1 text-[11.5px] leading-6 text-ink-600 dark:text-ink-300">
              هوش مصنوعی می‌خواهد این عملیات نوشتاری را اجرا کند:
            </p>
            <p className="mb-2 text-[12px] font-bold">{confirm.description}</p>
            <div className="mb-3 max-h-32 overflow-y-auto rounded-2xl bg-ink-500/6 p-2.5">
              <pre dir="ltr" className="text-left text-[10px] leading-5 whitespace-pre-wrap">
                {JSON.stringify(confirm.args, null, 2)}
              </pre>
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-sm flex-1"
                onClick={() => {
                  confirmResolveRef.current = null;
                  confirm.resolve(true);
                  setConfirm(null);
                }}
              >
                <Check size={14} /> اجازه می‌دهم
              </button>
              <button
                className="btn btn-glass btn-sm flex-1"
                onClick={() => {
                  confirmResolveRef.current = null;
                  confirm.resolve(false);
                  setConfirm(null);
                }}
              >
                رد کردن
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
