/**
 * دستیار هوشمند — the Central AI Agent chat page (مغز متفکر).
 *
 * A full conversational surface for the tool-calling agent: conversation
 * history (IndexedDB), image/PDF attachments, live tool-step chips, worker
 * badges (multi-account), rich-markdown answers and a welcoming empty state
 * with one-tap suggestions.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PenLine,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { db } from "../db/schema";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { ACCEPTED_MIME, imageFileToJpeg, pdfToJpegs } from "../lib/ai/imaging";
import { useAiWorkers } from "../lib/ai/store";
import { listChats, createChat, appendMessages, deleteChat, updateChatTitle } from "../lib/agent/chats";
import { runAgentTurn } from "../lib/agent/agent";
import type { AgentAttachment, AgentMessage, AgentToolStep } from "../lib/agent/types";
import { Markdown } from "../components/agent/Markdown";
import { BottomSheet, Modal } from "../components/ui/Modal";

const MAX_ATTACH = 8;

/* --------------------------- attachment preparation ------------------------ */

function shrinkThumb(full: string, edge = 180): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(full);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve(full);
    img.src = full;
  });
}

async function prepareAttachments(files: File[]): Promise<{ list: AgentAttachment[]; skipped: string[] }> {
  const list: AgentAttachment[] = [];
  const skipped: string[] = [];
  let n = 0;
  for (const f of files) {
    if (list.length >= MAX_ATTACH) { skipped.push(f.name); continue; }
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    try {
      if (isPdf) {
        const pages = await pdfToJpegs(f);
        const base = f.name.replace(/\.pdf$/i, "") || "سند";
        for (let i = 0; i < pages.length && list.length < MAX_ATTACH; i++) {
          const full = pages[i];
          list.push({ id: `a${Date.now()}-${n++}`, name: `${base} — صفحهٔ ${i + 1}`, thumb: await shrinkThumb(full), full });
        }
      } else {
        const full = await imageFileToJpeg(f);
        list.push({ id: `a${Date.now()}-${n++}`, name: f.name || "تصویر", thumb: await shrinkThumb(full), full });
      }
    } catch {
      skipped.push(f.name);
    }
  }
  return { list, skipped };
}

/* ------------------------------- tool steps chip --------------------------- */

function ToolSteps({ steps }: { steps: AgentToolStep[] }) {
  const [open, setOpen] = useState(false);
  const okCount = steps.filter((s) => s.result.ok).length;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-ink-900/6 px-2.5 py-1 text-[11px] font-bold text-ink-600 transition-colors hover:bg-ink-900/10 dark:bg-white/8 dark:text-ink-300 dark:hover:bg-white/12"
      >
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {okCount === steps.length ? "✓" : "⚠"} {steps.length.toLocaleString("fa-IR")} ابزار اجرا شد
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 pr-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-[11.5px] leading-5">
              {s.result.ok ? (
                <CheckCircle2 size={13} className="shrink-0 text-emerald-500" aria-hidden />
              ) : (
                <AlertTriangle size={13} className="shrink-0 text-rose-500" aria-hidden />
              )}
              <code dir="ltr" className="rounded bg-ink-900/6 px-1 py-0.5 font-mono text-[10.5px] dark:bg-white/10">{s.call.name}</code>
              <span className="min-w-0 flex-1 text-ink-600 dark:text-ink-300">{s.result.summary}</span>
              <span dir="ltr" className="shrink-0 font-mono text-[10px] text-ink-400">{s.result.ms}ms</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------- messages -------------------------------- */

function FilesRow({ files }: { files: AgentAttachment[] }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {files.map((f) => (
        <img
          key={f.id}
          src={f.thumb}
          alt={f.name}
          title={f.name}
          className="h-16 w-16 rounded-xl border border-ink-900/10 object-cover dark:border-white/10"
        />
      ))}
    </div>
  );
}

function Bubble({ m }: { m: AgentMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end" dir="rtl">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-l from-brand-600 to-[#7c3aed] px-3.5 py-2.5 text-[13.5px] leading-7 text-white shadow-lg shadow-brand-600/20 sm:max-w-[75%]">
          {m.files && m.files.length > 0 && <FilesRow files={m.files} />}
          {m.text && <p className="whitespace-pre-line">{m.text}</p>}
        </div>
      </div>
    );
  }
  if (m.error) {
    return (
      <div className="flex justify-start" dir="rtl">
        <div className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-md bg-rose-500/8 px-3.5 py-2.5 text-[12.5px] leading-6 text-rose-700 dark:text-rose-300 sm:max-w-[75%]">
          <AlertTriangle size={15} className="mt-1 shrink-0" aria-hidden />
          <span className="whitespace-pre-line">{m.error === "stopped" ? "⏹ متوقف شد." : m.error}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start" dir="rtl">
      <div className="glass-soft max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 sm:max-w-[80%]">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={13} className="text-brand-500" aria-hidden />
          <span className="text-[11px] font-extrabold text-brand-600 dark:text-brand-300">دستیار</span>
          {m.worker && (
            <span className="rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300">
              {m.worker}
            </span>
          )}
        </div>
        <Markdown text={m.text} />
        {m.steps && m.steps.length > 0 && <ToolSteps steps={m.steps} />}
      </div>
    </div>
  );
}

