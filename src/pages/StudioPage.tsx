/**
 * ابزار عکس — the professional image tools section.
 *
 * Three organized surfaces (بخش بخش، منظم و زیبا) + a jump search on top:
 *  - ویرایشگر: crop / pixel resize / rotate & flip (90° + fine) / adjustments /
 *    strong compression with live size estimate / undo-redo / small download
 *    chips for every format / save into the in-app library / «ذخیره در پرونده»
 *    when opened from a customer or employer document (replaces in place) /
 *    «ذخیره عکس پروفایل» when opened from an avatar.
 *  - تبدیل سریع: drop PDFs → every page becomes an editable image tile; edit
 *    one instantly, download the batch, or save everything into the library.
 *  - کتابخانه: the SAME Windows-style explorer as لیست‌ها — nested folders,
 *    breadcrumb + back button, شبکه/فهرست views — with rich drag & drop:
 *    OS files or image cards onto folder tiles/breadcrumbs, folder tiles into
 *    each other, multi-select batch moves, re-open in the editor, whole-scope
 *    ZIP export or straight into an OS folder (Chrome).
 *
 * The top search bar jumps straight into any customer's or employer's پرونده.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, History, ImagePlus, Search, Undo2, UserRound, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { ImageEditor } from "../components/studio/ImageEditor";
import { StudioLibrary } from "../components/studio/StudioLibrary";
import { QuickConvert } from "../components/studio/QuickConvert";
import { takePendingSource, type StudioSource } from "../lib/studio/session";
import {
  getJumpHistory,
  nextRecall,
  pushJumpHistory,
  recentQueries,
  type JumpHistoryEntry,
} from "../lib/studio/jumpHistory";
import { useStudioImages, useCustomers, useEmployers } from "../hooks/useData";
import { customerFullName } from "../db/customers";
import { normalizeFa } from "../utils/normalize";
import { toPersianDigits } from "../utils/jalali";
import { useToast } from "../hooks/useToast";

interface JumpResult {
  id: string;
  type: "customer" | "employer";
  title: string;
  subtitle: string;
}

/** The jump search: customers + employers, one tap → their پرونده.
 *
 *  History (سابقه): the last 8 jumps live under the box whenever it's empty —
 *  «حداقل ۵ تا سابقه» — and the previous queries come back two ways: the
 *  recall ARROW beside the input (always works — «بک‌اسپیس کار نمیکنه» on
 *  Persian mobile keyboards, which skip keydown on empty inputs) and
 *  Backspace on the empty input (desktop keydown + native beforeinput for
 *  mobile IMEs). Both step newest → oldest and wrap around.
 *
 *  The whole bar is STICKY under the top bar (top-16): the arrow stays
 *  reachable while scrolling, gaining a soft backdrop only once floating. */
