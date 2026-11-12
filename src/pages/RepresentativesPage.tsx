import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, FilePenLine, Phone, Trash2, UserRound, UserRoundPlus, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox, FilterSelect } from "../components/ui/inputs";
import { Menu } from "../components/ui/Menu";
import { DataTable, type Column } from "../components/ui/DataTable";
import { ViewModeToggle, isCollectionViewMode, type CollectionViewMode } from "../components/ui/ViewModeToggle";
import { RepresentativeFormModal } from "../components/domain/RepresentativeFormModal";
import { Avatar } from "../components/ui/Avatar";
import { archiveRepresentative, deleteRepresentative } from "../db/reps";
import { useCustomers, useEmployers, usePrefs, useRepresentatives, useRequests, usePayments, useTags } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatMoney } from "../utils/num";
import { computeRepStats } from "../services/stats";
import { toPersianDigits } from "../utils/jalali";
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
import { uiActions } from "../components/layout/uiStore";
import type { Representative } from "../types";

const REP_SORTS = ["name", "newest", "oldest", "mostCustomers", "mostRequests", "mostIssued"] as const;
type RepSort = (typeof REP_SORTS)[number];

const REP_STATUS = [
  { value: "", label: "همه وضعیت‌ها" },
  { value: "pending", label: "در حال کار دارد" },
  { value: "issued", label: "ویزا صادر شده دارد" },
  { value: "rejected", label: "رد شده دارد" },
  { value: "none", label: "بدون درخواست" },
] as const;

type RepStatus = (typeof REP_STATUS)[number]["value"];

function isRepSort(v: string): v is RepSort {
  return (REP_SORTS as readonly string[]).includes(v);
}
function isRepStatus(v: string): v is RepStatus {
  return REP_STATUS.some((o) => o.value === v);
}

