import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Briefcase, FilePenLine, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox, FilterSelect } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { Menu } from "../components/ui/Menu";
import { CustomerFormModal } from "../components/domain/CustomerFormModal";
import { Avatar } from "../components/ui/Avatar";
import { archiveCustomer, deleteCustomer, customerFullName } from "../db/customers";
import { useCustomers, useLists, usePrefs, useRepresentatives, useRequests, useEmployers } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { quickDateRanges } from "../utils/requestDateFilter";
import { uiActions } from "../components/layout/uiStore";
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
import type { Customer } from "../types";

const CUSTOMERS_SORTS = ["newest", "oldest", "name", "mostRequests", "mostIssued"] as const;

type CustomersSort = (typeof CUSTOMERS_SORTS)[number];

function isCustomersSort(v: string): v is CustomersSort {
  return (CUSTOMERS_SORTS as readonly string[]).includes(v);
}

/** Visa-status filter for a customer (derived from their requests). */
const STATUS_FILTERS = [
  { value: "", label: "همه وضعیت‌ها" },
  { value: "issued", label: "ویزا صادر شده" },
  { value: "pending", label: "در حال کار" },
  { value: "rejected", label: "رد شده" },
  { value: "none", label: "بدون درخواست" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function isStatusFilter(v: string): v is StatusFilter {
  return STATUS_FILTERS.some((o) => o.value === v);
}

/** Saved date filters are ISO strings; "" means not set. */
function loadSavedDate(key: string): string | null {
  const v = loadPageFilter<string>("customers", key, "", () => true);
  return v ? v : null;
}

export function CustomersPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const customers = useCustomers();
  const requests = useRequests();
  const representatives = useRepresentatives();
  const lists = useLists();
  const employers = useEmployers();
  const prefs = usePrefs();
  /** کارفرما is optional — hide its column/filter when switched off. */
  const employerFieldOn = prefs.employerFieldEnabled !== false;

  // Last used filters are remembered across visits (validated on load).
  const [query, setQuery] = useState("");
  const [repFilter, setRepFilter] = useState<string>(() => loadPageFilter<string>("customers", "rep", "", () => true));
  const [listFilter, setListFilter] = useState<string>(() => loadPageFilter<string>("customers", "list", "", () => true));
  /** کارفرما filter: "none" = بدون کارفرما, "" = همه. */
  const [employerFilter, setEmployerFilter] = useState<string>(() => loadPageFilter<string>("customers", "employer", "", () => true));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const saved = loadPageFilter<string>("customers", "status", "", () => true);
    return isStatusFilter(saved) ? saved : "";
  });
  const [sort, setSort] = useState<CustomersSort>(() => {
    const saved = loadPageFilter<string>("customers", "sort", "newest", () => true);
    return isCustomersSort(saved) ? saved : "newest";
  });
  /** Issued-visa date range (ISO) — customer matches when ANY issued request
   *  falls inside, e.g. "همه صادرشده‌های این هفته". */
  const [issuedFrom, setIssuedFrom] = useState<string | null>(() => loadSavedDate("issuedFrom"));
  const [issuedTo, setIssuedTo] = useState<string | null>(() => loadSavedDate("issuedTo"));
  /** Customer registration-date range (ISO). */
  const [regFrom, setRegFrom] = useState<string | null>(() => loadSavedDate("regFrom"));
  const [regTo, setRegTo] = useState<string | null>(() => loadSavedDate("regTo"));
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // A saved representative may have been deleted/archived since — ignore the
  // stale filter once the rep list has loaded, instead of hiding every row.
  const activeRepFilter =
    representatives !== undefined && repFilter
      ? (representatives ?? []).some((r) => r.id === repFilter)
        ? repFilter
        : ""
      : repFilter;

  useEffect(() => {
    savePageFilter("customers", "sort", sort);
  }, [sort]);
  useEffect(() => {
    savePageFilter("customers", "rep", activeRepFilter);
  }, [activeRepFilter]);
  useEffect(() => {
    savePageFilter("customers", "list", listFilter);
  }, [listFilter]);
  useEffect(() => {
    savePageFilter("customers", "employer", employerFilter);
  }, [employerFilter]);
  useEffect(() => {
    savePageFilter("customers", "status", statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    savePageFilter("customers", "issuedFrom", issuedFrom ?? "");
  }, [issuedFrom]);
  useEffect(() => {
    savePageFilter("customers", "issuedTo", issuedTo ?? "");
  }, [issuedTo]);
  useEffect(() => {
    savePageFilter("customers", "regFrom", regFrom ?? "");
  }, [regFrom]);
  useEffect(() => {
    savePageFilter("customers", "regTo", regTo ?? "");
  }, [regTo]);

  const statsByCustomer = useMemo(() => {
    const map = new Map<string, { total: number; issued: number; rejected: number }>();
    for (const r of requests ?? []) {
      const entry = map.get(r.customerId) ?? { total: 0, issued: 0, rejected: 0 };
      entry.total++;
      if (r.issued) entry.issued++;
      else if (r.rejected) entry.rejected++;
      map.set(r.customerId, entry);
    }
    return map;
  }, [requests]);

  /** customerId → issuance dates of their issued visas (ISO) — powers the
   *  "صادر شده از تاریخ تا تاریخ" range filter. */
  const issuedDatesByCustomer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of requests ?? []) {
      if (r.issued && r.issuedAt) {
        const arr = m.get(r.customerId);
        if (arr) arr.push(r.issuedAt);
        else m.set(r.customerId, [r.issuedAt]);
      }
    }
    return m;
  }, [requests]);

  /** Fallback for customers registered before the required rule: derive rep/list
   *  from their first request when the customer record has none. */
  const derivedRepByCustomer = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requests ?? []) {
      if (r.representativeId && !m.has(r.customerId)) m.set(r.customerId, r.representativeId);
    }
    return m;
  }, [requests]);

  const derivedListByCustomer = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requests ?? []) {
      if (r.listId && !m.has(r.customerId)) m.set(r.customerId, r.listId);
    }
    return m;
  }, [requests]);

  const repById = useMemo(() => new Map((representatives ?? []).map((r) => [r.id, r])), [representatives]);
  const listById = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l])), [lists]);
  const employerById = useMemo(() => new Map((employers ?? []).map((e) => [e.id, e])), [employers]);

  const displayRepId = (c: Customer): string | null =>
    c.representativeId ?? derivedRepByCustomer.get(c.id) ?? null;
  const displayListId = (c: Customer): string | null => c.listId ?? derivedListByCustomer.get(c.id) ?? null;

  const rows = useMemo(() => {
    let list = [...(customers ?? [])];
    if (activeRepFilter) {
      list = list.filter((c) => displayRepId(c) === activeRepFilter);
    }
    if (listFilter) {
      list = list.filter((c) => displayListId(c) === listFilter);
    }
    // کارفرما filter — "none" matches customers WITHOUT an employer.
    if (employerFilter && employerFieldOn) {
      list = list.filter((c) =>
        employerFilter === "none" ? !c.employerId : c.employerId === employerFilter,
      );
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) =>
        `${c.firstName ?? ""} ${c.lastName ?? ""} ${c.passportNo ?? ""} ${c.referrer ?? ""} ${
          c.employerId ? (employerById.get(c.employerId)?.name ?? "") : ""
        }`
          .toLowerCase()
          .includes(q),
      );
    }
    // Visa-status filter — derived from the customer's requests.
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
    // Issued-visa date range — any issued visa inside [from, to] qualifies.
    if (issuedFrom || issuedTo) {
      list = list.filter((c) =>
        (issuedDatesByCustomer.get(c.id) ?? []).some(
          (d) => (!issuedFrom || d >= issuedFrom) && (!issuedTo || d <= issuedTo),
        ),
      );
    }
    // Registration-date range.
    if (regFrom) list = list.filter((c) => c.registrationDate >= regFrom);
    if (regTo) list = list.filter((c) => c.registrationDate <= regTo);
    switch (sort) {
      case "newest":
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
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
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customers,
    requests,
    query,
    activeRepFilter,
    listFilter,
    employerFilter,
    employerFieldOn,
    statusFilter,
    issuedFrom,
    issuedTo,
    regFrom,
    regTo,
    sort,
  ]);

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "مشتری",
      sortValue: (c) => customerFullName(c),
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <Avatar photo={c.photo} name={customerFullName(c)} />
          <div className="min-w-0">
            <span className="block truncate font-semibold">{customerFullName(c)}</span>
            {c.referrer && <span className="block text-[11px] text-ink-400">معرف: {c.referrer}</span>}
          </div>
        </div>
      ),
    },
    {
      key: "passportNo",
      header: "پاسپورت",
      sortValue: (c) => c.passportNo ?? "",
      render: (c) =>
        c.passportNo ? (
          <span dir="ltr" className="num block text-[12.5px] font-medium">
            {c.passportNo}
          </span>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    {
      key: "representative",
      header: "نماینده",
      sortValue: (c) => repById.get(displayRepId(c) ?? "")?.name ?? "",
      render: (c) => {
        const rep = repById.get(displayRepId(c) ?? "");
        return rep ? (
          <button
            className="chip-soft inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] hover:text-brand-600"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/representatives/${rep.id}`);
            }}
          >
            {rep.name}
          </button>
        ) : (
          <span className="text-ink-400">—</span>
        );
      },
    },
    {
      key: "list",
      header: "لیست",
      sortValue: (c) => listById.get(displayListId(c) ?? "")?.name ?? "",
      render: (c) => {
        const l = listById.get(displayListId(c) ?? "");
        return l ? (
          <button
            className="chip-soft inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] hover:text-brand-600"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/lists/${l.id}`);
            }}
          >
            {l.name}
          </button>
        ) : (
          <span className="text-ink-400">—</span>
        );
      },
    },
    {
      key: "employer",
      header: "کارفرما",
      sortValue: (c) => (c.employerId ? (employerById.get(c.employerId)?.name ?? "") : ""),
      render: (c) => {
        if (!employerFieldOn) return <span className="text-ink-400">—</span>;
        const emp = c.employerId ? employerById.get(c.employerId) : undefined;
        return emp ? (
          <span className="chip-soft inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
            <Briefcase size={11} className="text-brand-500" />
            {emp.name}
          </span>
        ) : (
          <span className="text-ink-400">بدون</span>
        );
      },
    },
    {
      key: "requests",
      header: "درخواست‌ها",
      sortValue: (c) => statsByCustomer.get(c.id)?.total ?? 0,
      render: (c) => {
        const s = statsByCustomer.get(c.id);
        if (!s) return <span className="text-ink-400">—</span>;
        return (
          <span className="chip-soft num inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
            {toPersianDigits(s.total)}
            <span className="text-[#10b981]">({toPersianDigits(s.issued)} صادر)</span>
            {s.rejected > 0 && (
              <span className="text-[#dc3535] dark:text-[#f87b7b]">({toPersianDigits(s.rejected)} رد)</span>
            )}
          </span>
        );
      },
    },
    {
      key: "registrationDate",
      header: "تاریخ ثبت",
      sortValue: (c) => c.registrationDate,
      render: (c) => <span className="num">{formatJalali(c.registrationDate)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (c) => (
        <Menu
          items={[
            { icon: FilePenLine, label: "مشاهده و ویرایش", onClick: () => navigate(`/customers/${c.id}`) },
            {
              icon: UserPlus,
              label: "درخواست ویزا برای این مشتری",
              onClick: () => uiActions.openRequestModal({ customerId: c.id }),
            },
            {
              icon: Archive,
              label: "بایگانی",
              onClick: async () => {
                const ok = await confirm({ title: `بایگانی «${customerFullName(c)}»؟`, message: "از آرشیو قابل بازگشت است." });
                if (ok) {
                  await archiveCustomer(c.id, customerFullName(c));
                  toast.info("مشتری بایگانی شد");
                }
              },
            },
            {
              icon: Trash2,
              label: "حذف قطعی",
              danger: true,
              onClick: async () => {
                const s = statsByCustomer.get(c.id);
                const ok = await confirm({
                  title: `حذف «${customerFullName(c)}»`,
                  message: `${s?.total ?? 0} درخواست و مدارک این مشتری هم حذف می‌شوند. این عمل بازگشت‌پذیر نیست!`,
                  danger: true,
                  confirmLabel: "حذف قطعی",
                });
                if (ok) {
                  await deleteCustomer(c.id, customerFullName(c));
                  toast.info("مشتری حذف شد");
                }
              },
            },
          ]}
          trigger={
            <span className="icon-btn !h-8 !w-8" aria-label="عملیات">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </span>
          }
        />
      ),
    },
  ];

  const quickRanges = useMemo(() => quickDateRanges(), []);

  const anyFilterActive =
    !!query.trim() || !!activeRepFilter || !!listFilter || !!statusFilter ||
    (employerFieldOn && !!employerFilter) ||
    !!issuedFrom || !!issuedTo || !!regFrom || !!regTo;

  const clearAllFilters = () => {
    setQuery("");
    setRepFilter("");
    setListFilter("");
    setEmployerFilter("");
    setStatusFilter("");
    setIssuedFrom(null);
    setIssuedTo(null);
    setRegFrom(null);
    setRegTo(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="مشتریان"
        subtitle={`${toPersianDigits(rows.length)} مشتری ثبت‌شده`}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => uiActions.openCustomerModal()}>
            <UserPlus size={15} /> مشتری جدید
          </button>
        }
      />

      <div className="glass flex flex-col gap-2.5 rounded-3xl p-3.5">
        {/* Row 1 — search + entity/status filters + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="نام، شماره پاسپورت یا معرف…"
            className="min-w-[200px] flex-1"
          />
          <FilterSelect
            ariaLabel="نماینده"
            value={activeRepFilter}
            onChange={setRepFilter}
            options={[
              { value: "", label: "همه مشتریان" },
              ...(representatives ?? [])
                .filter((r) =>
                  (customers ?? []).some(
                    (c) =>
                      c.representativeId === r.id ||
                      derivedRepByCustomer.get(c.id) === r.id,
                  ),
                )
                .map((r) => ({ value: r.id, label: `مشتریان ${r.name}` })),
            ]}
          />
          <FilterSelect
            ariaLabel="لیست"
            value={listFilter}
            onChange={setListFilter}
            options={[
              { value: "", label: "همه لیست‌ها" },
              ...(lists ?? [])
                .filter((l) =>
                  (customers ?? []).some(
                    (c) => c.listId === l.id || derivedListByCustomer.get(c.id) === l.id,
                  ),
                )
                .map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
          <FilterSelect
            ariaLabel="وضعیت ویزا"
            value={statusFilter}
            onChange={(v) => setStatusFilter(isStatusFilter(v) ? v : "")}
            options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
          />
          {employerFieldOn && (
            <FilterSelect
              ariaLabel="کارفرما"
              value={employerFilter}
              onChange={setEmployerFilter}
              options={[
                { value: "", label: "همه کارفرماها" },
                { value: "none", label: "بدون کارفرما" },
                ...(employers ?? []).map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
          )}
          <FilterSelect
            ariaLabel="مرتب‌سازی"
            value={sort}
            onChange={(v) => setSort(isCustomersSort(v) ? v : "newest")}
            options={[
              { value: "newest", label: "جدیدترین" },
              { value: "oldest", label: "قدیمی‌ترین" },
              { value: "name", label: "الفبا" },
              { value: "mostRequests", label: "بیشترین درخواست" },
              { value: "mostIssued", label: "بیشترین صدور" },
            ]}
          />
          {anyFilterActive && (
            <button
              className="btn btn-ghost btn-sm !text-rose-500 dark:!text-rose-400"
              onClick={clearAllFilters}
            >
              <X size={14} /> پاک‌کردن فیلترها
            </button>
          )}
        </div>

        {/* Row 2 — date ranges: visa issuance + customer registration */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-900/5 pt-2.5 dark:border-white/5">
          <span className="shrink-0 text-[11px] font-bold text-ink-400">تاریخ صدور:</span>
          <JalaliDatePicker
            value={issuedFrom}
            onChange={setIssuedFrom}
            placeholder="از تاریخ صدور"
            className="w-40"
          />
          <JalaliDatePicker
            value={issuedTo}
            onChange={setIssuedTo}
            placeholder="تا تاریخ صدور"
            className="w-40"
          />
          <span className="mx-1 hidden h-5 w-px bg-ink-900/10 dark:bg-white/10 sm:block" />
          <span className="shrink-0 text-[11px] font-bold text-ink-400">تاریخ ثبت:</span>
          <JalaliDatePicker
            value={regFrom}
            onChange={setRegFrom}
            placeholder="از تاریخ ثبت"
            className="w-40"
          />
          <JalaliDatePicker
            value={regTo}
            onChange={setRegTo}
            placeholder="تا تاریخ ثبت"
            className="w-40"
          />
        </div>

        {/* Row 3 — one-click issuance ranges */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-900/5 pt-2 dark:border-white/5">
          <span className="shrink-0 text-[11px] font-bold text-ink-400">صدور سریع:</span>
          {quickRanges.map((q) => {
            const active = issuedFrom === q.from && issuedTo === q.to;
            return (
              <button
                key={q.key}
                type="button"
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
                  active
                    ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
                    : "bg-ink-900/5 text-ink-500 hover:bg-brand-500/12 hover:text-brand-600 dark:bg-white/5 dark:text-ink-400 dark:hover:text-brand-300"
                }`}
                onClick={() => {
                  setIssuedFrom(q.from);
                  setIssuedTo(q.to);
                }}
              >
                {q.label}
              </button>
            );
          })}
          {(issuedFrom || issuedTo) && (
            <span className="text-[11px] text-ink-400">
              مشتریانی که ویزایشان {issuedFrom ? `از ${formatJalali(issuedFrom)}` : ""}{" "}
              {issuedTo ? `تا ${formatJalali(issuedTo)}` : ""} صادر شده
            </span>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        loading={customers === undefined}
        empty={
          <EmptyState
            icon={Users}
            title="مشتری‌ای یافت نشد"
            description={
              anyFilterActive
                ? "فیلترها را عوض کنید یا پاک کنید"
                : "اولین مشتری را ثبت کنید — حتی فقط با یک نام"
            }
            action={
              <button className="btn btn-primary btn-sm" onClick={() => uiActions.openCustomerModal()}>
                <UserPlus size={15} /> مشتری جدید
              </button>
            }
          />
        }
      />

      <CustomerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={editing ?? undefined}
      />
    </div>
  );
}

export { Search };