function JumpSearch() {
  const navigate = useNavigate();
  const customers = useCustomers();
  const employers = useEmployers();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<JumpHistoryEntry[]>([]);
  const [stuck, setStuck] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** Cursor into the Backspace recall chain (recent queries, newest first). */
  const recallIdx = useRef(0);
  /** Latest recall callback for the native beforeinput listener. */
  const recallRef = useRef<() => void>(() => {});

  useEffect(() => {
    setHistory(getJumpHistory());
  }, []);

  const queries = useMemo(() => recentQueries(history), [history]);

  const results = useMemo<JumpResult[]>(() => {
    const q = normalizeFa(query.trim());
    if (!q) return [];
    const out: JumpResult[] = [];
    for (const c of customers ?? []) {
      const name = customerFullName(c);
      if (normalizeFa(`${name} ${c.passportNo ?? ""}`).includes(q)) {
        out.push({
          id: c.id,
          type: "customer",
          title: name,
          subtitle: `مشتری${c.passportNo ? ` • ${c.passportNo}` : ""}`,
        });
      }
      if (out.length >= 8) break;
    }
    for (const e of employers ?? []) {
      if (out.length >= 10) break;
      if (normalizeFa(e.name).includes(q)) {
        out.push({ id: e.id, type: "employer", title: e.name, subtitle: "کارفرما" });
      }
    }
    return out;
  }, [query, customers, employers]);

  const go = (r: JumpResult, queryUsed: string) => {
    pushJumpHistory({
      id: r.id,
      type: r.type,
      title: r.title,
      subtitle: r.subtitle,
      query: queryUsed.trim(),
    });
    setHistory(getJumpHistory());
    recallIdx.current = 0;
    setQuery("");
    setOpen(false);
    navigate(r.type === "customer" ? `/customers/${r.id}` : `/employers/${r.id}`);
  };

  /** One step back through the previous queries (arrow or backspace): the
   *  restored text arrives fully selected, so typing replaces it and the next
   *  Backspace clears it — a natural step-by-step rhythm. */
  const recallPrevious = () => {
    const { query: q, next } = nextRecall(queries, recallIdx.current);
    if (q === null) return;
    recallIdx.current = next;
    setQuery(q);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };
  recallRef.current = () => recallPrevious();

  /* Sticky detection: the bar clamps at top-16 (the top bar's height) while
   * scrolling — exactly when it floats over content and needs the soft
   * backdrop. One rect read per scroll event; state flips only on change. */
  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current;
      if (el) setStuck(el.getBoundingClientRect().top <= 65);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /* Mobile backspace: Persian IMEs usually DON'T fire keydown on an empty
   * input — the native beforeinput (deleteContentBackward) still fires, so
   * the recall works on phones too. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === "deleteContentBackward" && el.value === "") {
        e.preventDefault();
        recallRef.current();
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`sticky jump-search-wrap top-16 z-20 -mx-4 px-4 py-1.5 transition-all duration-200 sm:-mx-6 sm:px-6 ${
        stuck
          ? "bg-white/80 shadow-[0_14px_34px_-22px_rgba(30,27,75,0.5)] backdrop-blur-xl dark:bg-ink-950/80"
          : ""
      }`}
    >
      {/* z-10: the bar itself stays ABOVE its own click-outside overlay, so
          the recall arrow / clear button stay clickable while the dropdown is
          open (the overlay only swallows clicks elsewhere on the page). */}
      <div className="glass relative z-10 flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            // Typing restarts the recall chain; CLEARING (backspace on a
            // recalled selection) keeps the cursor so the next Backspace
            // continues stepping back through previous queries.
            if (v !== "") recallIdx.current = 0;
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && query === "") {
              e.preventDefault();
              recallPrevious();
              return;
            }
            if (e.key === "Enter") {
              if (results[0]) go(results[0], query);
              else if (history[0]) go(history[0], history[0].query);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="جستجوی مشتری یا کارفرما — وارد شدن سریع به پرونده…"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-ink-400"
        />
        {/* Recall arrow — the always-visible, always-working «جستجوی قبلی»:
            one tap = one step back through the previous queries. */}
        {queries.length > 0 && (
          <button
            className="icon-btn !h-7 !w-7 shrink-0 !text-brand-600 dark:!text-brand-300"
            aria-label="جستجوی قبلی"
            title="جستجوی قبلی — یک قدم به عقب"
            onClick={recallPrevious}
          >
            <Undo2 size={14} />
          </button>
        )}
        {query && (
          <button
            className="icon-btn !h-7 !w-7"
            aria-label="پاک کردن"
            onClick={() => {
              setQuery("");
              recallIdx.current = 0;
              setOpen(false);
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-ink-900/8 bg-white/95 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-900/95">
            {query.trim() !== "" ? (
              results.length === 0 ? (
                <p className="px-4 py-3.5 text-center text-[12px] text-ink-400">موردی یافت نشد</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {results.map((r) => (
                    <li key={`${r.type}-${r.id}`}>
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-right transition-colors hover:bg-brand-500/8"
                        onClick={() => go(r, query)}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                            r.type === "customer"
                              ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
                              : "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]"
                          }`}
                        >
                          {r.type === "customer" ? <UserRound size={15} /> : <Building2 size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{r.title}</span>
                          <span className="block truncate text-[10.5px] text-ink-400">{r.subtitle}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : history.length > 0 ? (
              <div>
                <p className="flex items-center gap-2 border-b border-ink-900/6 px-3.5 py-2 text-[11px] font-bold text-ink-500 dark:border-white/8 dark:text-ink-400">
                  <History size={13} className="text-brand-600 dark:text-brand-300" />
                  سابقهٔ جستجو
                  <span className="num chip-soft rounded-full px-2 py-0.5 text-[10px]">
                    {toPersianDigits(history.length)}
                  </span>
                  <span className="mr-auto text-[10px] font-medium text-ink-400">
                    فلش یا ⌫ = جستجوی قبلی
                  </span>
                </p>
                <ul className="max-h-72 overflow-y-auto">
                  {history.map((h) => (
                    <li key={`${h.type}-${h.id}`}>
                      <button
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-right transition-colors hover:bg-brand-500/8"
                        onClick={() => go(h, h.query)}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                            h.type === "customer"
                              ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
                              : "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]"
                          }`}
                        >
                          {h.type === "customer" ? <UserRound size={15} /> : <Building2 size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{h.title}</span>
                          <span className="block truncate text-[10.5px] text-ink-400">
                            {h.subtitle}
                          </span>
                        </span>
                        {h.query && (
                          <span
                            dir="auto"
                            className="chip-soft hidden max-w-24 truncate rounded-full px-2 py-0.5 text-[10px] text-ink-500 dark:text-ink-400 sm:inline-block"
                          >
                            {h.query}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="px-4 py-3.5 text-center text-[12px] leading-6 text-ink-400">
                نام مشتری یا کارفرما را بنویسید تا مستقیم به پرونده‌اش بپرید.
                <br />
                سابقهٔ جستجوهایتان اینجا نگه داشته می‌شود.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function StudioPage() {
  const location = useLocation();
  const toast = useToast();
  const images = useStudioImages();

  const [tab, setTab] = useState<"editor" | "convert" | "library">("editor");
  /** Keyed source — changing the key remounts the editor for a fresh load. */
  const [source, setSource] = useState<StudioSource | null>(null);
  const [sourceKey, setSourceKey] = useState(0);
  /** PDFs forwarded from the editor land on the convert board. */
  const [forwardedPdfs, setForwardedPdfs] = useState<File[] | undefined>(undefined);

  // Consume anything opened from a profile or the library itself.
  useEffect(() => {
    const pending = takePendingSource();
    if (pending) {
      setSource(pending.source);
      setSourceKey((k) => k + 1);
      setTab("editor");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const openEditorWith = (next: StudioSource) => {
    setSource(next);
    setSourceKey((k) => k + 1);
    setTab("editor");
  };

  const totalBytes = (images ?? []).reduce((s, i) => s + i.size, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back
        title="ابزار عکس"
        subtitle={`ویرایشگر حرفه‌ای + تبدیل سریع PDF + کتابخانهٔ پوشه‌بندی‌شده (${toPersianDigits(images?.length ?? 0)} تصویر)`}
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              openEditorWith({ kind: "files", files: [] })
            }
          >
            <ImagePlus size={15} /> تصویر جدید
          </button>
        }
      />

      {/* Jump search — customers & employers → پرونده */}
      <JumpSearch />

      <Tabs
        active={tab}
        onActiveChange={(key) => setTab(key === "library" ? "library" : key === "convert" ? "convert" : "editor")}
        tabs={[
          {
            key: "editor",
            label: "ویرایشگر",
            content: (
              <ImageEditor
                key={sourceKey}
                source={source}
                onClearSource={() => setSource(null)}
                librarySlot={{
                  onOpenLibraryTab: () => setTab("library"),
                  onForwardPdfs: (pdfs) => {
                    setForwardedPdfs(pdfs);
                    setTab("convert");
                    toast.info(
                      pdfs.length > 1
                        ? `${toPersianDigits(pdfs.length)} فایل PDF به «تبدیل سریع» فرستاده شد`
                        : "فایل PDF به «تبدیل سریع» فرستاده شد",
                    );
                  },
                }}
              />
            ),
          },
          {
            key: "convert",
            label: "تبدیل سریع",
            content: (
              <QuickConvert
                initialFiles={forwardedPdfs}
                onEdit={(file) => openEditorWith({ kind: "files", files: [file] })}
              />
            ),
          },
          {
            key: "library",
            label: `کتابخانه (${toPersianDigits(images?.length ?? 0)})`,
            content: (
              <StudioLibrary
                onEditInStudio={(image) => openEditorWith({ kind: "library", image })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

