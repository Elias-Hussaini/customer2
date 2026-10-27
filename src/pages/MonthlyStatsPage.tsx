import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BadgeCheck,
  Banknote,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileImage,
  FilePlus2,
  Medal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard, RadioSelect } from "../components/ui/inputs";
import { GlassCard } from "../components/ui/GlassCard";
import { EmptyState } from "../components/ui/EmptyState";
import { MonthlyBars, MoneyAreaChart, StatsDonut } from "../components/charts/MonthlyCharts";
import { useCustomers, usePayments, useRequests } from "../hooks/useData";
import { db } from "../db/schema";
import {
  aggregateMonthly,
  buildRecentMonths,
  isoToMonthKey,
  pctDelta,
  topIssuedMonths,
  type MonthAgg,
} from "../services/monthlyStats";
import { formatMoney } from "../utils/num";
import { todayIso, toPersianDigits } from "../utils/jalali";
import type { Currency } from "../types";
import type { LucideIcon } from "lucide-react";

const DONUT_COLORS = ["#635BFF", "#10b981", "#f59e0b", "#0ea5e9", "#ef4444", "#8b5cf6"];

function DeltaChip({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta == null) return <span className="text-[10px] text-ink-400">بدون ماه قبل</span>;
  const good = invert ? delta <= 0 : delta >= 0;
  const up = delta >= 0;
  return (
    <span
      className={`num flex items-center gap-0.5 text-[10.5px] font-bold ${
        good ? "text-[#0b9e6e]" : "text-[#dc3535]"
      }`}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {toPersianDigits(Math.abs(Math.round(delta)))}٪
    </span>
  );
}