/* ---------------------------------- page ----------------------------------- */

const SUGGESTIONS: { icon: string; label: string; prompt: string }[] = [
  { icon: "🧪", label: "تست اکانت‌های هوش مصنوعی", prompt: "همهٔ اکانت‌های هوش مصنوعی من را تست کن؛ کدام‌ها سالم‌اند و چه تأخیری دارند؟" },
  { icon: "📅", label: "گزارش یک روز", prompt: "یک گزارش کامل از درخواست‌هایی که امروز ثبت شده‌اند بده؛ جدا برای هر نماینده با جدول." },
  { icon: "🏢", label: "آمار کارفرمایان", prompt: "کارفرمایان را با تعداد مشتریان هر کدام فهرست کن." },
  { icon: "🌙", label: "تم تیره", prompt: "تم برنامه را تیره کن." },
  { icon: "🔍", label: "وضعیت صدور", prompt: "چند درخواست ویزا صادر شده و چند تا در حال کار است؟ به تفکیک نوع ویزا." },
  { icon: "🧾", label: "خلاصهٔ مالی", prompt: "خلاصهٔ مالی بده: مجموع پرداخت‌های نمایندگان به تفکیک ارز و ماندهٔ حساب‌های حسابداری." },
];

export function AgentChatPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const workers = useAiWorkers();
  const hasWorker = (workers ?? []).some((w) => w.enabled && w.url.trim() && w.key.trim());

  const chats = useLiveQuery(() => listChats(), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeChat = useLiveQuery(() => (activeId ? db.aiChats.get(activeId) : undefined), [activeId]);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [renameFor, setRenameFor] = useState<{ id: string; title: string } | null>(null);
  const [renameText, setRenameText] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeChat?.messages ?? [];
  const lastLen = messages.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: lastLen > 2 ? "smooth" : "auto", block: "end" });
  }, [lastLen, status]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy, activeId]);

  const suggestions = useMemo(() => SUGGESTIONS, []);

  /* ------------------------------- sending -------------------------------- */

  const send = async (rawText?: string) => {
    const body = (rawText ?? text).trim();
    const files = attachments;
    if (!body && files.length === 0) return;
    if (busy) return;
    if (!hasWorker) {
      toast.error("اول یک ورکر هوش مصنوعی در تنظیمات اضافه کنید.");
      return;
    }
    setText("");
    setAttachments([]);
    setBusy(true);
    setStatus("در حال فکر کردن…");

    const userMsg: AgentMessage = {
      role: "user",
      text: body,
      ts: Date.now(),
      files: files.length > 0 ? files : undefined,
    };

    let chatId = activeId;
    let history: AgentMessage[] = [];
    if (chatId) {
      const rec = await db.aiChats.get(chatId);
      history = rec?.messages ?? [];
    }
    if (!chatId) {
      const rec = await createChat(userMsg);
      chatId = rec.id;
      setActiveId(rec.id);
    } else {
      await appendMessages(chatId, [userMsg]);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await runAgentTurn(
        { history, text: body, files },
        {
          ctx: { navigate: (to) => navigate(to) },
          signal: controller.signal,
          maxRounds: 8,
          events: {
            onStatus: (s) => setStatus(s),
            onToolCalls: (calls) => setStatus(`اجرای ${calls.length.toLocaleString("fa-IR")} ابزار…`),
            onToolResult: (r) => setStatus(r.summary ?? r.name),
          },
        },
      );
      if (res.kind === "aborted") {
        await appendMessages(chatId, [{ role: "assistant", text: "", ts: Date.now(), error: "stopped" }]);
      } else if (res.kind === "answer") {
        await appendMessages(chatId, [
          { role: "assistant", text: res.text, ts: Date.now(), steps: res.steps, worker: res.worker },
        ]);
      } else {
        await appendMessages(chatId, [{ role: "assistant", text: "", ts: Date.now(), error: res.message }]);
      }
    } catch (e) {
      await appendMessages(chatId ?? "", [
        { role: "assistant", text: "", ts: Date.now(), error: e instanceof Error ? e.message : "خطای ناشناخته" },
      ]);
    } finally {
      setBusy(false);
      setStatus("");
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const onPickFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (attachments.length >= MAX_ATTACH) {
      toast.error(`حداکثر ${MAX_ATTACH.toLocaleString("fa-IR")} فایل در هر پیام.`);
      return;
    }
    setStatus("آماده‌سازی فایل‌ها…");
    try {
      const { list, skipped } = await prepareAttachments(files);
      if (list.length === 0) {
        toast.error("از این فایل‌ها تصویری ساخته نشد.");
      } else {
        setAttachments((cur) => [...cur, ...list].slice(0, MAX_ATTACH));
        if (skipped.length > 0) toast.error(`بعضی فایل‌ها خوانده نشد: ${skipped[0]}${skipped.length > 1 ? " و…" : ""}`);
      }
    } catch {
      toast.error("آماده‌سازی فایل‌ها با خطا مواجه شد.");
    } finally {
      setStatus("");
    }
  };

  const removeChat = async (id: string) => {
    const ok = await confirm({
      title: "حذف گفتگو؟",
      message: "این گفتگو با تمام پیام‌هایش برای همیشه حذف می‌شود.",
      confirmLabel: "حذف",
      danger: true,
    });
    if (!ok) return;
    await deleteChat(id);
    if (activeId === id) setActiveId(null);
  };

  const startRename = (chat: { id: string; title: string }) => {
    setRenameFor(chat);
    setRenameText(chat.title);
  };
  const commitRename = async () => {
    if (renameFor) await updateChatTitle(renameFor.id, renameText);
    setRenameFor(null);
  };

  /* ------------------------------- sidebar -------------------------------- */

  const ChatList = ({ onPick }: { onPick?: () => void }) => (
    <div className="flex min-h-0 flex-col gap-2">
      <button
        type="button"
        className="btn btn-primary w-full"
        onClick={() => { setActiveId(null); onPick?.(); }}
      >
        <MessageSquarePlus size={16} /> گفتگوی جدید
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto pl-0.5">
        {(chats ?? []).length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-ink-500 dark:text-ink-400">
            هنوز گفتگویی ثبت نشده است.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {(chats ?? []).map((c) => (
            <li key={c.id}>
              <div
                className={`group flex items-center gap-1.5 rounded-xl px-2.5 py-2 transition-colors ${
                  c.id === activeId
                    ? "bg-brand-500/12 text-brand-700 dark:text-brand-200"
                    : "hover:bg-ink-900/5 dark:hover:bg-white/6"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-right"
                  onClick={() => { setActiveId(c.id); onPick?.(); }}
                >
                  <span className="block truncate text-[12.5px] font-bold">{c.title}</span>
                  <span className="block text-[10.5px] text-ink-500 dark:text-ink-400" dir="rtl">
                    {new Date(c.updatedAt).toLocaleDateString("fa-IR", { month: "long", day: "numeric" })}
                    {" — "}
                    {new Date(c.updatedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="تغییر نام"
                  title="تغییر نام"
                  className="rounded-lg p-1 text-ink-400 opacity-0 transition-opacity hover:bg-ink-900/8 group-hover:opacity-100 dark:hover:bg-white/10"
                  onClick={() => startRename(c)}
                >
                  <PenLine size={13} />
                </button>
                <button
                  type="button"
                  aria-label="حذف"
                  title="حذف"
                  className="rounded-lg p-1 text-ink-400 opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100"
                  onClick={() => void removeChat(c.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="flex h-[calc(100dvh-12.75rem)] min-h-[24rem] flex-col" dir="rtl">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-3 px-3 pb-3 sm:px-4">
        {/* ---- sidebar (desktop) ---- */}
        <aside className="glass hidden w-64 shrink-0 flex-col rounded-2xl p-2.5 md:flex">
          <ChatList />
        </aside>

        {/* ---- main column ---- */}
        <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          {/* header */}
          <header className="flex items-center gap-2 border-b border-ink-900/8 px-3 py-2.5 dark:border-white/10">
            <button
              type="button"
              className="btn btn-glass btn-sm md:hidden"
              aria-label="گفتگوها"
              onClick={() => setListOpen(true)}
            >
              <History size={15} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-l from-[#6366f1] to-[#d946ef] text-white shadow-lg shadow-[#6366f1]/30">
                <Sparkles size={14} aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[13.5px] font-extrabold">دستیار هوشمند</h1>
                <p className="truncate text-[10.5px] text-ink-500 dark:text-ink-400">
                  {activeChat ? activeChat.title : "مغز متفکر برنامه — هر درخواستی، هر کاری"}
                </p>
              </div>
            </div>
            {activeChat && (
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-glass btn-sm" onClick={() => startRename(activeChat)} aria-label="تغییر نام">
                  <PenLine size={14} />
                </button>
                <button type="button" className="btn btn-glass btn-sm" onClick={() => void removeChat(activeChat.id)} aria-label="حذف گفتگو">
                  <Trash2 size={14} />
                </button>
                <button type="button" className="btn btn-glass btn-sm" onClick={() => setActiveId(null)} aria-label="گفتگوی جدید">
                  <MessageSquarePlus size={14} />
                </button>
              </div>
            )}
          </header>

          {/* messages */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {!activeChat ? (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-l from-[#6366f1] via-[#8b5cf6] to-[#d946ef] text-white shadow-xl shadow-[#6366f1]/35">
                  <Sparkles size={30} aria-hidden />
                </span>
                <div>
                  <h2 className="text-[17px] font-black">دستیار هوشمند سامانه</h2>
                  <p className="mt-1 text-[12.5px] leading-6 text-ink-500 dark:text-ink-400">
                    به داده‌ها و همهٔ امکانات برنامه دسترسی دارد: جستجو، ثبت مشتری و درخواست، گزارش،
                    دانلود مدارک، حسابداری، تست اکانت‌ها و… عکس و PDF هم بفرست — خودش می‌خواند.
                  </p>
                </div>
                {!hasWorker && (
                  <Link to="/settings?tab=ai" className="flex items-center gap-2 rounded-2xl bg-amber-500/12 px-3.5 py-2.5 text-[12px] font-bold text-amber-700 dark:text-amber-300">
                    <Settings2 size={14} /> برای شروع، یک ورکر هوش مصنوعی در تنظیمات فعال کنید
                  </Link>
                )}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={!hasWorker}
                      onClick={() => void send(s.prompt)}
                      className="rounded-full border border-ink-900/10 bg-white/60 px-3 py-1.5 text-[12px] font-bold text-ink-700 transition-all hover:border-brand-400 hover:text-brand-700 disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-ink-200 dark:hover:text-brand-300"
                    >
                      <span aria-hidden>{s.icon}</span> {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {messages.map((m, i) => (
                  <Bubble key={i} m={m} />
                ))}
                {busy && (
                  <div className="flex justify-start" dir="rtl">
                    <div className="glass-soft flex items-center gap-2 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[12.5px] text-ink-600 dark:text-ink-300">
                      <Loader2 size={14} className="animate-spin text-brand-500" aria-hidden />
                      {status || "در حال فکر کردن…"}
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {/* composer */}
          <div className="border-t border-ink-900/8 px-3 py-2.5 dark:border-white/10">
            {!activeChat && !hasWorker ? null : (
              <>
                {attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {attachments.map((f) => (
                      <span key={f.id} className="relative">
                        <img src={f.thumb} alt={f.name} title={f.name} className="h-14 w-14 rounded-xl border border-ink-900/10 object-cover dark:border-white/10" />
                        <button
                          type="button"
                          aria-label="حذف فایل"
                          onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== f.id))}
                          className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPTED_MIME}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void onPickFiles(files);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-glass btn-sm h-9 w-9 shrink-0 !rounded-xl"
                    aria-label="پیوست فایل"
                    title="پیوست عکس یا PDF"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    placeholder="هر چیزی بپرس یا بخواه… (Shift+Enter = خط جدید)"
                    className="max-h-40 min-h-9 flex-1 resize-none rounded-xl border border-ink-900/10 bg-white/70 px-3 py-2 text-[13.5px] leading-7 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-400 dark:border-white/12 dark:bg-white/5"
                  />
                  {busy ? (
                    <button type="button" className="btn btn-sm h-9 w-9 !rounded-xl bg-rose-500 text-white hover:bg-rose-600" onClick={stop} aria-label="توقف">
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm h-9 w-9 !rounded-xl bg-gradient-to-l from-[#6366f1] to-[#d946ef] text-white shadow-lg shadow-[#6366f1]/35 hover:brightness-110"
                      aria-label="ارسال"
                      onClick={() => void send()}
                      disabled={(!text.trim() && attachments.length === 0) || !hasWorker}
                    >
                      <ArrowUp size={16} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* mobile chat list */}
      <BottomSheet open={listOpen} onClose={() => setListOpen(false)}>
        <div className="flex max-h-[60vh] flex-col gap-2">
          <ChatList onPick={() => setListOpen(false)} />
        </div>
      </BottomSheet>

      {/* rename modal */}
      <Modal
        open={renameFor !== null}
        onClose={() => setRenameFor(null)}
        title="تغییر نام گفتگو"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-glass" onClick={() => setRenameFor(null)}>انصراف</button>
            <button className="btn btn-primary" onClick={() => void commitRename()}>ذخیره</button>
          </div>
        }
      >
        <input
          value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          className="w-full rounded-xl border border-ink-900/10 bg-white/70 px-3 py-2 text-[13.5px] outline-none focus:border-brand-400 dark:border-white/12 dark:bg-white/5"
          placeholder="نام گفتگو"
        />
      </Modal>
    </div>
  );
}
