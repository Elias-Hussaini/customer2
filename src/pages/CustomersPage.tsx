import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, FilePenLine, Search, Trash2, UserPlus, Users } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox, FilterSelect } from "../components/ui/inputs";
import { Menu } from "../components/ui/Menu";
import { CustomerFormModal } from "../components/domain/CustomerFormModal";
import { archiveCustomer, deleteCustomer, customerFullName } from "../db/customers";
import { useCustomers, useRepresentatives, useRequests } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { uiActions } from "../components/layout/uiStore";
import type { Customer } from "../types";

export function CustomersPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const customers = useCustomers();
  const requests = useRequests();
  const representatives = useRepresentatives();

  const [query, setQuery] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const statsByCustomer = useMemo(() => {
    const map = new Map<string, { total: number; issued: number }>();
    for (const r of requests ?? []) {
      const entry = map.get(r.customerId) ?? { total: 0, issued: 0 };
      entry.total++;
      if (r.issued) entry.issued++;
      map.set(r.customerId, entry);
    }
    return map;
  }, [requests]);

  const repIdsWithCustomers = useMemo(() => {
    const set = new Set((requests ?? []).map((r) => r.representativeId).filter(Boolean) as string[]);
    return set;
  }, [requests]);

  const rows = useMemo(() => {
    let list = [...(customers ?? [])];
    if (repFilter) {
      const ids = new Set((requests ?? []).filter((r) => r.representativeId === repFilter).map((r) => r.customerId));
      list = list.filter((c) => ids.has(c.id));
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
  }, [customers, requests, query, repFilter, sort]);

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "مشتری",
      sortValue: (c) => customerFullName(c),
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-[13px] font-bold text-brand-600 dark:text-brand-300">
            {(c.firstName ?? c.lastName ?? "؟").slice(0, 1)}
          </span>
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
          value={repFilter}
          onChange={setRepFilter}
          options={[
            { value: "", label: "همه مشتریان" },
            ...(representatives ?? [])
              .filter((r) => repIdsWithCustomers.has(r.id))
              .map((r) => ({ value: r.id, label: `مشتریان ${r.name}` })),
          ]}
        />
        <FilterSelect
          ariaLabel="مرتب‌سازی"
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "جدیدترین" },
            { value: "oldest", label: "قدیمی‌ترین" },
            { value: "name", label: "الفبا" },
          ]}
        />
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
