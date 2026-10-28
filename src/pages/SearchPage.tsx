import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileSearch, Filter, FolderOpen, Search, User, UserRound } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SearchBox } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { GlassCard } from "../components/ui/GlassCard";
import { buildSearchDataset, isHighlightPart, searchDataset, splitHighlight, type SearchHit } from "../services/search";
import {
  useCustomFields,
  useCustomers,
  useLists,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { toPersianDigits } from "../utils/jalali";
import { normalizeFa } from "../utils/normalize";

const TYPE_META = {
  customer: { label: "مشتریان", icon: User, path: (id: string) => `/customers/${id}` },
  representative: { label: "نمایندگان", icon: UserRound, path: (id: string) => `/representatives/${id}` },
  request: { label: "درخواست‌ها", icon: FileSearch, path: (id: string) => `/requests/${id}/edit` },
  list: { label: "لیست‌ها", icon: FolderOpen, path: (id: string) => `/lists/${id}` },
} as const;

type HitType = keyof typeof TYPE_META;

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const customers = useCustomers();
  const representatives = useRepresentatives();
  const requests = useRequests();
  const lists = useLists();
  const tags = useTags();
  const customFields = useCustomFields();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [types, setTypes] = useState<HitType[]>([]);
  const [repId, setRepId] = useState("");
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState("");
  const [tagId, setTagId] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q != null && q !== query) setQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const dataset = useMemo(() => {
    if (!customers || !representatives || !requests || !lists || !tags || !customFields) return null;
    return buildSearchDataset(customers, representatives, requests, lists, tags, customFields);
  }, [customers, representatives, requests, lists, tags, customFields]);

  const hits = useMemo(() => {
    if (!dataset || normalizeFa(query).length < 1) return [] as SearchHit[];
    return searchDataset(query, dataset, {
      types: types.length > 0 ? types : undefined,
      representativeId: repId || null,
      listId: listId || null,
      issued: status === "" || status === "rejected" ? null : status === "issued",
      rejected: status === "rejected" ? true : status === "pending" ? false : null,
      tagId: tagId || null,
      dateFrom: from,
      dateTo: to,
    });
  }, [dataset, query, types, repId, listId, status, tagId, from, to]);

  const grouped = useMemo(() => {
    const map = new Map<HitType, SearchHit[]>();
    for (const hit of hits) {
      const arr = map.get(hit.type as HitType) ?? [];
      arr.push(hit);
      map.set(hit.type as HitType, arr);
    }
    return map;
  }, [hits]);

  const onQueryChange = (q: string) => {
    setQuery(q);
    setSearchParams(q ? { q } : {}, { replace: true });
  };

  const toggleType = (t: HitType) =>
    setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="جستجوی سراسری" subtitle="نام، پاسپورت، تلفن، نوع ویزا، تگ، یادداشت و فیلدهای سفارشی" />

      <SearchBox
        value={query}
        onChange={onQueryChange}
        placeholder="هر چیزی که یادتان هست را بنویسید…"
        className="[&_input]:!text-[15px] [&_input]:!py-3"
      />

      {/* Type chips */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_META) as HitType[]).map((t) => {
          const count = grouped.get(t)?.length ?? 0;
          const active = types.includes(t);
          return (
            <button
              key={t}
              className={`chip inline-flex items-center gap-1.5 ${active ? "" : "chip-soft"}`}
              onClick={() => toggleType(t)}
            >
              {TYPE_META[t].label}
              {query && count > 0 && <span className="num">({toPersianDigits(count)})</span>}
            </button>
          );
        })}
        <button
          className={`btn btn-sm ${showAdvanced ? "btn-glass" : "btn-ghost"}`}
          onClick={() => setShowAdvanced((s) => !s)}
        >
          <Filter size={13} /> فیلترهای پیشرفته
        </button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <FilterSelect
            ariaLabel="نماینده"
            value={repId}
            onChange={setRepId}
            options={[
              { value: "", label: "همه نمایندگان" },
              ...(representatives ?? []).map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <FilterSelect
            ariaLabel="لیست"
            value={listId}
            onChange={setListId}
            options={[
              { value: "", label: "همه لیست‌ها" },
              ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
          <FilterSelect
            ariaLabel="وضعیت"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "همه وضعیت‌ها" },
              { value: "issued", label: "صادر شده" },
              { value: "pending", label: "در حال کار" },
              { value: "rejected", label: "رد شده" },
            ]}
          />
          <FilterSelect
            ariaLabel="تگ"
            value={tagId}
            onChange={setTagId}
            options={[
              { value: "", label: "همه تگ‌ها" },
              ...(tags ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <JalaliDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" />
          <JalaliDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" />
        </div>
      )}

      {!query.trim() ? (
        <EmptyState
          icon={Search}
          title="جستجو کنید"
          description="مثلاً بخشی از نام، شماره پاسپورت، شماره موبایل نماینده یا نوع ویزا را بنویسید — حتی با غلط املایی رایج فارسی (ی/ي و ک/ك) پیدا می‌شود."
        />
      ) : hits.length === 0 ? (
        <EmptyState icon={Search} title="نتیجه‌ای یافت نشد" description="عبارت کوتاه‌تری را امتحان کنید یا فیلترها را بردارید" />
      ) : (
        <div className="flex flex-col gap-4">
          {[...grouped.entries()].map(([type, groupHits]) => {
            const meta = TYPE_META[type];
            return (
              <GlassCard key={type} className="p-4 sm:p-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                    <meta.icon size={15} />
                  </span>
                  <h3 className="text-[13px] font-extrabold">{meta.label}</h3>
                  <span className="chip-soft num rounded-full px-2 py-0.5 text-[10px]">
                    {toPersianDigits(groupHits.length)}
                  </span>
                </div>
                <ul>
                  {groupHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-right transition-colors hover:bg-brand-500/6"
                        onClick={() => navigate(meta.path(hit.id))}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold">
                            {splitHighlight(hit.title, query).map((part, i) =>
                              isHighlightPart(part, query) ? (
                                <mark key={i} className="rounded bg-brand-500/20 px-0.5 text-inherit">
                                  {part}
                                </mark>
                              ) : (
                                <span key={i}>{part}</span>
                              ),
                            )}
                          </span>
                          {hit.subtitle && (
                            <span className="block truncate text-[11px] text-ink-500 dark:text-ink-400">
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
