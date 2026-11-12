/**
 * Round 22 — shared «شخصی‌سازی» filter panel for SCOPED customer lists
 * (پروفایل نمایندگان → مشتریان، پنل کارفرما → مشتریان این کارفرما).
 *
 * The SAME look & behavior as the مشتریان page filter bar — search box with
 * recall arrow, dropdown filters, sort, پاک‌کردن فیلترها — but configurable
 * per context (the rep profile hides the نماینده filter, the employer panel
 * hides the کارفرما filter, and so on). Every choice is remembered per page
 * via the pageFilters store, exactly like the customers page.
 *
 * Round 23 — the status filter became the six-stage «مرحله‌های ویزا» journey
 * filter, every card shows the green کد اختصاصی tick + the colored stage dot,
 * and the collection can be displayed as cards OR a table (view toggle,
 * remembered per page).
 *
 * `useCustomerFilters()` returns the ready-to-render panel plus the filtered +
 * sorted rows and the chosen view; `CustomerCardGrid` renders the cards (with
 * each customer's tags NEXT TO the passport number) or the table view.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { SearchBox, FilterSelect } from "../ui/inputs";
import { Avatar } from "../ui/Avatar";
import { TagBadge } from "../ui/Badges";
import { StageBadge, StageIndicators } from "../ui/StageBadge";
import { DataTable, type Column } from "../ui/DataTable";
import { ViewModeToggle, isCollectionViewMode, type CollectionViewMode } from "../ui/ViewModeToggle";
import { beginCustomerHover, endCustomerHover } from "./customerHotkeys";
import { customerFullName } from "../../db/customers";
import { useStageMap } from "../../hooks/useData";
import { loadPageFilter, savePageFilter } from "../../utils/pageFilters";
import { formatJalali, toPersianDigits } from "../../utils/jalali";
import {
  CUSTOMER_STAGES,
  CUSTOMER_STAGE_LABELS,
  normalizeStageFilter,
  stageOrder,
  type Customer,
  type CustomerStage,
  type Employer,
  type ListFolder,
  type Representative,
  type Tag,
  type VisaRequest,
} from "../../types";

/* ------------------------------- options --------------------------------- */

const STATUS_FILTERS = [
  { value: "", label: "همه مراحل" },
  ...CUSTOMER_STAGES.map((s) => ({ value: s as string, label: CUSTOMER_STAGE_LABELS[s] })),
  { value: "none", label: "بدون درخواست ویزا" },
] as const;

const SORTS = [
  { value: "newest", label: "جدیدترین" },
  { value: "oldest", label: "قدیمی‌ترین" },
  { value: "name", label: "الفبا" },
  { value: "mostRequests", label: "بیشترین درخواست" },
  { value: "mostIssued", label: "بیشترین صدور" },
] as const;

function isOneOf<T extends string>(list: readonly T[], v: string): T | "" {
  return (list as readonly string[]).includes(v) ? (v as T) : "";
}

export interface CustomerFiltersOptions {
  /** pageFilters persistence key — unique per surface. */
  pageKey: string;
  /** The scoped customer list (rep's customers / employer's customers). */
  customers: Customer[];
  /** ALL requests — visa status + tags are derived per customer. */
  requests: VisaRequest[];
  tags: Tag[];
  lists?: ListFolder[];
  representatives?: Representative[];
  employers?: Employer[];
  /** Which dropdowns to show (default: everything provided is shown). */
  show?: { list?: boolean; rep?: boolean; employer?: boolean; status?: boolean; sort?: boolean };
  searchPlaceholder?: string;
}

export interface CustomerFiltersResult {
  /** Ready-to-render filter panel (glass card, same style as مشتریان). */
  panel: React.ReactNode;
  /** Filtered + sorted customers. */
  rows: Customer[];
  /** Any filter active (for the empty-state hint). */
  anyActive: boolean;
  /** Cards ↔ table display mode (toggle lives inside the panel). */
  view: CollectionViewMode;
}

