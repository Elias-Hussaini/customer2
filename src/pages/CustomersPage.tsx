import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, FilePenLine, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox, FilterSelect } from "../components/ui/inputs";
import { Menu } from "../components/ui/Menu";
import { CustomerFormModal } from "../components/domain/CustomerFormModal";
import { Avatar } from "../components/ui/Avatar";
import { archiveCustomer, deleteCustomer, customerFullName } from "../db/customers";
import { useCustomers, useLists, useRepresentatives, useRequests } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { uiActions } from "../components/layout/uiStore";
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
import type { Customer } from "../types";

const CUSTOMERS_SORTS = ["newest", "oldest", "name"] as const;

type CustomersSort = (typeof CUSTOMERS_SORTS)[number];

function isCustomersSort(v: string): v is CustomersSort {
  return (CUSTOMERS_SORTS as readonly string[]).includes(v);
}

export function CustomersPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const customers = useCustomers();
  const requests = useRequests();
  const representatives = useRepresentatives();
  const lists = useLists();

  // Last used filters are remembered across visits (validated on load).
  const [query, setQuery] = useState("");
  const [repFilter, setRepFilter] = useState<string>(() => loadPageFilter<string>("customers", "rep", "", () => true));
  const [sort, setSort] = useState<CustomersSort>(() => {
    const saved = loadPageFilter<string>("customers", "sort", "newest", () => true);
    return isCustomersSort(saved) ? saved : "newest";
  });
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

  const displayRepId = (c: Customer): string | null =>
    c.representativeId ?? derivedRepByCustomer.get(c.id) ?? null;
  const displayListId = (c: Customer): string | null => c.listId ?? derivedListByCustomer.get(c.id) ?? null;

  const rows = useMemo(() => {
    let list = [...(customers ?? [])];
    if (activeRepFilter) {
      list = list.filter((c) => displayRepId(c) === activeRepFilter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) =>
        `${c.firstName ?? ""} ${c.lastName ?? ""} ${c.passportNo ?? ""} ${c.referrer ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
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
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, requests, query, activeRepFilter, sort]);

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

      <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3.5">
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
          ariaLabel="مرتب‌سازی"
          value={sort}
          onChange={(v) => setSort(isCustomersSort(v) ? v : "newest")}
          options={[
            { value: "newest", label: "جدیدترین" },
            { value: "oldest", label: "قدیمی‌ترین" },
            { value: "name", label: "الفبا" },
          ]}
        />
        {(query.trim() || activeRepFilter) && (
          <button
            className="btn btn-ghost btn-sm !text-rose-500 dark:!text-rose-400"
            onClick={() => {
              setQuery("");
              setRepFilter("");
            }}
          >
            <X size={14} /> پاک‌کردن فیلترها
          </button>
        )}
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
            description={query ? "عبارت جستجو را عوض کنید" : "اولین مشتری را ثبت کنید — حتی فقط با یک نام"}
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
