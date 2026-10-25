import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSearch, FolderOpen, Search, User, UserRound } from "lucide-react";
import type { Customer, CustomFieldDef, ListFolder, Representative, Tag, VisaRequest } from "../../types";
import { buildSearchDataset, searchDataset, type SearchHit } from "../../services/search";
import { customerFullName } from "../../db/customers";
import { normalizeFa } from "../../utils/normalize";
import { Floating, isFloatingPanel } from "../ui/Floating";

const TYPE_LABELS: Record<string, string> = {
  customer: "مشتری",
  representative: "نماینده",
  request: "درخواست",
  list: "لیست",
};

const TYPE_ICONS = {
  customer: User,
  representative: UserRound,
  request: FileSearch,
  list: FolderOpen,
};

/** Compact global search for the top bar with a live grouped dropdown. */
export function GlobalSearch({
  customers,
  representatives,
  requests,
  lists,
  tags,
  customFields,
  className = "",
}: {
  customers: Customer[];
  representatives: Representative[];
  requests: VisaRequest[];
  lists: ListFolder[];
  tags: Tag[];
  customFields: CustomFieldDef[];
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  const dataset = useMemo(
    () => buildSearchDataset(customers, representatives, requests, lists, tags, customFields),
    [customers, representatives, requests, lists, tags, customFields],
  );

  const hits = useMemo(() => {
    if (normalizeFa(query).length < 2) return [] as SearchHit[];
    return searchDataset(query, dataset, {}, 3);
  }, [query, dataset]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(t) && !isFloatingPanel(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    const paths: Record<string, (id: string) => string> = {
      customer: (id) => `/customers/${id}`,
      representative: (id) => `/representatives/${id}`,
      request: (id) => `/requests/${id}/edit`,
      list: (id) => `/lists/${id}`,
    };
    navigate(paths[hit.type](hit.id));
  };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <div className="relative">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          className="field !py-2 pr-9 text-[13px]"
          placeholder="جستجوی سراسری… (نام، پاسپورت، شماره تماس)"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
              setOpen(false);
            }
          }}
        />
      </div>
      {open && normalizeFa(query).length >= 2 && (
        <Floating
          open={open}
          anchorRef={wrapRef}
          matchAnchorWidth
          placement="bottom"
          className="overflow-hidden rounded-2xl"
          onClose={() => setOpen(false)}
        >
          {hits.length === 0 ? (
            <p className="px-4 py-4 text-center text-xs text-ink-400">نتیجه‌ای یافت نشد</p>
          ) : (
            <>
              {(["customer", "representative", "request", "list"] as const).map((type) => {
                const group = hits.filter((h) => h.type === type).slice(0, 3);
                if (group.length === 0) return null;
                const Icon = TYPE_ICONS[type];
                return (
                  <div key={type} className="border-b border-ink-900/5 py-1.5 last:border-0 dark:border-white/5">
                    <p className="px-3.5 py-1 text-[10px] font-bold text-ink-400">
                      {TYPE_LABELS[type]} ({group.length})
                    </p>
                    {group.map((hit) => (
                      <button
                        key={`${hit.type}-${hit.id}`}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-right hover:bg-brand-500/10"
                        onClick={() => go(hit)}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{hit.title}</span>
                          {hit.subtitle && (
                            <span className="block truncate text-[11px] text-ink-500 dark:text-ink-400">
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
              <button
                className="w-full bg-brand-500/8 px-4 py-2.5 text-center text-xs font-bold text-brand-600 hover:bg-brand-500/14 dark:text-brand-300"
                onClick={() => {
                  navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                  setOpen(false);
                }}
              >
                نمایش همه نتایج در صفحه جستجو
              </button>
            </>
          )}
        </Floating>
      )}
    </div>
  );
}

export { customerFullName };