/** The shared filter bar + row pipeline for scoped customer lists. */
export function useCustomerFilters(opts: CustomerFiltersOptions): CustomerFiltersResult {
  const { customers, requests, tags, lists, representatives, employers } = opts;
  const show = { list: true, rep: true, employer: true, status: true, sort: true, ...opts.show };
  const stageMap = useStageMap();

  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "list", "", () => true));
  const [repFilter, setRepFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "rep", "", () => true));
  const [employerFilter, setEmployerFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "employer", "", () => true));
  const [statusFilter, setStatusFilter] = useState<string>(
    () =>
      normalizeStageFilter(loadPageFilter<string>(opts.pageKey, "status", "", () => true)) || "",
  );
  const [sort, setSort] = useState<string>(() => isOneOf(SORTS.map((s) => s.value), loadPageFilter<string>(opts.pageKey, "sort", "newest", () => true)) || "newest");
  const [view, setView] = useState<CollectionViewMode>(() => {
    const saved = loadPageFilter<string>(opts.pageKey, "view", "cards", isCollectionViewMode);
    return isCollectionViewMode(saved) ? saved : "cards";
  });

  useEffect(() => savePageFilter(opts.pageKey, "list", listFilter), [opts.pageKey, listFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "rep", repFilter), [opts.pageKey, repFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "employer", employerFilter), [opts.pageKey, employerFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "status", statusFilter), [opts.pageKey, statusFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "sort", sort), [opts.pageKey, sort]);
  useEffect(() => savePageFilter(opts.pageKey, "view", view), [opts.pageKey, view]);

  /** Visa status counts per customer (drives the status filter + sorts). */
  const statsByCustomer = useMemo(() => {
    const map = new Map<string, { total: number; issued: number; rejected: number }>();
    for (const r of requests) {
      if (r.archivedAt) continue;
      const entry = map.get(r.customerId) ?? { total: 0, issued: 0, rejected: 0 };
      entry.total++;
      if (r.issued) entry.issued++;
      else if (r.rejected) entry.rejected++;
      map.set(r.customerId, entry);
    }
    return map;
  }, [requests]);

  // Drop saved filters whose entity no longer exists (rep deleted…) instead
  // of silently hiding every row.
  const activeListFilter = lists && listFilter ? (lists.some((l) => l.id === listFilter) ? listFilter : "") : listFilter;
  const activeRepFilter = representatives && repFilter ? (representatives.some((r) => r.id === repFilter) ? repFilter : "") : repFilter;
  const activeEmployerFilter =
    employers && employerFilter
      ? employerFilter === "none" || employers.some((e) => e.id === employerFilter)
        ? employerFilter
        : ""
      : employerFilter;

  const rows = useMemo(() => {
    let list = [...customers];
    if (activeListFilter) list = list.filter((c) => c.listId === activeListFilter);
    if (activeRepFilter) list = list.filter((c) => c.representativeId === activeRepFilter);
    if (activeEmployerFilter) {
      list = list.filter((c) =>
        activeEmployerFilter === "none" ? !c.employerId : c.employerId === activeEmployerFilter,
      );
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) =>
        `${c.firstName ?? ""} ${c.lastName ?? ""} ${c.passportNo ?? ""} ${c.job ?? ""} ${c.referrer ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (statusFilter) {
      list = list.filter((c) => {
        if (statusFilter === "none") {
          const s = statsByCustomer.get(c.id);
          return !s || s.total === 0;
        }
        // Stage filter — the customer's effective journey stage.
        return stageMap?.get(c.id) === (statusFilter as CustomerStage);
      });
    }
    switch (sort) {
      case "oldest":
        list.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "name":
        list.sort((a, b) => customerFullName(a).localeCompare(customerFullName(b), "fa"));
        break;
      case "mostRequests":
        list.sort(
          (a, b) =>
            (statsByCustomer.get(b.id)?.total ?? 0) - (statsByCustomer.get(a.id)?.total ?? 0) ||
            b.createdAt - a.createdAt,
        );
        break;
      case "mostIssued":
        list.sort(
          (a, b) =>
            (statsByCustomer.get(b.id)?.issued ?? 0) - (statsByCustomer.get(a.id)?.issued ?? 0) ||
            b.createdAt - a.createdAt,
        );
        break;
      default:
        list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customers,
    query,
    activeListFilter,
    activeRepFilter,
    activeEmployerFilter,
    statusFilter,
    sort,
    statsByCustomer,
    stageMap,
  ]);

  const anyActive =
    !!query.trim() || !!activeListFilter || !!activeRepFilter || !!activeEmployerFilter || !!statusFilter;

  const clearAll = () => {
    setQuery("");
    setListFilter("");
    setRepFilter("");
    setEmployerFilter("");
    setStatusFilter("");
  };

  const panel = (
    <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3.5" data-customer-filters>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={opts.searchPlaceholder ?? "نام یا شماره پاسپورت…"}
        className="min-w-[200px] flex-1"
      />
      {show.list && lists && lists.length > 0 && (
        <FilterSelect
          ariaLabel="لیست"
          value={activeListFilter}
          onChange={setListFilter}
          options={[{ value: "", label: "همه لیست‌ها" }, ...lists.map((l) => ({ value: l.id, label: l.name }))]}
        />
      )}
      {show.rep && representatives && representatives.length > 0 && (
        <FilterSelect
          ariaLabel="نماینده"
          value={activeRepFilter}
          onChange={setRepFilter}
          options={[
            { value: "", label: "همه نمایندگان" },
            ...representatives.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      )}
      {show.employer && employers && employers.length > 0 && (
        <FilterSelect
          ariaLabel="کارفرما"
          value={activeEmployerFilter}
          onChange={setEmployerFilter}
          options={[
            { value: "", label: "همه کارفرماها" },
            { value: "none", label: "بدون کارفرما" },
            ...employers.map((e) => ({ value: e.id, label: e.name })),
          ]}
        />
      )}
      {show.status && (
        <FilterSelect
          ariaLabel="مرحله"
          value={statusFilter}
          onChange={(v) => setStatusFilter(normalizeStageFilter(v))}
          options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
        />
      )}
      {show.sort && (
        <FilterSelect
          ariaLabel="مرتب‌سازی"
          value={sort}
          onChange={(v) => setSort(isOneOf(SORTS.map((s) => s.value), v) || "newest")}
          options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
        />
      )}
      {anyActive && (
        <button
          className="btn btn-ghost btn-sm !text-rose-500 dark:!text-rose-400"
          onClick={clearAll}
        >
          <X size={14} /> پاک‌کردن فیلترها
        </button>
      )}
      <ViewModeToggle value={view} onChange={setView} />
    </div>
  );

  return { panel, rows, anyActive, view };
}

/* ------------------------------ card grid -------------------------------- */

/** Tag badges of one customer (union across their visa requests). */
export function CustomerTags({
  customer,
  requests,
  tags,
  max = 3,
}: {
  customer: Customer;
  requests: VisaRequest[];
  tags: Tag[];
  max?: number;
}) {
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const ids = useMemo(() => {
    const seen: string[] = [];
    for (const r of requests) {
      if (r.customerId !== customer.id || r.archivedAt) continue;
      for (const t of r.tags) if (!seen.includes(t)) seen.push(t);
    }
    return seen;
  }, [requests, customer.id]);
  const visible = ids.map((id) => tagsById.get(id)).filter((t): t is Tag => Boolean(t)).slice(0, max);
  if (visible.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {visible.map((t) => (
        <TagBadge key={t.id} tag={t} />
      ))}
      {ids.length > max && (
        <span className="text-[10px] text-ink-400">+{toPersianDigits(ids.length - max)}</span>
      )}
    </span>
  );
}

/** The scoped customer cards — avatar, name + stage tick/dot, passport + TAGS
 *  beside it, meta line — OR the table view (cards ↔ table, same data).
 *  Hovering any card/row arms the stage hotkeys (Ctrl/Alt/Shift/Alt+Shift). */
export function CustomerCardGrid({
  customers,
  requests,
  tags,
  lists,
  representatives,
  showMeta,
  emptyHint,
  view = "cards",
}: {
  customers: Customer[];
  requests: VisaRequest[];
  tags: Tag[];
  lists?: ListFolder[];
  representatives?: Representative[];
  /** Which meta line to show under the passport: list (rep profile) or rep (employer panel). */
  showMeta?: "list" | "rep";
  emptyHint?: string;
  /** Display mode — comes from useCustomerFilters().view. */
  view?: CollectionViewMode;
}) {
  const stageMap = useStageMap();

  if (customers.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-ink-400" data-empty-customers>
        {emptyHint ?? "مشتری‌ای یافت نشد"}
      </p>
    );
  }

  if (view === "table") {
    return <CustomerTable customers={customers} requests={requests} tags={tags} lists={lists} representatives={representatives} showMeta={showMeta} stageMap={stageMap} />;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {customers.map((c) => {
        const list = lists?.find((l) => l.id === c.listId);
        const rep = representatives?.find((r) => r.id === c.representativeId);
        return (
          <Link
            key={c.id}
            to={`/customers/${c.id}`}
            className="glass flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-brand-500/8"
            onMouseEnter={(e) => beginCustomerHover(c.id, e.currentTarget)}
            onMouseLeave={() => endCustomerHover(c.id)}
          >
            <Avatar photo={c.photo} name={customerFullName(c)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-bold">{customerFullName(c)}</span>
                <StageIndicators
                  stage={stageMap?.get(c.id)}
                  hasCode={!!c.referrer?.trim()}
                  dotSize={9}
                />
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {c.passportNo ? (
                  <span className="num text-[11px] text-ink-400" dir="ltr">
                    {c.passportNo}
                  </span>
                ) : (
                  <span className="text-[11px] text-ink-400">بدون پاسپورت</span>
                )}
                <CustomerTags customer={c} requests={requests} tags={tags} />
              </span>
              {showMeta === "list" && list && (
                <span className="mt-1 block truncate text-[10.5px] text-ink-500 dark:text-ink-400">
                  لیست: {list.name}
                </span>
              )}
              {showMeta === "rep" && rep && (
                <span className="mt-1 block truncate text-[10.5px] text-ink-500 dark:text-ink-400">
                  نماینده: {rep.name}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Table view of the same scoped customers (مرحله column + tick + hotkeys). */
function CustomerTable({
  customers,
  requests,
  tags,
  lists,
  representatives,
  showMeta,
  stageMap,
}: {
  customers: Customer[];
  requests: VisaRequest[];
  tags: Tag[];
  lists?: ListFolder[];
  representatives?: Representative[];
  showMeta?: "list" | "rep";
  stageMap: Map<string, CustomerStage> | undefined;
}) {
  const listsById = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l])), [lists]);
  const repsById = useMemo(
    () => new Map((representatives ?? []).map((r) => [r.id, r])),
    [representatives],
  );
  const statsByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    const ids = new Set(customers.map((c) => c.id));
    for (const r of requests) {
      if (r.archivedAt || !ids.has(r.customerId)) continue;
      m.set(r.customerId, (m.get(r.customerId) ?? 0) + 1);
    }
    return m;
  }, [requests, customers]);

  const stageSort = (c: Customer): number => {
    const s = stageMap?.get(c.id);
    return s === "stage6" ? 6 : s === undefined ? -1 : stageOrder(s) + 1;
  };

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "مشتری",
      sortValue: (c) => customerFullName(c),
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <Avatar photo={c.photo} name={customerFullName(c)} />
          <div className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{customerFullName(c)}</span>
              <StageIndicators stage={stageMap?.get(c.id)} hasCode={!!c.referrer?.trim()} dotSize={9} />
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {c.passportNo ? (
                <span dir="ltr" className="num text-[11px] text-ink-400">
                  {c.passportNo}
                </span>
              ) : null}
              <CustomerTags customer={c} requests={requests} tags={tags} max={2} />
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "stage",
      header: "مرحله",
      sortValue: stageSort,
      render: (c) => <StageBadge stage={stageMap?.get(c.id)} size="sm" />,
    },
    {
      key: "meta",
      header: showMeta === "rep" ? "نماینده" : "لیست",
      sortValue: (c) =>
        showMeta === "rep"
          ? (repsById.get(c.representativeId ?? "")?.name ?? "")
          : (listsById.get(c.listId ?? "")?.name ?? ""),
      render: (c) => {
        if (showMeta === "rep") {
          const rep = repsById.get(c.representativeId ?? "");
          return rep ? <span className="chip-soft">{rep.name}</span> : <span className="text-ink-400">—</span>;
        }
        const list = listsById.get(c.listId ?? "");
        return list ? <span className="chip-soft">{list.name}</span> : <span className="text-ink-400">—</span>;
      },
    },
    {
      key: "requests",
      header: "درخواست‌ها",
      align: "center",
      sortValue: (c) => statsByCustomer.get(c.id) ?? 0,
      render: (c) => {
        const n = statsByCustomer.get(c.id) ?? 0;
        return n > 0 ? (
          <span className="chip-soft num">{toPersianDigits(n)}</span>
        ) : (
          <span className="text-ink-400">—</span>
        );
      },
    },
    {
      key: "registrationDate",
      header: "تاریخ ثبت",
      sortValue: (c) => c.registrationDate,
      render: (c) => (
        <span className="num text-ink-600 dark:text-ink-300">{formatJalali(c.registrationDate)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={customers}
      rowKey={(c) => c.id}
      onRowMouseEnter={(c, el) => beginCustomerHover(c.id, el)}
      onRowMouseLeave={(c) => endCustomerHover(c.id)}
      footer={`${toPersianDigits(customers.length)} مشتری`}
    />
  );
}
