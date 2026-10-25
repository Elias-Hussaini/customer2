import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Flame,
  FolderOpen,
  ListChecks,
  Sparkles,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader, StatCard } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { GlassCard } from "../components/ui/GlassCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { StatusPill } from "../components/ui/Badges";
import {
  useActivities,
  useCustomers,
  useLists,
  usePayments,
  usePrefs,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { computeDashboardStats } from "../services/stats";
import { formatMoney } from "../utils/num";
import { formatJalali, todayIso, toPersianDigits } from "../utils/jalali";
import { customerFullName } from "../db/customers";
import { uiActions } from "../components/layout/uiStore";

export function DashboardPage() {
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const requests = useRequests();
  const payments = usePayments();
  const lists = useLists();
  const tags = useTags();
  const activities = useActivities(8);
  const prefs = usePrefs();

  const loading = customers === undefined || requests === undefined;

  const stats = useMemo(() => {
    if (!customers || !representatives || !requests || !payments || !lists || !tags) return null;
    const urgentTagIds = new Set(tags.filter((t) => t.isUrgent).map((t) => t.id));
    return computeDashboardStats(customers, representatives, requests, payments, lists.length, urgentTagIds);
  }, [customers, representatives, requests, payments, lists, tags]);

  const recentRequests = useMemo(() => {
    if (!requests || !customers) return [];
    return [...requests].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  }, [requests, customers]);

  const isEmpty =
    !loading &&
    (customers?.length ?? 0) === 0 &&
    (representatives?.length ?? 0) === 0 &&
    (requests?.length ?? 0) === 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صبح بخیر" : hour < 17 ? "ظهر بخیر" : hour < 20 ? "عصر بخیر" : "شب بخیر";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting} 👋`}
        subtitle={`امروز ${formatJalali(todayIso(), "long")}`}
      />

      {isEmpty && (
        <GlassCard className="p-5">
          <EmptyState
            icon={Sparkles}
            title="به E-managment خوش آمدید!"
            description={
              <>
                برای شروع، یک <b>نماینده</b> بسازید، سپس <b>مشتری</b> ثبت کنید و اولین{" "}
                <b>درخواست ویزا</b> را وارد کنید. اگر می‌خواهید برنامه را با داده نمونه ببینید،
                از <Link to="/settings" className="font-bold text-brand-600 dark:text-brand-300">تنظیمات ← مدیریت داده</Link> استفاده کنید.
              </>
            }
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => uiActions.openRepModal()}>
                  <UserRound size={15} /> نماینده جدید
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => uiActions.openCustomerModal()}>
                  <UserPlus size={15} /> مشتری جدید
                </button>
              </div>
            }
          />
        </GlassCard>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button className="btn btn-primary" onClick={() => uiActions.openRequestModal()}>
          <FilePlus2 size={16} /> درخواست جدید
        </button>
        <button className="btn btn-glass" onClick={() => uiActions.openCustomerModal()}>
          <UserPlus size={16} /> مشتری جدید
        </button>
        <button className="btn btn-glass" onClick={() => uiActions.openRepModal()}>
          <UserRound size={16} /> نماینده جدید
        </button>
        <button className="btn btn-glass" onClick={() => uiActions.openPaymentModal()}>
          <Banknote size={16} /> ثبت پرداخت
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="مشتریان" value={toPersianDigits(stats?.customers ?? 0)} tone="brand" />
        <StatCard icon={UserRound} label="نمایندگان" value={toPersianDigits(stats?.representatives ?? 0)} tone="info" />
        <StatCard icon={ListChecks} label="کل درخواست‌ها" value={toPersianDigits(stats?.requests ?? 0)} tone="brand" />
        <StatCard icon={Flame} label="درخواست‌های فوری" value={toPersianDigits(stats?.urgent ?? 0)} tone="danger" />
        <StatCard icon={CheckCircle2} label="ویزاهای صادر شده" value={toPersianDigits(stats?.issued ?? 0)} tone="success" />
        <StatCard icon={Clock3} label="در حال کار" value={toPersianDigits(stats?.inProgress ?? 0)} tone="warning" />
        <StatCard icon={FolderOpen} label="لیست‌ها" value={toPersianDigits(stats?.lists ?? 0)} tone="neutral" />
        <div className="glass flex flex-col justify-center gap-1.5 rounded-3xl p-4">
          <p className="text-[11px] font-medium text-ink-500 dark:text-ink-400">مانده حساب‌ها</p>
          {stats && stats.balances.length > 0 ? (
            stats.balances.map((b) => (
              <p key={b.currency} className="num truncate text-[15px] font-bold">
                {formatMoney(b.balance, b.currency)}
              </p>
            ))
          ) : (
            <p className="text-[15px] font-bold text-ink-400">—</p>
          )}
          <p className="text-[10.5px] text-ink-400">جمع درخواست‌ها منهای پرداخت‌ها</p>
        </div>
      </div>

      {/* Recent + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="آخرین درخواست‌ها"
          icon={<FilePlus2 size={15} className="text-brand-500" />}
          action={
            <Link to="/requests" className="text-[11px] font-bold text-brand-600 dark:text-brand-300">
              همه درخواست‌ها
            </Link>
          }
        >
          {recentRequests.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-400">هنوز درخواستی ثبت نشده است</p>
          ) : (
            <ul className="flex flex-col">
              {recentRequests.map((r) => {
                const customer = customers?.find((c) => c.id === r.customerId);
                return (
                  <li key={r.id}>
                    <Link
                      to={`/requests/${r.id}/edit`}
                      className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-brand-500/6"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-[12px] font-bold text-brand-600 dark:text-brand-300">
                        {customer?.firstName?.[0] ?? "؟"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">
                          {customer ? customerFullName(customer) : "—"}
                        </span>
                        <span className="num block text-[11px] text-ink-500 dark:text-ink-400">
                          {r.visaType ?? "بدون نوع"} • {formatJalali(r.registrationDate)}
                        </span>
                      </span>
                      <StatusPill issued={r.issued} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="فعالیت‌های اخیر" icon={<Clock3 size={15} className="text-brand-500" />}>
          <ActivityFeed activities={activities} />
        </SectionCard>
      </div>

      {/* Currency note */}
      <p className="text-center text-[11px] leading-5 text-ink-400">
        مبالغ دلار و تومان همیشه جداگانه محاسبه می‌شوند
        {prefs.rememberLastSelections && " • آخرین نماینده و لیست انتخابی، در فرم بعدی پیش‌فرض می‌شود"}
      </p>
    </div>
  );
}