/** One KPI tile of the hero card. */
function KpiTile({
  icon: Icon,
  label,
  value,
  prev,
  delta,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  prev?: string;
  delta: number | null;
  tone: string;
}) {
  return (
    <div className="glass-soft flex items-center gap-3 rounded-2xl p-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10.5px] font-medium text-ink-500 dark:text-ink-400">{label}</p>
        <p className="num truncate text-[17px] font-bold leading-6">{value}</p>
        <div className="flex items-center gap-1.5">
          <DeltaChip delta={delta} />
          {delta != null && prev && (
            <span className="num truncate text-[10px] text-ink-400">({prev})</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function MonthlyStatsPage() {
  const customers = useCustomers();
  const requests = useRequests();
  const payments = usePayments();

  // Only the createdAt timestamps are needed for the "مدارک جدید" counter.
  const attachmentDates = useLiveQuery(
    async () => (await db.attachments.toArray()).map((a) => a.createdAt),
    [],
  );

  /** 13 months — the oldest is only a delta baseline for the display window. */
  const months13 = useMemo(() => buildRecentMonths(13, todayIso()), []);
  const aggs13 = useMemo(() => {
    if (!customers || !requests || !payments) return null;
    return aggregateMonthly({
      months: months13,
      customers,
      requests,
      payments,
      attachmentDates: attachmentDates ?? [],
    });
  }, [months13, customers, requests, payments, attachmentDates]);

  const window = aggs13 ? aggs13.slice(1) : [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moneyCurrency, setMoneyCurrency] = useState<Currency>("IRT");

  const loading = !aggs13;
  const selectedIdx = selectedKey
    ? Math.max(0, window.findIndex((m) => m.key === selectedKey))
    : window.length - 1;
  const selected: MonthAgg | undefined = window[selectedIdx];
  const baseline: MonthAgg | undefined = aggs13 ? aggs13[selectedIdx] : undefined; // month before selected

  const isEmpty =
    !loading &&
    window.every(
      (m) =>
        m.newCustomers === 0 && m.newRequests === 0 && m.issued === 0 && m.newDocs === 0 && m.paidUSD === 0 && m.paidIRT === 0,
    );

  const totals = useMemo(() => {
    const t = { customers: 0, requests: 0, issued: 0, docs: 0, usd: 0, irt: 0 };
    for (const m of window) {
      t.customers += m.newCustomers;
      t.requests += m.newRequests;
      t.issued += m.issued;
      t.docs += m.newDocs;
      t.usd += m.paidUSD;
      t.irt += m.paidIRT;
    }
    return t;
  }, [window]);

  /** Visa-type mix of the selected month. */
  const donutSlices = useMemo(() => {
    if (!selected || !requests) return [];
    const mk = selected.key;
    const counts = new Map<string, number>();
    for (const r of requests) {
      if (isoToMonthKey(r.registrationDate) !== mk) continue;
      const label = r.visaType?.trim() || "نامشخص";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const slices = top.map(([label, value], i) => ({ label, value, color: DONUT_COLORS[i] }));
    if (rest > 0) slices.push({ label: "سایر", value: rest, color: DONUT_COLORS[5] });
    return slices;
  }, [selected, requests]);

  const topMonths = useMemo(() => topIssuedMonths(window, 3), [window]);

  const stepMonth = (dir: 1 | -1) => {
    const next = Math.min(window.length - 1, Math.max(0, selectedIdx + dir));
    setSelectedKey(window[next]?.key ?? null);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={CalendarRange}
        title="آمار ماهانه"
        subtitle="خلاصه عملکرد هر ماه بر اساس تقویم شمسی — روی نمودارها لمس کنید"
      />

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-400">در حال محاسبه…</p>
      ) : isEmpty ? (
        <GlassCard className="p-5">
          <EmptyState
            icon={Sparkles}
            title="هنوز آماری وجود ندارد"
            description="با ثبت مشتری، درخواست و پرداخت، نمودارهای ماهانه همین‌جا ساخته می‌شوند."
          />
        </GlassCard>
      ) : (
        selected && (
          <>
            {/* --------------------------- hero month card -------------------------- */}
            <GlassCard className="overflow-hidden p-0">
              <div className="bg-gradient-to-l from-brand-500/12 via-transparent to-[#10b981]/10 p-5">
                <div className="flex items-center justify-between gap-3">
                  <button
                    className="icon-btn glass"
                    onClick={() => stepMonth(1)}
                    aria-label="ماه بعد"
                    disabled={selectedIdx >= window.length - 1}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <div className="min-w-0 text-center">
                    <h2 className="truncate text-[19px] font-extrabold">{selected.fullLabel}</h2>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">
                      {selectedIdx === window.length - 1 ? "ماه جاری" : "ماه انتخاب‌شده"}
                    </p>
                  </div>
                  <button
                    className="icon-btn glass"
                    onClick={() => stepMonth(-1)}
                    aria-label="ماه قبل"
                    disabled={selectedIdx <= 0}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>

                {/* month chips — 12 months, newest on the left (RTL) */}
                <div className="scrollbar-none mt-3.5 flex gap-1.5 overflow-x-auto pb-1">
                  {window.map((m) => {
                    const active = m.key === selected.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setSelectedKey(m.key)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
                          active
                            ? "bg-brand-500 text-white shadow-lg shadow-brand-500/25"
                            : "glass-soft text-ink-600 hover:text-brand-600 dark:text-ink-300"
                        }`}
                      >
                        {m.label}
                        {m.key.endsWith("-01") && (
                          <span className="num"> {toPersianDigits(m.key.slice(0, 4))}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <KpiTile
                    icon={UserPlus}
                    label="مشتریان جدید"
                    value={toPersianDigits(selected.newCustomers)}
                    prev={toPersianDigits(baseline?.newCustomers ?? 0)}
                    delta={pctDelta(selected.newCustomers, baseline?.newCustomers ?? 0)}
                    tone="bg-brand-500/12 text-brand-600 dark:text-brand-300"
                  />
                  <KpiTile
                    icon={FilePlus2}
                    label="درخواست‌های جدید"
                    value={toPersianDigits(selected.newRequests)}
                    prev={toPersianDigits(baseline?.newRequests ?? 0)}
                    delta={pctDelta(selected.newRequests, baseline?.newRequests ?? 0)}
                    tone="bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]"
                  />
                  <KpiTile
                    icon={BadgeCheck}
                    label="ویزاهای صادر شده"
                    value={toPersianDigits(selected.issued)}
                    prev={toPersianDigits(baseline?.issued ?? 0)}
                    delta={pctDelta(selected.issued, baseline?.issued ?? 0)}
                    tone="bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]"
                  />
                  <KpiTile
                    icon={FileImage}
                    label="مدارک ثبت‌شده"
                    value={toPersianDigits(selected.newDocs)}
                    prev={toPersianDigits(baseline?.newDocs ?? 0)}
                    delta={pctDelta(selected.newDocs, baseline?.newDocs ?? 0)}
                    tone="bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]"
                  />
                  <KpiTile
                    icon={Banknote}
                    label="دریافتی (تومان)"
                    value={formatMoney(selected.paidIRT, "IRT")}
                    prev={formatMoney(baseline?.paidIRT ?? 0, "IRT")}
                    delta={pctDelta(selected.paidIRT, baseline?.paidIRT ?? 0)}
                    tone="bg-[#8b5cf6]/12 text-[#7c3aed] dark:text-[#c4b5fd]"
                  />
                  <KpiTile
                    icon={Banknote}
                    label="دریافتی (دلار)"
                    value={formatMoney(selected.paidUSD, "USD")}
                    prev={formatMoney(baseline?.paidUSD ?? 0, "USD")}
                    delta={pctDelta(selected.paidUSD, baseline?.paidUSD ?? 0)}
                    tone="bg-[#0ea5e9]/12 text-[#0284c7] dark:text-[#7dd3fc]"
                  />
                </div>
              </div>
            </GlassCard>

            {/* ------------------------------ bars chart ---------------------------- */}
            <SectionCard
              title="درخواست‌ها و صدور ویزا — ۱۲ ماه اخیر"
              icon={<CalendarRange size={15} className="text-brand-500" />}
            >
              <MonthlyBars
                months={window.map((m) => ({ key: m.key, label: m.label, a: m.newRequests, b: m.issued }))}
                selectedKey={selected.key}
                onSelect={setSelectedKey}
              />
            </SectionCard>

            {/* ------------------------------ money chart --------------------------- */}
            <SectionCard
              title="دریافتی ماهانه"
              icon={<Banknote size={15} className="text-[#0b9e6e]" />}
              action={
                <RadioSelect
                  options={[
                    { value: "IRT", label: "تومان" },
                    { value: "USD", label: "دلار" },
                  ]}
                  value={moneyCurrency}
                  onChange={(v) => setMoneyCurrency(v as Currency)}
                />
              }
            >
              <MoneyAreaChart
                points={window.map((m) => ({
                  key: m.key,
                  label: m.label,
                  value: moneyCurrency === "IRT" ? m.paidIRT : m.paidUSD,
                }))}
                currency={moneyCurrency}
                selectedKey={selected.key}
                onSelect={setSelectedKey}
              />
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                <span className="chip-soft num rounded-full px-3 py-1">
                  جمع ۱۲ ماه — تومان: {formatMoney(totals.irt, "IRT")}
                </span>
                <span className="chip-soft num rounded-full px-3 py-1">
                  جمع ۱۲ ماه — دلار: {formatMoney(totals.usd, "USD")}
                </span>
              </div>
            </SectionCard>

            {/* --------------------------- donut + top months ----------------------- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title={`انواع ویزا در ${selected.fullLabel}`}
                icon={<Sparkles size={15} className="text-[#7c3aed]" />}
              >
                <StatsDonut
                  slices={donutSlices}
                  centerLabel="درخواست این ماه"
                  centerValue={toPersianDigits(selected.newRequests)}
                />
              </SectionCard>

              <SectionCard title="برترین ماه‌ها" icon={<Trophy size={15} className="text-[#c77d0a]" />}>
                {topMonths.length === 0 ? (
                  <p className="py-8 text-center text-xs text-ink-400">هنوز ویزایی صادر نشده است</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {topMonths.map((m, i) => (
                      <li
                        key={m.key}
                        className="glass-soft flex items-center gap-3 rounded-2xl px-3.5 py-2.5"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                            i === 0
                              ? "bg-[#f59e0b]/16 text-[#c77d0a]"
                              : "bg-brand-500/10 text-brand-600 dark:text-brand-300"
                          }`}
                        >
                          {i === 0 ? <Trophy size={16} /> : <Medal size={16} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{m.fullLabel}</span>
                          <span className="text-[11px] text-ink-500 dark:text-ink-400">
                            <span className="num">{toPersianDigits(m.newRequests)}</span> درخواست •{" "}
                            <span className="num">{toPersianDigits(m.newCustomers)}</span> مشتری جدید
                          </span>
                        </span>
                        <span className="num shrink-0 rounded-full bg-[#10b981]/12 px-2.5 py-1 text-[12px] font-extrabold text-[#0b9e6e]">
                          {toPersianDigits(m.issued)} ویزا
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* ------------------------------ 12m totals ---------------------------- */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { label: "مشتریان جدید (۱۲ ماه)", value: toPersianDigits(totals.customers) },
                { label: "درخواست‌ها (۱۲ ماه)", value: toPersianDigits(totals.requests) },
                { label: "ویزاهای صادر شده", value: toPersianDigits(totals.issued) },
                { label: "مدارک ثبت‌شده", value: toPersianDigits(totals.docs) },
              ].map((t) => (
                <GlassCard key={t.label} className="p-3.5 text-center">
                  <p className="text-[10.5px] text-ink-500 dark:text-ink-400">{t.label}</p>
                  <p className="num mt-1 text-[18px] font-extrabold">{t.value}</p>
                </GlassCard>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