export function RepresentativesPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const representatives = useRepresentatives();
  const customers = useCustomers();
  const requests = useRequests();
  const payments = usePayments();
  const tags = useTags();
  const employers = useEmployers();
  const prefs = usePrefs();
  const employerFieldOn = prefs.employerFieldEnabled !== false;

  const [query, setQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Representative | null>(null);
  /** Cards ↔ table display mode (remembered per device). */
  const [view, setView] = useState<CollectionViewMode>(() => {
    const saved = loadPageFilter<string>("reps", "view", "cards", isCollectionViewMode);
    return isCollectionViewMode(saved) ? saved : "cards";
  });

  useEffect(() => {
    savePageFilter("reps", "view", view);
  }, [view]);

  // Round 22 — the same personalization filters as the مشتریان page,
  // remembered per device: visa status / linked کارفرما / sort.
  const [statusFilter, setStatusFilter] = useState<RepStatus>(() => {
    const saved = loadPageFilter<string>("reps", "status", "", () => true);
    return isRepStatus(saved) ? saved : "";
  });
  const [employerFilter, setEmployerFilter] = useState<string>(() => loadPageFilter<string>("reps", "employer", "", () => true));
  const [sort, setSort] = useState<RepSort>(() => {
    const saved = loadPageFilter<string>("reps", "sort", "name", () => true);
    return isRepSort(saved) ? saved : "name";
  });

  const repIdsByEmployer = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const empById = new Set((employers ?? []).map((e) => e.id));
    for (const c of customers ?? []) {
      if (!c.employerId || !empById.has(c.employerId)) continue;
      if (!c.representativeId) continue;
      const set = m.get(c.employerId) ?? new Set<string>();
      set.add(c.representativeId);
      m.set(c.employerId, set);
    }
    return m;
  }, [customers, employers]);

  useEffect(() => {
    savePageFilter("reps", "status", statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    savePageFilter("reps", "employer", employerFilter);
  }, [employerFilter]);
  useEffect(() => {
    savePageFilter("reps", "sort", sort);
  }, [sort]);

  /** Permanent delete — guarded by confirm; payments block it, requests/customers detach. */
  const removeRep = async (rep: Representative, requestCount: number, customerCount: number) => {
    const ok = await confirm({
      title: `حذف «${rep.name}»`,
      message:
        requestCount > 0 || customerCount > 0
          ? `${toPersianDigits(requestCount)} درخواست و ${toPersianDigits(customerCount)} مشتری این نماینده حفظ می‌شوند اما بدون نماینده می‌مانند. این عمل بازگشت‌پذیر نیست!`
          : "این نماینده درخواست یا مشتری ثبت‌شده ندارد. این عمل بازگشت‌پذیر نیست!",
      danger: true,
      confirmLabel: "حذف قطعی",
    });
    if (!ok) return;
    const res = await deleteRepresentative(rep.id, rep.name);
    if (res.ok) toast.info("نماینده حذف شد");
    else toast.error(res.reason ?? "حذف ناموفق بود");
  };

  const urgentTagIds = useMemo(
    () => new Set((tags ?? []).filter((t) => t.isUrgent).map((t) => t.id)),
    [tags],
  );

  const statsByRep = useMemo(() => {
    const m = new Map<string, { total: number; issued: number; rejected: number; inProgress: number; customers: number }>();
    for (const r of representatives ?? []) m.set(r.id, { total: 0, issued: 0, rejected: 0, inProgress: 0, customers: 0 });
    for (const c of customers ?? []) {
      if (!c.representativeId) continue;
      const e = m.get(c.representativeId);
      if (e) e.customers++;
    }
    for (const r of requests ?? []) {
      if (r.archivedAt || !r.representativeId) continue;
      const e = m.get(r.representativeId);
      if (!e) continue;
      e.total++;
      if (r.issued) e.issued++;
      else if (r.rejected) e.rejected++;
      else e.inProgress++;
    }
    return m;
  }, [representatives, customers, requests]);

  // A saved کارفرما filter whose employer was deleted must not hide every card.
  const activeEmployerFilter =
    employerFilter && (employerFilter === "none" || (employers ?? []).some((e) => e.id === employerFilter))
      ? employerFilter
      : "";

  const rows = useMemo(() => {
    let list = [...(representatives ?? [])];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) => `${r.name} ${r.phone ?? ""}`.toLowerCase().includes(q));
    }
    if (statusFilter) {
      list = list.filter((r) => {
        const s = statsByRep.get(r.id);
        switch (statusFilter) {
          case "pending":
            return !!s && s.inProgress > 0;
          case "issued":
            return !!s && s.issued > 0;
          case "rejected":
            return !!s && s.rejected > 0;
          case "none":
            return !s || s.total === 0;
          default:
            return true;
        }
      });
    }
    if (activeEmployerFilter) {
      // «بدون کارفرما» = none of this rep's customers has any employer at all.
      const repHasAnyEmployer = (rid: string) =>
        [...repIdsByEmployer.values()].some((set) => set.has(rid));
      list = list.filter((r) =>
        activeEmployerFilter === "none"
          ? !repHasAnyEmployer(r.id)
          : (repIdsByEmployer.get(activeEmployerFilter)?.has(r.id) ?? false),
      );
    }
    switch (sort) {
      case "newest":
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "oldest":
        list.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "mostCustomers":
        list.sort((a, b) => (statsByRep.get(b.id)?.customers ?? 0) - (statsByRep.get(a.id)?.customers ?? 0) || a.name.localeCompare(b.name, "fa"));
        break;
      case "mostRequests":
        list.sort((a, b) => (statsByRep.get(b.id)?.total ?? 0) - (statsByRep.get(a.id)?.total ?? 0) || a.name.localeCompare(b.name, "fa"));
        break;
      case "mostIssued":
        list.sort((a, b) => (statsByRep.get(b.id)?.issued ?? 0) - (statsByRep.get(a.id)?.issued ?? 0) || a.name.localeCompare(b.name, "fa"));
        break;
      default:
        list.sort((a, b) => a.name.localeCompare(b.name, "fa"));
    }
    return list;
  }, [representatives, query, statusFilter, activeEmployerFilter, sort, statsByRep, repIdsByEmployer]);

  const anyFilterActive = !!query.trim() || !!statusFilter || !!activeEmployerFilter;

  const clearAllFilters = () => {
    setQuery("");
    setStatusFilter("");
    setEmployerFilter("");
  };

  /** Table rows — rep + stats (drives both views). */
  const tableRows = useMemo(
    () =>
      rows.map((rep) => {
        const stats = computeRepStats(rep.id, requests ?? [], urgentTagIds);
        const repPayments = (payments ?? []).filter((p) => p.representativeId === rep.id);
        return {
          ...rep,
          total: stats.total,
          issued: stats.issued,
          inProgress: stats.inProgress,
          rejected: stats.rejected,
          customers: statsByRep.get(rep.id)?.customers ?? 0,
          paidIRT: repPayments.filter((p) => p.currency === "IRT").reduce((s, p) => s + p.amount, 0),
          paidUSD: repPayments.filter((p) => p.currency === "USD").reduce((s, p) => s + p.amount, 0),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, requests, payments, urgentTagIds, statsByRep],
  );

  const columns: Column<(typeof tableRows)[number]>[] = [
    {
      key: "name",
      header: "نماینده",
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar photo={r.photo} name={r.name} />
          <div className="min-w-0">
            <span className="block truncate font-semibold">{r.name}</span>
            {r.phone && (
              <span dir="ltr" className="num flex items-center gap-1 text-[11px] text-ink-400">
                <Phone size={10} /> {r.phone}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "customers",
      header: "مشتریان",
      align: "center",
      sortValue: (r) => r.customers,
      render: (r) => <span className="num font-bold">{toPersianDigits(r.customers)}</span>,
    },
    {
      key: "total",
      header: "درخواست‌ها",
      align: "center",
      sortValue: (r) => r.total,
      render: (r) => <span className="num">{toPersianDigits(r.total)}</span>,
    },
    {
      key: "issued",
      header: "صادر شده",
      align: "center",
      sortValue: (r) => r.issued,
      render: (r) => (
        <span className="num font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">{toPersianDigits(r.issued)}</span>
      ),
    },
    {
      key: "inProgress",
      header: "در حال کار",
      align: "center",
      sortValue: (r) => r.inProgress,
      render: (r) => (
        <span className="num font-bold text-[#c77d0a] dark:text-[#f5b84f]">{toPersianDigits(r.inProgress)}</span>
      ),
    },
    {
      key: "rejected",
      header: "رد شده",
      align: "center",
      sortValue: (r) => r.rejected,
      render: (r) =>
        r.rejected > 0 ? (
          <span className="num font-bold text-[#dc3535] dark:text-[#f87b7b]">{toPersianDigits(r.rejected)}</span>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    {
      key: "paid",
      header: "دریافتی",
      sortValue: (r) => r.paidUSD * 100000 + r.paidIRT,
      render: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {r.paidUSD > 0 && <span className="chip-soft num">{formatMoney(r.paidUSD, "USD")}</span>}
          {r.paidIRT > 0 && <span className="chip-soft num">{formatMoney(r.paidIRT, "IRT")}</span>}
          {r.paidUSD === 0 && r.paidIRT === 0 && <span className="text-ink-400">—</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Menu
          items={[
            { icon: FilePenLine, label: "مشاهده پروفایل", onClick: () => navigate(`/representatives/${r.id}`) },
            {
              icon: FilePenLine,
              label: "ویرایش",
              onClick: () => {
                setEditing(r);
                setEditOpen(true);
              },
            },
            {
              icon: UserRoundPlus,
              label: "درخواست جدید برای این نماینده",
              onClick: () => uiActions.openRequestModal({ representativeId: r.id }),
            },
            {
              icon: Archive,
              label: "بایگانی",
              onClick: async () => {
                const ok = await confirm({ title: `بایگانی «${r.name}»؟` });
                if (ok) {
                  await archiveRepresentative(r.id, r.name);
                  toast.info("نماینده بایگانی شد");
                }
              },
            },
            {
              icon: Trash2,
              label: "حذف قطعی",
              danger: true,
              onClick: () => void removeRep(r, r.total, r.customers),
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
        title="نمایندگان"
        subtitle={`${toPersianDigits(rows.length)} نماینده فعال`}
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            <UserRoundPlus size={15} /> نماینده جدید
          </button>
        }
      />

      {/* Round 22 — personalization filters (same family as the مشتریان page). */}
      <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3.5" data-reps-filters>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="جستجوی نام یا شماره تماس…"
          className="min-w-[200px] flex-1"
        />
        <FilterSelect
          ariaLabel="وضعیت درخواست‌ها"
          value={statusFilter}
          onChange={(v) => setStatusFilter(isRepStatus(v) ? v : "")}
          options={REP_STATUS.map((s) => ({ value: s.value, label: s.label }))}
        />
        {employerFieldOn && (employers ?? []).length > 0 && (
          <FilterSelect
            ariaLabel="کارفرما"
            value={activeEmployerFilter}
            onChange={setEmployerFilter}
            options={[
              { value: "", label: "همه کارفرماها" },
              { value: "none", label: "بدون کارفرما" },
              ...(employers ?? [])
                .filter((e) => (repIdsByEmployer.get(e.id)?.size ?? 0) > 0)
                .map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        )}
        <FilterSelect
          ariaLabel="مرتب‌سازی"
          value={sort}
          onChange={(v) => setSort(isRepSort(v) ? v : "name")}
          options={[
            { value: "name", label: "الفبا" },
            { value: "newest", label: "جدیدترین" },
            { value: "oldest", label: "قدیمی‌ترین" },
            { value: "mostCustomers", label: "بیشترین مشتری" },
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
        <ViewModeToggle value={view} onChange={setView} />
      </div>

      {representatives === undefined ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-3xl bg-ink-900/5 dark:bg-white/5" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="نماینده‌ای یافت نشد"
          description={
            anyFilterActive
              ? "فیلترها را عوض کنید یا پاک کنید"
              : "نماینده‌ها سفارش‌های ویزا ارسال می‌کنند و پرونده مالی هرکدام جداگانه محاسبه می‌شود"
          }
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <UserRoundPlus size={15} /> اولین نماینده
            </button>
          }
        />
      ) : view === "table" ? (
        <DataTable
          columns={columns}
          rows={tableRows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/representatives/${r.id}`)}
          empty={<EmptyState icon={UserRound} title="نماینده‌ای یافت نشد" compact />}
          footer={`${toPersianDigits(rows.length)} نماینده`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((rep) => {
            const stats = computeRepStats(rep.id, requests ?? [], urgentTagIds);
            const repPayments = (payments ?? []).filter((p) => p.representativeId === rep.id);
            const repCustomersCount = (customers ?? []).filter((c) => c.representativeId === rep.id).length;
            const paidIRT = repPayments.filter((p) => p.currency === "IRT").reduce((s, p) => s + p.amount, 0);
            const paidUSD = repPayments.filter((p) => p.currency === "USD").reduce((s, p) => s + p.amount, 0);
            return (
              <div
                key={rep.id}
                className="glass group rounded-3xl p-5 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => navigate(`/representatives/${rep.id}`)}>
                    <Avatar photo={rep.photo} name={rep.name} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-extrabold group-hover:text-brand-600 dark:group-hover:text-brand-300">
                        {rep.name}
                      </span>
                      {rep.phone && (
                        <span dir="ltr" className="num mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                          <Phone size={11} /> {rep.phone}
                        </span>
                      )}
                    </span>
                  </button>
                  <Menu
                    items={[
                      {
                        icon: FilePenLine,
                        label: "ویرایش",
                        onClick: () => {
                          setEditing(rep);
                          setEditOpen(true);
                        },
                      },
                      {
                        icon: UserRoundPlus,
                        label: "درخواست جدید برای این نماینده",
                        onClick: () => uiActions.openRequestModal({ representativeId: rep.id }),
                      },
                      {
                        icon: Archive,
                        label: "بایگانی",
                        onClick: async () => {
                          const ok = await confirm({ title: `بایگانی «${rep.name}»؟` });
                          if (ok) {
                            await archiveRepresentative(rep.id, rep.name);
                            toast.info("نماینده بایگانی شد");
                          }
                        },
                      },
                      {
                        icon: Trash2,
                        label: "حذف قطعی",
                        danger: true,
                        onClick: () => void removeRep(rep, stats.total, repCustomersCount),
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
                </div>

                <div className={`mb-3 grid gap-1.5 text-center ${stats.rejected > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
                  <div className="rounded-2xl bg-brand-500/6 py-2">
                    <p className="num text-[15px] font-bold">{toPersianDigits(stats.total)}</p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">درخواست</p>
                  </div>
                  <div className="rounded-2xl bg-[#10b981]/8 py-2">
                    <p className="num text-[15px] font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">
                      {toPersianDigits(stats.issued)}
                    </p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">صادر شده</p>
                  </div>
                  <div className="rounded-2xl bg-[#f59e0b]/8 py-2">
                    <p className="num text-[15px] font-bold text-[#c77d0a] dark:text-[#f5b84f]">
                      {toPersianDigits(stats.inProgress)}
                    </p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">در حال کار</p>
                  </div>
                  {stats.rejected > 0 && (
                    <div className="rounded-2xl bg-[#ef4444]/8 py-2">
                      <p className="num text-[15px] font-bold text-[#dc3535] dark:text-[#f87b7b]">
                        {toPersianDigits(stats.rejected)}
                      </p>
                      <p className="text-[10px] text-ink-500 dark:text-ink-400">رد شده</p>
                    </div>
                  )}
                </div>

                {(paidUSD > 0 || paidIRT > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {paidUSD > 0 && <span className="chip num">{formatMoney(paidUSD, "USD")} دریافتی</span>}
                    {paidIRT > 0 && <span className="chip num">{formatMoney(paidIRT, "IRT")} دریافتی</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RepresentativeFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        representative={editing ?? undefined}
      />
    </div>
  );
}
