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
 * `useCustomerFilters()` returns the ready-to-render panel plus the filtered +
 * sorted rows; `CustomerCardGrid` renders the cards with each customer's tags
 * shown NEXT TO the passport number («تگش رو هم ببینم»).
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { SearchBox, FilterSelect } from "../ui/inputs";
import { Avatar } from "../ui/Avatar";
import { TagBadge } from "../ui/Badges";
import { customerFullName } from "../../db/customers";
import { loadPageFilter, savePageFilter } from "../../utils/pageFilters";
import { toPersianDigits } from "../../utils/jalali";
import type { Customer, Employer, ListFolder, Representative, Tag, VisaRequest } from "../../types";

/* ------------------------------- options --------------------------------- */

const STATUS_FILTERS = [
  { value: "", label: "همه وضعیت‌ها" },
  { value: "issued", label: "ویزا صادر شده" },
  { value: "pending", label: "در حال کار" },
  { value: "rejected", label: "رد شده" },
  { value: "none", label: "بدون درخواست" },
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
}

/** The shared filter bar + row pipeline for scoped customer lists. */
export function useCustomerFilters(opts: CustomerFiltersOptions): CustomerFiltersResult {
  const { customers, requests, tags, lists, representatives, employers } = opts;
  const show = { list: true, rep: true, employer: true, status: true, sort: true, ...opts.show };

  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "list", "", () => true));
  const [repFilter, setRepFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "rep", "", () => true));
  const [employerFilter, setEmployerFilter] = useState<string>(() => loadPageFilter<string>(opts.pageKey, "employer", "", () => true));
  const [statusFilter, setStatusFilter] = useState<string>(() => isOneOf(STATUS_FILTERS.map((s) => s.value), loadPageFilter<string>(opts.pageKey, "status", "", () => true)));
  const [sort, setSort] = useState<string>(() => isOneOf(SORTS.map((s) => s.value), loadPageFilter<string>(opts.pageKey, "sort", "newest", () => true)) || "newest");

  useEffect(() => savePageFilter(opts.pageKey, "list", listFilter), [opts.pageKey, listFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "rep", repFilter), [opts.pageKey, repFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "employer", employerFilter), [opts.pageKey, employerFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "status", statusFilter), [opts.pageKey, statusFilter]);
  useEffect(() => savePageFilter(opts.pageKey, "sort", sort), [opts.pageKey, sort]);

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
        const s = statsByCustomer.get(c.id);
        switch (statusFilter) {
          case "issued":
            return !!s && s.issued > 0;
          case "pending":
            return !!s && s.total - s.issued - s.rejected > 0;
          case "rejected":
            return !!s && s.rejected > 0;
          case "none":
            return !s || s.total === 0;
          default:
            return true;
        }
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
          ariaLabel="وضعیت ویزا"
          value={statusFilter}
          onChange={(v) => setStatusFilter(isOneOf(STATUS_FILTERS.map((s) => s.value), v))}
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
    </div>
  );

  return { panel, rows, anyActive };
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

/** The scoped customer cards — avatar, name, passport + TAGS beside it, meta line. */
export function CustomerCardGrid({
  customers,
  requests,
  tags,
  lists,
  representatives,
  showMeta,
  emptyHint,
}: {
  customers: Customer[];
  requests: VisaRequest[];
  tags: Tag[];
  lists?: ListFolder[];
  representatives?: Representative[];
  /** Which meta line to show under the passport: list (rep profile) or rep (employer panel). */
  showMeta?: "list" | "rep";
  emptyHint?: string;
}) {
  if (customers.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-ink-400" data-empty-customers>
        {emptyHint ?? "مشتری‌ای یافت نشد"}
      </p>
    );
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
          >
            <Avatar photo={c.photo} name={customerFullName(c)} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">{customerFullName(c)}</span>
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
