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
 *  - کتابخانه: folders + images, drag & drop everywhere, re-open in the
 *    editor, whole-scope ZIP export or straight into an OS folder (Chrome).
 *
 * The top search bar jumps straight into any customer's or employer's پرونده.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, ImagePlus, Search, UserRound, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { ImageEditor } from "../components/studio/ImageEditor";
import { StudioLibrary } from "../components/studio/StudioLibrary";
import { QuickConvert } from "../components/studio/QuickConvert";
import { takePendingSource, type StudioSource } from "../lib/studio/session";
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

/** The jump search: customers + employers, one tap → their پرونده. */
function JumpSearch() {
  const navigate = useNavigate();
  const customers = useCustomers();
  const employers = useEmployers();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

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

  const go = (r: JumpResult) => {
    setQuery("");
    setOpen(false);
    navigate(r.type === "customer" ? `/customers/${r.id}` : `/employers/${r.id}`);
  };

  return (
    <div ref={boxRef} className="relative z-10">
      <div className="glass flex items-center gap-2 rounded-2xl px-3.5 py-2.5">
        <Search size={17} className="shrink-0 text-ink-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0]);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="جستجوی مشتری یا کارفرما — وارد شدن سریع به پرونده…"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-ink-400"
        />
        {query && (
          <button
            className="icon-btn !h-7 !w-7"
            aria-label="پاک کردن"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim() !== "" && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-ink-900/8 bg-white/95 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-900/95">
            {results.length === 0 ? (
              <p className="px-4 py-3.5 text-center text-[12px] text-ink-400">موردی یافت نشد</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {results.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-right transition-colors hover:bg-brand-500/8"
                      onClick={() => go(r)}
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

