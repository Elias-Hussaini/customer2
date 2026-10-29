/** Accounting dashboard — every number traceable to real records. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  FileText,
  Plus,
  Receipt,
  Scale,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { StatCard } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { SectionCard } from "../../components/ui/inputs";
import { RadioSelect } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { ListSkeleton } from "../../components/ui/EmptyState";
import type { Currency } from "../../types";
import { CURRENCY_LABELS, currencyLabel } from "../../types";
import { formatJalali, todayIso } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import { fromMinor, toMinor } from "../../utils/num";
import {
  computeAllAccountBalances,
  groupByPeriod,
  countsTowardTotals,
  outstandingEffectiveStatus,
  outstandingRemaining,
  totalCashBalances,
  totalsByType,
} from "../../accounting/engine";
import {
  TX_TYPE_LABELS,
  type FinTxType,
} from "../../accounting/types";
import { useAccAccounts, useAccDocsMeta, useAccOutstanding, useAccParties, useAccTransactions } from "../../accounting/hooks";
import { DonutChart, GroupedBarsChart, TrendChart } from "../../accounting/components/Charts";
import { InformationalBadge, SignedAmount, TxStatusPill, TxTypePill } from "../../accounting/components/Bits";

type PeriodKey = "today" | "week" | "month" | "year" | "all" | "custom";

function periodRange(key: PeriodKey, from: string | null, to: string | null): { from: string; to: string } {
  const today = todayIso();
  const d = new Date(`${today}T00:00:00`);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const day = (d.getDay() + 1) % 7; // Saturday start
      const start = new Date(d);
      start.setDate(d.getDate() - day);
      return { from: start.toISOString().slice(0, 10), to: today };
    }
    case "month": {
      const start = new Date(d);
      start.setDate(1);
      return { from: start.toISOString().slice(0, 10), to: today };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return { from: from ?? "0000-01-01", to: to ?? "9999-12-31" };
    case "all":
    default:
      return { from: "0000-01-01", to: "9999-12-31" };
  }
}

const TX_COLORS: Record<string, string> = {
  receipt: "#10b981",
  payment: "#ef4444",
  withdrawal: "#f59e0b",
  transfer: "#3b82f6",
  exchange: "#635BFF",
  adjustment: "#94a3b8",
  opening: "#8b5cf6",
};

export function AccDashboardPage() {
  const navigate = useNavigate();
  const parties = useAccParties();
  const accounts = useAccAccounts();
  const transactions = useAccTransactions();
  const outstanding = useAccOutstanding();
  const docs = useAccDocsMeta();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [currencyFilter, setCurrencyFilter] = useState<"all" | Currency>("all");

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const inRange = useMemo(
    () =>
      (transactions ?? []).filter(
        (t) => t.date >= range.from && t.date <= range.to &&
          (currencyFilter === "all" || t.currency === currencyFilter),
      ),
    [transactions, range, currencyFilter],
  );

  const balances = useMemo(
    () => (accounts && transactions ? computeAllAccountBalances(accounts, transactions) : null),
    [accounts, transactions],
  );

  const cashTotals = useMemo(
    () => (accounts && transactions ? totalCashBalances(accounts, transactions) : null),
    [accounts, transactions],
  );

  const typeTotals = useMemo(() => totalsByType(inRange), [inRange]);

  // Reversed transactions and their counter-entries are corrections, not
  // real business activity — they don't count toward period stats.
  const effectiveInRange = useMemo(
    () => inRange.filter(countsTowardTotals),
    [inRange],
  );

  const sumOf = (type: FinTxType, cur: Currency) =>
    typeTotals.totals[type]?.[cur] ?? 0;

  const monthlyBuckets = useMemo(() => {
    const buckets = groupByPeriod(
      (transactions ?? []).filter((t) => currencyFilter === "all" || t.currency === currencyFilter),
      "month",
      (iso) => formatJalali(iso, "medium"),
    );
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    // Always render the trailing 6 months (zero-filled) so the trend line
    // never collapses into an empty state with a single month of data.
    const trailing: typeof buckets = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      trailing.push(
        byKey.get(key) ?? {
          key,
          label: formatJalali(key, "medium"),
          receipts: { USD: 0, IRT: 0, AFN: 0 },
          payments: { USD: 0, IRT: 0, AFN: 0 },
          withdrawals: { USD: 0, IRT: 0, AFN: 0 },
          count: 0,
        },
      );
    }
    return trailing;
  }, [transactions, currencyFilter]);

  const outstandingOpen = useMemo(
    () => (outstanding ?? []).filter(
      (o) => o.status !== "cancelled" && o.status !== "settled" && outstandingRemaining(o) > 0,
    ),
    [outstanding],
  );
  const receivables = outstandingOpen.filter((o) => o.kind === "receivable");
  const payables = outstandingOpen.filter((o) => o.kind === "payable");
  const sumOutstanding = (items: typeof receivables, cur: Currency) =>
    fromMinor(
      items
        .filter((o) => o.currency === cur)
        .reduce((s, o) => s + toMinor(outstandingRemaining(o), cur), 0),
      cur,
    );

  const recent = useMemo(() => (transactions ?? []).slice(0, 8), [transactions]);
  const partyName = (id?: string | null) =>
    (parties ?? []).find((p) => p.id === id)?.name ?? "—";
  const accountName = (id?: string | null) =>
    (accounts ?? []).find((a) => a.id === id)?.name ?? "";

  const volumePoints = monthlyBuckets.map((b) => b.count);

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-3xl p-3.5">
        <div className="min-w-[280px] flex-1">
          <RadioSelect
            options={[
              { value: "today", label: "امروز" },
              { value: "week", label: "این هفته" },
              { value: "month", label: "این ماه" },
              { value: "year", label: "امسال" },
              { value: "all", label: "همه" },
              { value: "custom", label: "دلخواه" },
            ]}
            value={period}
            onChange={(v) => setPeriod(v as PeriodKey)}
          />
        </div>
        <div className="min-w-[150px]">
          <RadioSelect
            options={[
              { value: "all", label: "همه ارزها" },
              { value: "IRT", label: "تومان" },
              { value: "USD", label: "دلار" },
              { value: "AFN", label: "افغانی" },
            ]}
            value={currencyFilter}
            onChange={(v) => setCurrencyFilter(v as "all" | Currency)}
          />
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <JalaliDatePicker value={customFrom} onChange={setCustomFrom} placeholder="از تاریخ" />
            <JalaliDatePicker value={customTo} onChange={setCustomTo} placeholder="تا تاریخ" />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="موجودی کل صندوق‌ها و بانک"
          value={
            cashTotals ? (
              <span className="flex flex-col leading-6">
                <span>{formatMoney(cashTotals.IRT, "IRT")}</span>
                <span className="text-[13px] text-ink-500 dark:text-ink-400">
                  {formatMoney(cashTotals.USD, "USD")}
                </span>
                {cashTotals.AFN !== 0 && (
                  <span className="text-[13px] text-ink-500 dark:text-ink-400">
                    {formatMoney(cashTotals.AFN, "AFN")}
                  </span>
                )}
              </span>
            ) : "…"
          }
          tone="brand"
          hint={accounts ? `${accounts.filter((a) => a.active).length} حساب فعال` : undefined}
        />
        <StatCard
          icon={ArrowDownLeft}
          label={`دریافت‌ها (${period === "all" ? "همه" : "دوره"})`}
          value={
            <span className="flex flex-col leading-6">
              <span className="text-[#0b9e6e] dark:text-[#3ddc9a]">{formatMoney(sumOf("receipt", "IRT"), "IRT")}</span>
              <span className="text-[13px] text-[#0b9e6e] dark:text-[#3ddc9a]">{formatMoney(sumOf("receipt", "USD"), "USD")}</span>
              {sumOf("receipt", "AFN") !== 0 && <span className="text-[13px] text-[#0b9e6e] dark:text-[#3ddc9a]">{formatMoney(sumOf("receipt", "AFN"), "AFN")}</span>}
            </span>
          }
          tone="success"
        />
        <StatCard
          icon={ArrowUpRight}
          label="پرداخت‌ها (دوره)"
          value={
            <span className="flex flex-col leading-6">
              <span className="text-[#dc3535] dark:text-[#f87b7b]">{formatMoney(sumOf("payment", "IRT"), "IRT")}</span>
              <span className="text-[13px] text-[#dc3535] dark:text-[#f87b7b]">{formatMoney(sumOf("payment", "USD"), "USD")}</span>
              {sumOf("payment", "AFN") !== 0 && <span className="text-[13px] text-[#dc3535] dark:text-[#f87b7b]">{formatMoney(sumOf("payment", "AFN"), "AFN")}</span>}
            </span>
          }
          tone="danger"
        />
        <StatCard
          icon={Banknote}
          label="برداشت‌ها (دوره)"
          value={
            <span className="flex flex-col leading-6">
              <span>{formatMoney(sumOf("withdrawal", "IRT"), "IRT")}</span>
              <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOf("withdrawal", "USD"), "USD")}</span>
              {sumOf("withdrawal", "AFN") !== 0 && <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOf("withdrawal", "AFN"), "AFN")}</span>}
            </span>
          }
          tone="warning"
        />
        <StatCard
          icon={Scale}
          label="مطالبات باز (طلب ما)"
          value={
            <span className="flex flex-col leading-6">
              <span>{formatMoney(sumOutstanding(receivables, "IRT"), "IRT")}</span>
              <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOutstanding(receivables, "USD"), "USD")}</span>
              {sumOutstanding(receivables, "AFN") !== 0 && <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOutstanding(receivables, "AFN"), "AFN")}</span>}
            </span>
          }
          hint={`${receivables.length} قلم باز`}
          tone="info"
        />
        <StatCard
          icon={Scale}
          label="بدهی‌های باز (طلب طرف حساب)"
          value={
            <span className="flex flex-col leading-6">
              <span>{formatMoney(sumOutstanding(payables, "IRT"), "IRT")}</span>
              <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOutstanding(payables, "USD"), "USD")}</span>
              {sumOutstanding(payables, "AFN") !== 0 && <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(sumOutstanding(payables, "AFN"), "AFN")}</span>}
            </span>
          }
          hint={`${payables.length} قلم باز`}
          tone="warning"
        />
        <StatCard
          icon={Users}
          label="طرف حساب‌ها"
          value={parties ? `${parties.filter((p) => p.active).length.toLocaleString("fa-IR")} فعال / ${parties.length.toLocaleString("fa-IR")} کل` : "…"}
          tone="neutral"
          hint={parties ? `${parties.filter((p) => p.type === "company").length.toLocaleString("fa-IR")} شرکت` : undefined}
        />
        <StatCard
          icon={Receipt}
          label="تراکنش‌های دوره"
          value={effectiveInRange.length.toLocaleString("fa-IR")}
          hint={docs ? `${docs.length.toLocaleString("fa-IR")} سند بایگانی شده` : undefined}
          tone="brand"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={`دریافت در برابر پرداخت — ${currencyFilter === "all" ? "تومان" : CURRENCY_LABELS[currencyFilter as Currency]}`} icon={<TrendingUp size={16} className="text-brand-500" />}>
          <GroupedBarsChart
            groups={monthlyBuckets.map((b) => {
              const cur = currencyFilter === "all" ? "IRT" : (currencyFilter as Currency);
              const scale = cur === "USD" ? 100 : 1;
              return {
                label: b.label,
                in: (cur === "USD" ? b.receipts.USD : cur === "IRT" ? b.receipts.IRT : b.receipts.AFN) / scale,
                out: (cur === "USD" ? b.payments.USD : cur === "IRT" ? b.payments.IRT : b.payments.AFN) / scale,
              };
            })}
            currency={currencyFilter === "all" ? "IRT" : (currencyFilter as Currency)}
          />
        </SectionCard>
        <SectionCard title="توزیع انواع تراکنش (دوره)" icon={<Receipt size={16} className="text-brand-500" />}>
          <DonutChart
            slices={(Object.keys(TX_TYPE_LABELS) as FinTxType[])
              .map((t) => ({
                label: TX_TYPE_LABELS[t],
                value: typeTotals.count[t] ?? 0,
                color: TX_COLORS[t],
              }))
              .filter((s) => s.value > 0)}
            centerLabel="کل تراکنش"
            centerValue={effectiveInRange.length.toLocaleString("fa-IR")}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="روند تعداد تراکنش (ماهانه)"
        icon={<TrendingUp size={16} className="text-brand-500" />}
      >
        <TrendChart points={volumePoints} />
        <div className="mt-1 flex justify-between text-[10px] text-ink-400">
          {monthlyBuckets.map((b) => (
            <span key={b.key}>{b.label}</span>
          ))}
        </div>
      </SectionCard>

      {/* Recent activity */}
      <SectionCard
        title="آخرین تراکنش‌ها"
        icon={<Receipt size={16} className="text-brand-500" />}
        action={
          <Button size="sm" variant="glass" onClick={() => navigate("/accounting/transactions")}>
            همه تراکنش‌ها
          </Button>
        }
      >
        {!transactions ? (
          <ListSkeleton rows={4} />
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm font-bold">هنوز تراکنشی ثبت نشده است</p>
            <p className="max-w-sm text-xs leading-6 text-ink-500 dark:text-ink-400">
              اولین صندوق یا حساب بانکی را بسازید و دریافت/پرداخت‌هایتان را ثبت کنید. همه ارقام داشبورد از همین داده‌های واقعی محاسبه می‌شوند.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={Plus} onClick={() => navigate("/accounting/accounts")}>
                ساخت صندوق/بانک
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recent.map((tx) => (
              <button
                key={tx.id}
                className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white/40 px-3.5 py-2.5 text-right transition-colors hover:bg-brand-500/8 dark:bg-white/[0.04]"
                onClick={() => navigate("/accounting/transactions")}
              >
                <span className="num shrink-0 text-[11px] font-bold text-ink-400">{tx.number}</span>
                <TxTypePill type={tx.type} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {tx.partyId ? partyName(tx.partyId) : tx.description || "—"}
                </span>
                <span className="shrink-0">
                  <SignedAmount
                    amount={tx.amount}
                    currency={tx.currency}
                    direction={
                      tx.status !== "final"
                        ? "flat"
                        : tx.type === "receipt" || tx.type === "opening"
                          ? "in"
                          : tx.type === "payment" || tx.type === "withdrawal"
                            ? "out"
                            : "flat"
                    }
                  />
                </span>
                {!tx.affectsBalance && <InformationalBadge />}
                <TxStatusPill status={tx.status} />
                <span className="num shrink-0 text-[11px] text-ink-400">{formatJalali(tx.date)}</span>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Account balances overview */}
      {accounts && accounts.length > 0 && (
        <SectionCard title="مانده حساب‌ها" icon={<Wallet size={16} className="text-brand-500" />}>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/accounting/accounts/${a.id}`)}
                className="glass-soft flex flex-col gap-1 rounded-2xl p-3 text-right transition-transform active:scale-95"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink-500 dark:text-ink-400">
                  {currencyLabel(a.currency)} · {a.active ? "" : "غیرفعال"}
                </span>
                <span className="truncate text-xs font-bold">{a.name}</span>
                <span className="num text-[15px] font-extrabold">
                  {formatMoney(balances?.get(a.id)?.balance ?? 0, a.currency)}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Overdue alerts */}
      {outstanding &&
        outstanding.filter((o) => outstandingEffectiveStatus(o, todayIso()) === "overdue").length > 0 && (
          <SectionCard title="هشدار سررسید گذشته" icon={<Scale size={16} className="text-[#ef4444]" />}>
            <div className="flex flex-col gap-1.5">
              {outstanding
                .filter((o) => outstandingEffectiveStatus(o, todayIso()) === "overdue")
                .slice(0, 5)
                .map((o) => (
                  <button
                    key={o.id}
                    className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/8 px-3.5 py-2.5 text-right text-xs"
                    onClick={() => navigate("/accounting/outstanding")}
                  >
                    <span className="font-bold">{partyName(o.partyId)}</span>
                    <span className="num text-ink-500 dark:text-ink-400">
                      {formatMoney(outstandingRemaining(o), o.currency)}
                    </span>
                    <span className="num text-[#dc3535] dark:text-[#f87b7b]">
                      سررسید: {formatJalali(o.dueDate)}
                    </span>
                  </button>
                ))}
            </div>
          </SectionCard>
        )}

      <div className="flex items-center gap-2 text-[11px] leading-5 text-ink-400">
        <FileText size={13} />
        همه ارقام این داشبورد مستقیماً از تراکنش‌های ثبت‌شده محاسبه می‌شوند؛ ارزها هرگز با هم جمع نمی‌شوند.
      </div>
    </div>
  );
}
