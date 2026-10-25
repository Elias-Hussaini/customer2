import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, FilePenLine, Phone, UserRound, UserRoundPlus } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { SearchBox } from "../components/ui/inputs";
import { Menu } from "../components/ui/Menu";
import { RepresentativeFormModal } from "../components/domain/RepresentativeFormModal";
import { archiveRepresentative, deleteRepresentative } from "../db/reps";
import { useRepresentatives, useRequests, usePayments, useTags } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatMoney } from "../utils/num";
import { computeRepStats } from "../services/stats";
import { toPersianDigits } from "../utils/jalali";
import { uiActions } from "../components/layout/uiStore";
import type { Representative } from "../types";

export function RepresentativesPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const representatives = useRepresentatives();
  const requests = useRequests();
  const payments = usePayments();
  const tags = useTags();

  const [query, setQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Representative | null>(null);

  const urgentTagIds = useMemo(
    () => new Set((tags ?? []).filter((t) => t.isUrgent).map((t) => t.id)),
    [tags],
  );

  const rows = useMemo(() => {
    let list = [...(representatives ?? [])];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) => `${r.name} ${r.phone ?? ""}`.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [representatives, query]);

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

      <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام یا شماره تماس…" className="glass rounded-2xl p-1" />

      {representatives === undefined ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-3xl bg-ink-900/5 dark:bg-white/5" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="نماینده‌ای ثبت نشده"
          description="نماینده‌ها سفارش‌های ویزا ارسال می‌کنند و پرونده مالی هرکدام جداگانه محاسبه می‌شود"
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <UserRoundPlus size={15} /> اولین نماینده
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((rep) => {
            const stats = computeRepStats(rep.id, requests ?? [], urgentTagIds);
            const repPayments = (payments ?? []).filter((p) => p.representativeId === rep.id);
            const paidIRT = repPayments.filter((p) => p.currency === "IRT").reduce((s, p) => s + p.amount, 0);
            const paidUSD = repPayments.filter((p) => p.currency === "USD").reduce((s, p) => s + p.amount, 0);
            return (
              <div
                key={rep.id}
                className="glass group rounded-3xl p-5 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => navigate(`/representatives/${rep.id}`)}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-500/12 text-[15px] font-extrabold text-brand-600 dark:text-brand-300">
                      {rep.name.slice(0, 1)}
                    </span>
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
