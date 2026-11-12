/**
 * کارفرماها — the dedicated employers section (moved OUT of Settings).
 * Full profiles like customers & representatives: rich cards, quick search,
 * archive/restore and hard delete that preserves the linked customers.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Briefcase,
  FilePenLine,
  Mail,
  Phone,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { PageHeader, StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox } from "../components/ui/inputs";
import { Menu } from "../components/ui/Menu";
import { DataTable, type Column } from "../components/ui/DataTable";
import { ViewModeToggle, isCollectionViewMode, type CollectionViewMode } from "../components/ui/ViewModeToggle";
import { Toggle } from "../components/ui/fields";
import { EmployerFormModal } from "../components/domain/EmployerFormModal";
import { Avatar } from "../components/ui/Avatar";
import {
  archiveEmployer,
  deleteEmployer,
  restoreEmployer,
} from "../db/employers";
import {
  useCustomers,
  useEmployers,
  usePrefs,
  useRequests,
  updatePrefs,
} from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali } from "../utils/jalali";
import { toPersianDigits } from "../utils/jalali";
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
import type { Employer } from "../types";

export function EmployersPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const employers = useEmployers();
  const allEmployers = useEmployers(false);
  const customers = useCustomers();
  const prefs = usePrefs();

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Employer | null>(null);
  /** Cards ↔ table display mode (remembered per device). */
  const [view, setView] = useState<CollectionViewMode>(() => {
    const saved = loadPageFilter<string>("employers", "view", "cards", isCollectionViewMode);
    return isCollectionViewMode(saved) ? saved : "cards";
  });
  const requests = useRequests();

  useEffect(() => {
    savePageFilter("employers", "view", view);
  }, [view]);

  const archived = useMemo(
    () => (allEmployers ?? []).filter((e) => e.archivedAt),
    [allEmployers],
  );

  const rows = useMemo(() => {
    let list = showArchived ? archived : (employers ?? []);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((e) =>
        `${e.name} ${e.phone ?? ""} ${e.email ?? ""} ${e.nationalId ?? ""} ${e.username ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [employers, archived, showArchived, query]);

  const customerCount = (id: string) =>
    (customers ?? []).filter((c) => c.employerId === id).length;

  const remove = async (emp: Employer) => {
    const linked = customerCount(emp.id);
    const docs = 0; // own docs are removed together with the record
    const ok = await confirm({
      title: `حذف «${emp.name}»`,
      message:
        linked > 0
          ? `${toPersianDigits(linked)} مشتری این کارفرما حفظ می‌شوند و بدون کارفرما می‌مانند. مدارک خود کارفرما همراهش حذف می‌شود. این عمل بازگشت‌پذیر نیست!`
          : "مدارک خود کارفرما همراهش حذف می‌شود. این عمل بازگشت‌پذیر نیست!",
      danger: true,
      confirmLabel: "حذف قطعی",
    });
    if (!ok) return;
    void docs;
    try {
      await deleteEmployer(emp.id, emp.name);
      toast.info("کارفرما حذف شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ناموفق بود");
    }
  };

  /** Table rows with stats (drives the table view). */
  const tableRows = useMemo(() => {
    const idsByEmployer = new Map<string, Set<string>>();
    for (const c of customers ?? []) {
      if (!c.employerId) continue;
      const set = idsByEmployer.get(c.employerId) ?? new Set<string>();
      set.add(c.id);
      idsByEmployer.set(c.employerId, set);
    }
    return rows.map((emp) => {
      const ids = idsByEmployer.get(emp.id) ?? new Set<string>();
      const mine = (requests ?? []).filter((r) => ids.has(r.customerId) && !r.archivedAt);
      const mineCustomers = (customers ?? []).filter((c) => c.employerId === emp.id);
      return {
        ...emp,
        linked: mineCustomers.length,
        withCode: mineCustomers.filter((c) => !!c.referrer?.trim()).length,
        reqCount: mine.length,
        issued: mine.filter((r) => r.issued).length,
      };
    });
  }, [rows, customers, requests]);

  const empMenu = (emp: Employer) =>
    [
      {
        icon: Briefcase,
        label: "مشاهده پروفایل",
        onClick: () => navigate(`/employers/${emp.id}`),
      },
      {
        icon: FilePenLine,
        label: "ویرایش",
        onClick: () => {
          setEditing(emp);
          setEditOpen(true);
        },
      },
      ...(emp.archivedAt
        ? [
            {
              icon: ArchiveRestore,
              label: "بازگردانی از آرشیو",
              onClick: async () => {
                await restoreEmployer(emp.id, emp.name);
                toast.info("کارفرما بازگردانده شد");
              },
            },
          ]
        : [
            {
              icon: Archive,
              label: "بایگانی",
              onClick: async () => {
                const ok = await confirm({ title: `بایگانی «${emp.name}»؟` });
                if (ok) {
                  await archiveEmployer(emp.id, emp.name);
                  toast.info("کارفرما بایگانی شد");
                }
              },
            },
          ]),
      {
        icon: Trash2,
        label: "حذف قطعی",
        danger: true,
        onClick: () => void remove(emp),
      },
    ];

  const empColumns: Column<(typeof tableRows)[number]>[] = [
    {
      key: "name",
      header: "کارفرما",
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar photo={r.photo} name={r.name} />
          <div className="min-w-0">
            <span className="block truncate font-semibold">{r.name}</span>
            {r.phone ? (
              <span dir="ltr" className="num flex items-center gap-1 text-[11px] text-ink-400">
                <Phone size={10} /> {r.phone}
              </span>
            ) : r.email ? (
              <span dir="ltr" className="flex items-center gap-1 text-[11px] text-ink-400">
                <Mail size={10} /> {r.email}
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "linked",
      header: "مشتریان",
      align: "center",
      sortValue: (r) => r.linked,
      render: (r) => <span className="num font-bold">{toPersianDigits(r.linked)}</span>,
    },
    {
      key: "withCode",
      header: "دارای کد اختصاصی",
      align: "center",
      sortValue: (r) => r.withCode,
      render: (r) =>
        r.withCode > 0 ? (
          <span className="num font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">{toPersianDigits(r.withCode)}</span>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    {
      key: "reqCount",
      header: "درخواست‌ها",
      align: "center",
      sortValue: (r) => r.reqCount,
      render: (r) => <span className="num">{toPersianDigits(r.reqCount)}</span>,
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
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Menu
          items={empMenu(r)}
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
        title="کارفرماها"
        subtitle={`${toPersianDigits(rows.length)} کارفرما${showArchived ? " (آرشیو)" : ""}`}
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            <UserRoundPlus size={15} /> کارفرمای جدید
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Briefcase} tone="brand" label="کارفرمای فعال" value={toPersianDigits(employers?.length ?? 0)} />
        <StatCard icon={Archive} tone="neutral" label="بایگانی‌شده" value={toPersianDigits(archived.length)} />
        <StatCard
          icon={FilePenLine}
          tone="success"
          label="مشتریان دارای کارفرما"
          value={toPersianDigits((customers ?? []).filter((c) => c.employerId).length)}
        />
        <StatCard
          icon={Phone}
          tone="warning"
          label="با شماره تماس"
          value={toPersianDigits((employers ?? []).filter((e) => e.phone).length)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="جستجوی نام، تماس، ایمیل، کد ملی یا نام کاربری…"
          className="glass min-w-[200px] flex-1 rounded-2xl p-1"
        />
        <ViewModeToggle value={view} onChange={setView} />
      </div>

      {/* Master switch for the customer-form field (moved here from Settings). */}
      <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">فیلد کارفرما در فرم مشتری</p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">
            با خاموش کردن، انتخاب کارفرما از فرم ثبت مشتری و پرونده‌ها پنهان می‌شود (داده‌ها حذف نمی‌شوند)
          </p>
        </div>
        <Toggle
          checked={prefs.employerFieldEnabled !== false}
          onChange={(v) => void updatePrefs({ employerFieldEnabled: v })}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={showArchived ? "آرشیو خالی است" : "کارفرمایی ثبت نشده"}
          description="کارفرماها مثل مشتریان و نمایندگان پرونده کامل دارند: تماس، کد ملی، دسترسی‌ها، آدرس و مدارک"
          action={
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditing(null);
                setEditOpen(true);
              }}
            >
              <UserRoundPlus size={15} /> اولین کارفرما
            </button>
          }
        />
      ) : view === "table" ? (
        <DataTable
          columns={empColumns}
          rows={tableRows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/employers/${r.id}`)}
          empty={<EmptyState icon={Briefcase} title="کارفرمایی یافت نشد" compact />}
          footer={`${toPersianDigits(rows.length)} کارفرما`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((emp) => {
            const linked = customerCount(emp.id);
            return (
              <div
                key={emp.id}
                className="glass group rounded-3xl p-5 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-right"
                    onClick={() => navigate(`/employers/${emp.id}`)}
                  >
                    <Avatar photo={emp.photo} name={emp.name} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-extrabold group-hover:text-brand-600 dark:group-hover:text-brand-300">
                        {emp.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                        {emp.phone ? (
                          <span dir="ltr" className="num flex items-center gap-1">
                            <Phone size={11} /> {emp.phone}
                          </span>
                        ) : emp.email ? (
                          <span dir="ltr" className="flex items-center gap-1">
                            <Mail size={11} /> {emp.email}
                          </span>
                        ) : (
                          <span>بدون تماس ثبت‌شده</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <Menu
                    items={[
                      {
                        icon: FilePenLine,
                        label: "ویرایش",
                        onClick: () => {
                          setEditing(emp);
                          setEditOpen(true);
                        },
                      },
                      ...(emp.archivedAt
                        ? [
                            {
                              icon: ArchiveRestore,
                              label: "بازگردانی از آرشیو",
                              onClick: async () => {
                                await restoreEmployer(emp.id, emp.name);
                                toast.info("کارفرما بازگردانده شد");
                              },
                            },
                          ]
                        : [
                            {
                              icon: Archive,
                              label: "بایگانی",
                              onClick: async () => {
                                const ok = await confirm({ title: `بایگانی «${emp.name}»؟` });
                                if (ok) {
                                  await archiveEmployer(emp.id, emp.name);
                                  toast.info("کارفرما بایگانی شد");
                                }
                              },
                            },
                          ]),
                      {
                        icon: Trash2,
                        label: "حذف قطعی",
                        danger: true,
                        onClick: () => void remove(emp),
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

                <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-2xl bg-brand-500/6 py-2">
                    <p className="num text-[15px] font-bold">{toPersianDigits(linked)}</p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">مشتری</p>
                  </div>
                  <div className="rounded-2xl bg-[#10b981]/8 py-2">
                    <p className="num text-[15px] font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">
                      {emp.nationalId ? "✓" : "—"}
                    </p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">کد ملی</p>
                  </div>
                  <div className="rounded-2xl bg-[#f59e0b]/8 py-2">
                    <p className="num text-[15px] font-bold text-[#c77d0a] dark:text-[#f5b84f]">
                      {formatJalali(new Date(emp.createdAt).toISOString().slice(0, 10))}
                    </p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">عضویت</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {emp.nationalId && (
                    <span className="chip num" dir="ltr">
                      کد ملی {emp.nationalId}
                    </span>
                  )}
                  {emp.address && <span className="chip">{emp.address.slice(0, 24)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <button
          className="btn btn-glass btn-sm mx-auto"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? "بازگشت به فعال‌ها" : `آرشیو (${toPersianDigits(archived.length)})`}
        </button>
      )}

      <EmployerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        employer={editing}
      />
    </div>
  );
}
