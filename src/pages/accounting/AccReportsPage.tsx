/**
 * Accounting reports — 20 kinds across five organized groups, all computed
 * from real stored data with the same business rules as the engine. Every
 * report exports to XLSX / CSV / PDF / PNG through the shared export dialog,
 * rendered with the accounting (emerald) document theme.
 */

import { useMemo, useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  FileBarChart,
  FileDown,
  FileText,
  PieChart,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SectionCard, FilterSelect, SearchSelect } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { ExportDialog } from "../../components/exports/ExportDialog";
import type {
  ExportColumn,
  PartySummaryData,
  SummarySection,
} from "../../utils/export/tabular";
import { formatJalali, todayIso, toPersianDigits } from "../../utils/jalali";
import { formatMoney, fromMinor, sumAmounts } from "../../utils/num";
import {
  buildStatementRows,
  computeAllAccountBalances,
  countsTowardTotals,
  groupByPeriod,
  outstandingEffectiveStatus,
  outstandingRemaining,
  totalCashBalances,
  totalsByType,
  txEffects,
} from "../../accounting/engine";
import {
  ACCOUNT_TYPE_LABELS,
  OUTSTANDING_KIND_LABELS,
  OUTSTANDING_STATUS_LABELS,
  PARTY_TYPE_LABELS,
  TX_TYPE_LABELS,
  type FinTxType,
} from "../../accounting/types";
import {
  useAccAccounts,
  useAccDocsMeta,
  useAccOutstanding,
  useAccParties,
  useAccTransactions,
} from "../../accounting/hooks";
import { useActivities } from "../../hooks/useData";
import type { OutstandingItem, FinTransaction } from "../../accounting/types";
import type { Currency } from "../../types";

/* ------------------------------ report kinds ------------------------------ */

type ReportKind =
  | "overall"
  | "receipts"
  | "payments"
  | "withdrawals"
  | "category"
  | "partyStatement"
  | "accountStatement"
  | "accountFlow"
  | "cashBalances"
  | "partyBalances"
  | "receivables"
  | "payables"
  | "outstandingDue"
  | "aging"
  | "netPosition"
  | "topParties"
  | "currencySummary"
  | "periodic"
  | "docs"
  | "audit";

interface KindDef {
  value: ReportKind;
  label: string;
}

const REPORT_GROUPS: {
  key: string;
  title: string;
  icon: LucideIcon;
  tone: string;
  kinds: KindDef[];
}[] = [
  {
    key: "tx",
    title: "تراکنش‌ها",
    icon: ArrowLeftRight,
    tone: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
    kinds: [
      { value: "overall", label: "کل تراکنش‌ها" },
      { value: "receipts", label: "دریافت‌ها" },
      { value: "payments", label: "پرداخت‌ها" },
      { value: "withdrawals", label: "برداشت‌ها" },
      { value: "category", label: "تفکیک دسته‌ای" },
    ],
  },
  {
    key: "stmt",
    title: "صورتحساب‌ها",
    icon: FileText,
    tone: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
    kinds: [
      { value: "partyStatement", label: "صورتحساب طرف حساب" },
      { value: "accountStatement", label: "صورتحساب صندوق / بانک" },
      { value: "accountFlow", label: "جریان حساب‌ها در بازه" },
    ],
  },
  {
    key: "bal",
    title: "مانده‌ها",
    icon: Scale,
    tone: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
    kinds: [
      { value: "cashBalances", label: "مانده صندوق‌ها و بانک‌ها" },
      { value: "partyBalances", label: "مانده طرف حساب‌ها" },
      { value: "receivables", label: "مطالبات" },
      { value: "payables", label: "بدهی‌ها" },
      { value: "outstandingDue", label: "باز و سررسیدگذشته" },
    ],
  },
  {
    key: "ana",
    title: "تحلیل‌ها",
    icon: PieChart,
    tone: "bg-[#8b5cf6]/12 text-[#7c3aed] dark:text-[#b79bf8]",
    kinds: [
      { value: "netPosition", label: "وضعیت مالی کلی" },
      { value: "topParties", label: "طرف حساب‌های برتر" },
      { value: "aging", label: "تحلیل سنی مانده‌ها" },
      { value: "currencySummary", label: "خلاصه ارزی" },
      { value: "periodic", label: "خلاصه دوره‌ای" },
    ],
  },
  {
    key: "rec",
    title: "بایگانی و حسابرسی",
    icon: Archive,
    tone: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
    kinds: [
      { value: "docs", label: "بایگانی اسناد" },
      { value: "audit", label: "گزارش حسابرسی" },
    ],
  },
];

const ALL_KINDS = REPORT_GROUPS.flatMap((g) => g.kinds);
const KIND_LABEL = Object.fromEntries(ALL_KINDS.map((k) => [k.value, k.label])) as Record<
  ReportKind,
  string
>;

const KIND_HINTS: Partial<Record<ReportKind, string>> = {
  overall: "همه تراکنش‌ها با تمام جزئیات؛ وضعیت هر رکورد (قطعی / برگشت / ابطال) در خروجی رنگی نمایش داده می‌شود.",
  receipts: "فقط دریافت‌ها — پول‌هایی که به صندوق/بانک وارد شده‌اند، با میانگین و بزرگ‌ترین تراکنش.",
  payments: "فقط پرداخت‌ها — پول‌هایی که از صندوق/بانک خارج شده‌اند، با میانگین و بزرگ‌ترین تراکنش.",
  withdrawals: "فقط برداشت‌ها — خروجی‌های شخصی/غیرمرتبط با طرف حساب، با میانگین و بزرگ‌ترین تراکنش.",
  category: "حجم فعالیت بر اساس دسته (ویزا، خدمات، کمیسیون…) با سهم درصدی هر دسته از کل.",
  partyStatement: "گردش حساب یک طرف حساب با مانده گردشی پس از هر تراکنش؛ ابتدا طرف حساب را انتخاب کنید.",
  accountStatement: "گردش یک صندوق/حساب بانکی با واریز، برداشت و مانده پس از هر جنبش؛ ابتدا حساب را انتخاب کنید.",
  accountFlow: "برای هر حساب: مانده ابتدای بازه + ورودی‌ها − خروجی‌های همان بازه = مانده انتهای بازه. دقیقاً مثل دفتر حسابدار.",
  cashBalances: "مانده فعلی همه صندوق‌ها و حساب‌های بانکی — مشتق‌شده از تراکنش‌های قطعی، نه ذخیره‌شده.",
  partyBalances: "وضعیت هر طرف حساب: دریافت/پرداخت در بازه + مانده پایانی به تاریخ پایان بازه. علامت مثبت یعنی دریافت‌ها بیشتر بوده.",
  receivables: "طلب‌های ما از طرف حساب‌ها (تسویه‌نشده) با درصد تسویه و روزهای تأخیر.",
  payables: "طلب طرف حساب‌ها از ما (تسویه‌نشده) با درصد تسویه و روزهای تأخیر.",
  outstandingDue: "فقط موارد بازی که سررسیدشان گذشته — پرریسک‌ترین قسمت بایگانی مالی.",
  netPosition: "تصویر big-picture: نقد و بانک + مطالبات باز − بدهی‌های باز = خالص وضعیت. بر اساس تاریخ امروز.",
  topParties: "بزرگ‌ترین طرف حساب‌ها بر اساس حجم تعامل (دریافت + پرداخت)، جدا برای تومان و دلار.",
  aging: "مانده‌های باز در سطل‌های سنی (۰-۳۰ / ۳۱-۶۰ / ۶۱-۹۰ / +۹۰ روز) — قدیمی‌ترین مطالبات اول.",
  currencySummary: "جمع دریافت/پرداخت/برداشت/انتقال/مانده اولیه/تعدیل به تفکیک ارز + خالص دریافت−پرداخت.",
  periodic: "دوره‌بندی روزانه/هفتگی/ماهانه/سالانه با دریافت، پرداخت، برداشت و خالص هر دوره.",
  docs: "همه اسناد بارگذاری‌شده در بایگانی حسابداری با دسته، حجم و تاریخ.",
  audit: "رویدادهای ثبت‌شده حسابرسی — چه کسی، چه زمانی، چه چیزی را تغییر داده.",
};

/* ------------------------------ period presets ---------------------------- */

type PresetKey = "all" | "today" | "week" | "month" | "year" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "همه دوره‌ها" },
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "year", label: "امسال" },
];

/* ------------------------------ small helpers ----------------------------- */

type AnyRow = Record<string, string | number>;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const faPct = (n: number) => `${n.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`;
const faInt = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const curLabel = (c: "IRT" | "USD") => (c === "USD" ? "دلار" : "تومان");

/** Aging bucket of an open outstanding item (most overdue first in display). */
function ageBucketOf(o: OutstandingItem, today: string): string {
  if (!o.dueDate) return "بدون سررسید";
  const diff = dayDiff(o.dueDate, today);
  if (diff < 0) return "سررسید نشده";
  if (diff <= 30) return "۰ تا ۳۰ روز";
  if (diff <= 60) return "۳۱ تا ۶۰ روز";
  if (diff <= 90) return "۶۱ تا ۹۰ روز";
  return "بیش از ۹۰ روز";
}
const BUCKET_ORDER = [
  "بیش از ۹۰ روز",
  "۶۱ تا ۹۰ روز",
  "۳۱ تا ۶۰ روز",
  "۰ تا ۳۰ روز",
  "سررسید نشده",
  "بدون سررسید",
];

/* ----------------------- grouped summary construction ---------------------- */

/** Plain Persian number (no unit — the section badge carries the currency). */
const faNum = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const curTag = (c: Currency) => (c === "USD" ? "دلار" : "تومان");

/** Both currencies in one cell, each with its unit written ONCE:
 *  «۱۲٬۰۰۰٬۰۰۰ تومان + ۸۰۰ دلار» — or «—» when both are zero. */
const moneyPair = (irt: number, usd: number): string => {
  const parts: string[] = [];
  if (irt) parts.push(formatMoney(irt, "IRT"));
  if (usd) parts.push(formatMoney(usd, "USD"));
  return parts.length > 0 ? parts.join(" + ") : "—";
};

/** Per-party breakdown («جمع‌بندی به تفکیک طرف حساب») for transaction reports.
 *  Built only when the filtered rows cover MORE than one party — a single
 *  party is already named in the footer chips. Money cells join both
 *  currencies; rows sort by total volume, and the bold «جمع کل» row is the
 *  جمع‌بندی کلی. */
function buildTxPartySummary(
  list: FinTransaction[],
  kind: ReportKind,
  partyName: (id?: string | null) => string,
): PartySummaryData | undefined {
  const cols = ["طرف حساب", "تعداد"];
  const showRec = kind === "overall" || kind === "receipts";
  const showPay = kind === "overall" || kind === "payments";
  const showWd = kind === "overall" || kind === "withdrawals";
  if (showRec) cols.push("دریافت");
  if (showPay) cols.push("پرداخت");
  if (showWd) cols.push("برداشت");

  type Agg = {
    count: number;
    rec: Record<Currency, number>;
    pay: Record<Currency, number>;
    wd: Record<Currency, number>;
  };
  const map = new Map<string, Agg>();
  for (const t of list) {
    const key = t.partyId ? partyName(t.partyId) : "بدون طرف حساب";
    const agg =
      map.get(key) ??
      { count: 0, rec: { IRT: 0, USD: 0 }, pay: { IRT: 0, USD: 0 }, wd: { IRT: 0, USD: 0 } };
    agg.count++;
    if (countsTowardTotals(t)) {
      if (t.type === "receipt") agg.rec[t.currency] += t.amount;
      else if (t.type === "payment") agg.pay[t.currency] += t.amount;
      else if (t.type === "withdrawal") agg.wd[t.currency] += t.amount;
    }
    map.set(key, agg);
  }
  if (map.size < 2) return undefined;
  const vol = (a: Agg) => a.rec.IRT + a.rec.USD + a.pay.IRT + a.pay.USD + a.wd.IRT + a.wd.USD;
  const rows = [...map.entries()]
    .sort((a, b) => vol(b[1]) - vol(a[1]))
    .map(([name, a]) => {
      const cells = [name, a.count.toLocaleString("fa-IR")];
      if (showRec) cells.push(moneyPair(a.rec.IRT, a.rec.USD));
      if (showPay) cells.push(moneyPair(a.pay.IRT, a.pay.USD));
      if (showWd) cells.push(moneyPair(a.wd.IRT, a.wd.USD));
      return cells;
    });
  const tot = [...map.values()].reduce(
    (acc, a) => {
      acc.count += a.count;
      acc.rec.IRT += a.rec.IRT;
      acc.rec.USD += a.rec.USD;
      acc.pay.IRT += a.pay.IRT;
      acc.pay.USD += a.pay.USD;
      acc.wd.IRT += a.wd.IRT;
      acc.wd.USD += a.wd.USD;
      return acc;
    },
    { count: 0, rec: { IRT: 0, USD: 0 }, pay: { IRT: 0, USD: 0 }, wd: { IRT: 0, USD: 0 } },
  );
  const totalRow = ["جمع کل", tot.count.toLocaleString("fa-IR")];
  if (showRec) totalRow.push(moneyPair(tot.rec.IRT, tot.rec.USD));
  if (showPay) totalRow.push(moneyPair(tot.pay.IRT, tot.pay.USD));
  if (showWd) totalRow.push(moneyPair(tot.wd.IRT, tot.wd.USD));
  return { title: "جمع‌بندی به تفکیک طرف حساب", columns: cols, rows, totalRow };
}

/** Per-party breakdown for outstanding reports (مطالبات / بدهی‌ها / سررسید). */
function buildOutstandingPartySummary(
  list: OutstandingItem[],
  partyName: (id?: string | null) => string,
): PartySummaryData | undefined {
  type Agg = { count: number; amount: Record<Currency, number>; remaining: Record<Currency, number> };
  const map = new Map<string, Agg>();
  for (const o of list) {
    const key = partyName(o.partyId);
    const agg =
      map.get(key) ?? { count: 0, amount: { IRT: 0, USD: 0 }, remaining: { IRT: 0, USD: 0 } };
    agg.count++;
    agg.amount[o.currency] += o.amount;
    agg.remaining[o.currency] += outstandingRemaining(o);
    map.set(key, agg);
  }
  if (map.size < 2) return undefined;
  const rows = [...map.entries()]
    .sort(
      (a, b) =>
        b[1].remaining.IRT + b[1].remaining.USD - (a[1].remaining.IRT + a[1].remaining.USD),
    )
    .map(([name, a]) => [
      name,
      a.count.toLocaleString("fa-IR"),
      moneyPair(a.amount.IRT, a.amount.USD),
      moneyPair(a.amount.IRT - a.remaining.IRT, a.amount.USD - a.remaining.USD),
      moneyPair(a.remaining.IRT, a.remaining.USD),
    ]);
  const tot = [...map.values()].reduce(
    (acc, a) => {
      acc.count += a.count;
      acc.amount.IRT += a.amount.IRT;
      acc.amount.USD += a.amount.USD;
      acc.remaining.IRT += a.remaining.IRT;
      acc.remaining.USD += a.remaining.USD;
      return acc;
    },
    { count: 0, amount: { IRT: 0, USD: 0 }, remaining: { IRT: 0, USD: 0 } },
  );
  return {
    title: "جمع‌بندی به تفکیک طرف حساب",
    columns: ["طرف حساب", "تعداد", "مبلغ کل", "تسویه شده", "مانده"],
    rows,
    totalRow: [
      "جمع کل",
      tot.count.toLocaleString("fa-IR"),
      moneyPair(tot.amount.IRT, tot.amount.USD),
      moneyPair(tot.amount.IRT - tot.remaining.IRT, tot.amount.USD - tot.remaining.USD),
      moneyPair(tot.remaining.IRT, tot.remaining.USD),
    ],
  };
}

/* --------------------------- preview styling rules ------------------------ */

const MONEY_PREVIEW_KEYS = new Set([
  "amount",
  "quoted",
  "paid",
  "balance",
  "total",
  "issued",
  "deposit",
  "withdraw",
  "running",
  "settled",
  "remaining",
  "receipts",
  "payments",
  "withdrawals",
  "transfers",
  "openings",
  "adjustments",
  "inflow",
  "outflow",
  "opening",
  "closing",
  "volume",
  "net",
  "netIRT",
  "netUSD",
  "avg",
  "largest",
  "cash",
  "value",
  "irt",
  "usd",
]);

const STATUS_PREVIEW_KEYS = new Set(["status", "state", "active", "delay"]);

const PILL_TONES: Record<string, string> = {
  green: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
  amber: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
  red: "bg-[#ef4444]/12 text-[#dc3535] dark:text-[#f87b7b]",
  blue: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
  gray: "bg-ink-500/10 text-ink-500 dark:text-ink-400",
};

function pillToneFor(v: string): string | null {
  const t = v.trim();
  if (!t || t.length > 22) return null;
  if (t.includes("صادر")) return PILL_TONES.green;
  if (t.includes("در حال")) return PILL_TONES.amber;
  if (t.includes("رد ") || t.includes("لغو")) return PILL_TONES.red;
  if (t.startsWith("قطعی")) return t.includes("فقط ثبت") ? PILL_TONES.amber : PILL_TONES.green;
  if (t.includes("برگشت خورده")) return PILL_TONES.amber;
  if (t.includes("ابطال")) return PILL_TONES.gray;
  if (t.includes("سررسید گذشته")) return PILL_TONES.red;
  if (t === "باز" || t.startsWith("باز ")) return PILL_TONES.blue;
  if (t.includes("پرداخت جزئی")) return PILL_TONES.amber;
  if (t.includes("تسویه شده")) return PILL_TONES.green;
  if (t === "فعال") return PILL_TONES.green;
  if (t === "غیرفعال") return PILL_TONES.gray;
  return null;
}

/* -------------------------------- component ------------------------------- */

export function AccReportsPage() {
  const transactions = useAccTransactions();
  const parties = useAccParties();
  const accounts = useAccAccounts();
  const outstanding = useAccOutstanding();
  const docs = useAccDocsMeta();
  const activities = useActivities(300);

  const [kind, setKind] = useState<ReportKind>("overall");
  const [preset, setPreset] = useState<PresetKey>("all");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [currency, setCurrency] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"day" | "week" | "month" | "year">("month");
  const [exportOpen, setExportOpen] = useState(false);

  const partyName = (id?: string | null) => (parties ?? []).find((p) => p.id === id)?.name ?? "—";
  const accountName = (id?: string | null) => (accounts ?? []).find((a) => a.id === id)?.name ?? "—";

  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    if (k === "all") {
      setFrom(null);
      setTo(null);
      return;
    }
    const today = todayIso();
    const d = new Date(`${today}T00:00:00`);
    if (k === "today") {
      setFrom(today);
      setTo(today);
    } else if (k === "week") {
      const day = (d.getDay() + 1) % 7; // Saturday start
      d.setDate(d.getDate() - day);
      setFrom(d.toISOString().slice(0, 10));
      setTo(today);
    } else if (k === "month") {
      d.setDate(1);
      setFrom(d.toISOString().slice(0, 10));
      setTo(today);
    } else if (k === "year") {
      setFrom(`${today.slice(0, 4)}-01-01`);
      setTo(today);
    }
  };

  const baseTx = useMemo(() => {
    let list = transactions ?? [];
    if (from) list = list.filter((t) => t.date >= from);
    if (to) list = list.filter((t) => t.date <= to);
    if (currency !== "all") list = list.filter((t) => t.currency === currency);
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    return list;
  }, [transactions, from, to, currency, statusFilter]);

  const report = useMemo((): {
    title: string;
    columns: ExportColumn[];
    rows: AnyRow[];
    /** Currency-grouped summary — badge carries the unit, labels stay clean. */
    sections: SummarySection[];
    /** Per-party breakdown + جمع کل — built when >1 party is covered. */
    partySummary?: PartySummaryData;
  } => {
    if (!transactions || !parties || !accounts || !outstanding) {
      return { title: "", columns: [], rows: [], sections: [] };
    }
    const today = todayIso();
    const showIRT = currency !== "USD";
    const showUSD = currency !== "IRT";
    const dueInRange = (o: OutstandingItem) =>
      !from && !to ? true : !!o.dueDate && (!from || o.dueDate >= from) && (!to || o.dueDate <= to);

    switch (kind) {
      /* ------------------------ transaction reports ------------------------ */
      case "overall":
      case "receipts":
      case "payments":
      case "withdrawals": {
        const typeFilter: FinTxType | null =
          kind === "receipts" ? "receipt" : kind === "payments" ? "payment" : kind === "withdrawals" ? "withdrawal" : null;
        const list = typeFilter ? baseTx.filter((t) => t.type === typeFilter) : baseTx;
        const cols: ExportColumn[] = [
          { key: "date", header: "تاریخ" },
          { key: "number", header: "شماره" },
          { key: "type", header: "نوع" },
          { key: "party", header: "طرف حساب" },
          { key: "amount", header: "مبلغ" },
          { key: "currency", header: "ارز" },
          { key: "fromAccount", header: "از حساب" },
          { key: "toAccount", header: "به حساب" },
          { key: "status", header: "وضعیت" },
          { key: "category", header: "دسته" },
          { key: "description", header: "شرح" },
        ];
        const rows: AnyRow[] = list.map((t) => ({
          date: formatJalali(t.date),
          number: t.number,
          type: TX_TYPE_LABELS[t.type],
          party: t.partyId ? partyName(t.partyId) : "",
          amount: t.amount.toLocaleString("fa-IR"),
          currency: t.currency === "USD" ? "دلار" : "تومان",
          fromAccount: t.sourceAccountId ? accountName(t.sourceAccountId) : "",
          toAccount: t.destAccountId ? accountName(t.destAccountId) : "",
          status: t.status === "final" ? (t.affectsBalance ? "قطعی" : "قطعی — فقط ثبت") : t.status === "reversed" ? "برگشت خورده" : "ابطال شده",
          category: t.category ?? "",
          description: t.description ?? "",
        }));
        const totals = totalsByType(list);
        const perCur = (c: "IRT" | "USD") => list.filter((t) => t.currency === c);
        const avgOf = (c: "IRT" | "USD") => {
          const sub = perCur(c);
          return sub.length ? sumAmounts(sub.map((t) => t.amount), c) / sub.length : 0;
        };
        const maxOf = (c: "IRT" | "USD") => perCur(c).reduce((m, t) => Math.max(m, t.amount), 0);
        // One clean section per ACTIVE currency — the badge carries the unit,
        // so labels never repeat «دلار/تومان» and zero metrics are dropped.
        const sections: SummarySection[] = [];
        for (const c of ["IRT", "USD"] as const) {
          const sub = perCur(c);
          if (sub.length === 0) continue;
          const items: { label: string; value: string }[] = [
            { label: "تعداد", value: sub.length.toLocaleString("fa-IR") },
          ];
          if (kind === "overall") {
            const rec = totals.totals.receipt?.[c] ?? 0;
            const pay = totals.totals.payment?.[c] ?? 0;
            const wd = totals.totals.withdrawal?.[c] ?? 0;
            if (rec > 0) items.push({ label: "دریافت", value: faNum(rec) });
            if (pay > 0) items.push({ label: "پرداخت", value: faNum(pay) });
            if (wd > 0) items.push({ label: "برداشت", value: faNum(wd) });
          } else {
            const t = typeFilter!;
            items.push({ label: "جمع", value: faNum(totals.totals[t]?.[c] ?? 0) });
          }
          items.push({ label: "میانگین", value: faNum(Math.round(avgOf(c))) });
          items.push({ label: "بزرگ‌ترین", value: faNum(maxOf(c)) });
          sections.push({ tag: curTag(c), items });
        }
        return {
          title: KIND_LABEL[kind],
          columns: cols,
          rows,
          sections,
          partySummary: buildTxPartySummary(list, kind, partyName),
        };
      }

      /* --------------------------- statements ----------------------------- */
      case "partyStatement": {
        if (!partyId) return { title: KIND_LABEL[kind], columns: [], rows: [], sections: [] };
        const { rows: sRows, closing } = buildStatementRows(partyId, transactions);
        const list = from || to ? sRows.filter((r) => (!from || r.tx.date >= from) && (!to || r.tx.date <= to)) : sRows;
        return {
          title: `صورتحساب ${partyName(partyId)}`,
          columns: [
            { key: "date", header: "تاریخ" },
            { key: "number", header: "شماره" },
            { key: "type", header: "نوع" },
            { key: "description", header: "شرح" },
            { key: "deposit", header: "بستانکار (دریافت)" },
            { key: "withdraw", header: "بدهکار (پرداخت)" },
            { key: "running", header: "مانده گردشی" },
          ],
          rows: list.map((r) => ({
            date: formatJalali(r.tx.date),
            number: r.tx.number,
            type: TX_TYPE_LABELS[r.tx.type],
            description: r.tx.description ?? "",
            deposit: r.signedMinor > 0 ? `${r.tx.amount.toLocaleString("fa-IR")} ${r.tx.currency === "USD" ? "دلار" : "تومان"}` : "",
            withdraw: r.signedMinor < 0 ? `${r.tx.amount.toLocaleString("fa-IR")} ${r.tx.currency === "USD" ? "دلار" : "تومان"}` : "",
            running: `${formatMoney(r.running.IRT, "IRT")} | ${formatMoney(r.running.USD, "USD")}`,
          })),
          sections: [
            { items: [{ label: "تعداد تراکنش", value: list.length.toLocaleString("fa-IR") }] },
            ...(closing.IRT !== 0
              ? [{ tag: "تومان", items: [{ label: "مانده پایانی", value: faNum(closing.IRT) }] }]
              : []),
            ...(closing.USD !== 0
              ? [{ tag: "دلار", items: [{ label: "مانده پایانی", value: faNum(closing.USD) }] }]
              : []),
          ],
        };
      }

      case "accountStatement":
      case "cashBalances": {
        const balances = computeAllAccountBalances(accounts, transactions);
        if (kind === "cashBalances") {
          const accs = accounts.filter((a) => currency === "all" || a.currency === currency);
          return {
            title: "مانده صندوق‌ها و حساب‌های بانکی",
            columns: [
              { key: "name", header: "حساب" },
              { key: "type", header: "نوع" },
              { key: "currency", header: "ارز" },
              { key: "balance", header: "مانده فعلی" },
              { key: "txCount", header: "تعداد جنبش" },
              { key: "active", header: "وضعیت" },
            ],
            rows: accs.map((a) => ({
              name: a.name,
              type: ACCOUNT_TYPE_LABELS[a.type],
              currency: a.currency === "USD" ? "دلار" : "تومان",
              balance: (balances.get(a.id)?.balance ?? 0).toLocaleString("fa-IR"),
              txCount: (balances.get(a.id)?.txCount ?? 0).toLocaleString("fa-IR"),
              active: a.active ? "فعال" : "غیرفعال",
            })),
            sections: [
              {
                items: [
                  { label: "تعداد حساب", value: accs.length.toLocaleString("fa-IR") },
                  { label: "حساب‌های فعال", value: accs.filter((a) => a.active).length.toLocaleString("fa-IR") },
                ],
              },
              ...(accs.filter((a) => a.currency === "IRT").some((a) => (balances.get(a.id)?.balance ?? 0) !== 0)
                ? [
                    {
                      tag: "تومان",
                      items: [
                        {
                          label: "جمع مانده",
                          value: faNum(
                            accs
                              .filter((a) => a.currency === "IRT")
                              .reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0),
                          ),
                        },
                      ],
                    },
                  ]
                : []),
              ...(accs.filter((a) => a.currency === "USD").some((a) => (balances.get(a.id)?.balance ?? 0) !== 0)
                ? [
                    {
                      tag: "دلار",
                      items: [
                        {
                          label: "جمع مانده",
                          value: faNum(
                            accs
                              .filter((a) => a.currency === "USD")
                              .reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0),
                          ),
                        },
                      ],
                    },
                  ]
                : []),
            ],
          };
        }
        if (!accountId) return { title: KIND_LABEL[kind], columns: [], rows: [], sections: [] };
        const account = accounts.find((a) => a.id === accountId)!;
        const relevant = transactions
          .filter((t) => [t.sourceAccountId, t.destAccountId].includes(account.id))
          .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
          .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
        let running = 0;
        const rows: AnyRow[] = [];
        for (const t of relevant) {
          const isDest = t.destAccountId === account.id;
          const effect = t.status === "final" && t.affectsBalance ? (isDest ? t.amount : -t.amount) : 0;
          running += effect;
          rows.push({
            date: formatJalali(t.date),
            number: t.number,
            type: TX_TYPE_LABELS[t.type],
            description: t.description ?? "",
            deposit: effect > 0 ? t.amount.toLocaleString("fa-IR") : "",
            withdraw: effect < 0 ? t.amount.toLocaleString("fa-IR") : "",
            running: running.toLocaleString("fa-IR"),
          });
        }
        return {
          title: `صورتحساب ${account.name}`,
          columns: [
            { key: "date", header: "تاریخ" },
            { key: "number", header: "شماره" },
            { key: "type", header: "نوع" },
            { key: "description", header: "شرح" },
            { key: "deposit", header: "واریز" },
            { key: "withdraw", header: "برداشت" },
            { key: "running", header: "مانده" },
          ],
          rows,
          sections: [
            { items: [{ label: "تعداد جنبش", value: relevant.length.toLocaleString("fa-IR") }] },
            {
              tag: curTag(account.currency),
              items: [
                { label: "مانده فعلی", value: faNum(balances.get(account.id)?.balance ?? 0) },
              ],
            },
          ],
        };
      }

      case "accountFlow": {
        const accs = [...accounts]
          .filter((a) => currency === "all" || a.currency === currency)
          .sort((a, b) => a.name.localeCompare(b.name, "fa"));
        const before = from ? transactions.filter((t) => t.date < from) : [];
        const openingBal = computeAllAccountBalances(accounts, before);
        const inRange = transactions.filter(
          (t) => t.date >= (from ?? "0000-01-01") && t.date <= (to ?? "9999-12-31"),
        );
        const rows: AnyRow[] = [];
        const sumInMinor: Record<"IRT" | "USD", number> = { IRT: 0, USD: 0 };
        const sumOutMinor: Record<"IRT" | "USD", number> = { IRT: 0, USD: 0 };
        for (const a of accs) {
          let inMinor = 0;
          let outMinor = 0;
          let moves = 0;
          for (const t of inRange) {
            if (t.status === "cancelled" || !t.affectsBalance) continue;
            for (const e of txEffects(t)) {
              if (e.accountId !== a.id) continue;
              moves++;
              if (e.minor > 0) inMinor += e.minor;
              else outMinor += -e.minor;
            }
          }
          sumInMinor[a.currency] += inMinor;
          sumOutMinor[a.currency] += outMinor;
          const open = openingBal.get(a.id)?.balance ?? 0;
          const inflow = fromMinor(inMinor, a.currency);
          const outflow = fromMinor(outMinor, a.currency);
          const closing = open + inflow - outflow;
          rows.push({
            name: a.name,
            type: ACCOUNT_TYPE_LABELS[a.type],
            currency: a.currency === "USD" ? "دلار" : "تومان",
            opening: open.toLocaleString("fa-IR"),
            inflow: inflow.toLocaleString("fa-IR"),
            outflow: outflow.toLocaleString("fa-IR"),
            closing: closing.toLocaleString("fa-IR"),
            moves: moves.toLocaleString("fa-IR"),
          });
        }
        return {
          title: "جریان حساب‌ها در بازه",
          columns: [
            { key: "name", header: "حساب" },
            { key: "type", header: "نوع" },
            { key: "currency", header: "ارز" },
            { key: "opening", header: "مانده ابتدای بازه" },
            { key: "inflow", header: "ورودی بازه" },
            { key: "outflow", header: "خروجی بازه" },
            { key: "closing", header: "مانده انتهای بازه" },
            { key: "moves", header: "جنبش‌ها" },
          ],
          rows,
          sections: [
            {
              items: [
                {
                  label: "بازه",
                  value: from ? `از ${formatJalali(from)}` : "از ابتدا",
                },
              ],
            },
            ...(sumInMinor.IRT !== 0 || sumOutMinor.IRT !== 0
              ? [
                  {
                    tag: "تومان",
                    items: [
                      ...(fromMinor(sumInMinor.IRT, "IRT") !== 0
                        ? [{ label: "جمع ورودی", value: faNum(fromMinor(sumInMinor.IRT, "IRT")) }]
                        : []),
                      ...(fromMinor(sumOutMinor.IRT, "IRT") !== 0
                        ? [{ label: "جمع خروجی", value: faNum(fromMinor(sumOutMinor.IRT, "IRT")) }]
                        : []),
                    ],
                  },
                ]
              : []),
            ...(sumInMinor.USD !== 0 || sumOutMinor.USD !== 0
              ? [
                  {
                    tag: "دلار",
                    items: [
                      ...(fromMinor(sumInMinor.USD, "USD") !== 0
                        ? [{ label: "جمع ورودی", value: faNum(fromMinor(sumInMinor.USD, "USD")) }]
                        : []),
                      ...(fromMinor(sumOutMinor.USD, "USD") !== 0
                        ? [{ label: "جمع خروجی", value: faNum(fromMinor(sumOutMinor.USD, "USD")) }]
                        : []),
                    ],
                  },
                ]
              : []),
          ],
        };
      }

      /* ---------------------------- balances ------------------------------ */
      case "receivables":
      case "payables":
      case "outstandingDue": {
        const wantKind = kind === "receivables" ? "receivable" : kind === "payables" ? "payable" : null;
        let list = outstanding.filter((o) => o.status !== "cancelled");
        if (wantKind) list = list.filter((o) => o.kind === wantKind);
        if (kind === "outstandingDue") list = list.filter((o) => outstandingEffectiveStatus(o, today) === "overdue");
        else list = list.filter(dueInRange);
        if (currency !== "all") list = list.filter((o) => o.currency === currency);
        const rows: AnyRow[] = list.map((o) => {
          const eff = outstandingEffectiveStatus(o, today);
          const remaining = outstandingRemaining(o);
          const settled = o.amount - remaining;
          const progress = o.amount > 0 ? Math.round((settled / o.amount) * 100) : 0;
          let delay = "—";
          if (o.dueDate) {
            const diff = dayDiff(o.dueDate, today);
            delay =
              diff >= 0
                ? `${toPersianDigits(diff)} روز تأخیر`
                : `${toPersianDigits(-diff)} روز مانده`;
          }
          return {
            party: partyName(o.partyId),
            kind: OUTSTANDING_KIND_LABELS[o.kind],
            amount: o.amount.toLocaleString("fa-IR"),
            settled: settled.toLocaleString("fa-IR"),
            remaining: remaining.toLocaleString("fa-IR"),
            progress: faPct(progress),
            currency: o.currency === "USD" ? "دلار" : "تومان",
            due: o.dueDate ? formatJalali(o.dueDate) : "بدون سررسید",
            delay,
            status: OUTSTANDING_STATUS_LABELS[eff],
            description: o.description ?? "",
          };
        });
        const overdueCount = list.filter((o) => outstandingEffectiveStatus(o, today) === "overdue").length;
        const remIRT = list.filter((o) => o.currency === "IRT").reduce((s, o) => s + outstandingRemaining(o), 0);
        const remUSD = list.filter((o) => o.currency === "USD").reduce((s, o) => s + outstandingRemaining(o), 0);
        return {
          title: KIND_LABEL[kind],
          columns: [
            { key: "party", header: "طرف حساب" },
            { key: "kind", header: "نوع" },
            { key: "amount", header: "مبلغ کل" },
            { key: "settled", header: "تسویه شده" },
            { key: "remaining", header: "مانده" },
            { key: "progress", header: "درصد تسویه" },
            { key: "currency", header: "ارز" },
            { key: "due", header: "سررسید" },
            { key: "delay", header: "وضعیت سررسید" },
            { key: "status", header: "وضعیت" },
            { key: "description", header: "شرح" },
          ],
          rows,
          sections: [
            {
              items: [
                { label: "تعداد", value: list.length.toLocaleString("fa-IR") },
                { label: "سررسید گذشته", value: overdueCount.toLocaleString("fa-IR") },
              ],
            },
            ...(remIRT !== 0 ? [{ tag: "تومان", items: [{ label: "جمع مانده", value: faNum(remIRT) }] }] : []),
            ...(remUSD !== 0 ? [{ tag: "دلار", items: [{ label: "جمع مانده", value: faNum(remUSD) }] }] : []),
          ],
          partySummary: buildOutstandingPartySummary(list, partyName),
        };
      }

      case "partyBalances": {
        const uptoTo = to ? transactions.filter((t) => t.date <= to) : transactions;
        type PRow = {
          id: string;
          name: string;
          type: string;
          count: number;
          recIRT: number;
          payIRT: number;
          closeIRT: number;
          recUSD: number;
          payUSD: number;
          closeUSD: number;
          last: string;
        };
        const prow: PRow[] = [];
        for (const p of parties) {
          const st = buildStatementRows(p.id, uptoTo);
          if (st.rows.length === 0) continue;
          const inRange = st.rows.filter(
            (r) => (!from || r.tx.date >= from) && (!to || r.tx.date <= to),
          );
          const rec = (c: "IRT" | "USD") =>
            sumAmounts(
              inRange.filter((r) => r.signedMinor > 0 && r.tx.currency === c).map((r) => r.tx.amount),
              c,
            );
          const pay = (c: "IRT" | "USD") =>
            sumAmounts(
              inRange.filter((r) => r.signedMinor < 0 && r.tx.currency === c).map((r) => r.tx.amount),
              c,
            );
          prow.push({
            id: p.id,
            name: p.name,
            type: PARTY_TYPE_LABELS[p.type],
            count: st.rows.length,
            recIRT: rec("IRT"),
            payIRT: pay("IRT"),
            closeIRT: st.closing.IRT,
            recUSD: rec("USD"),
            payUSD: pay("USD"),
            closeUSD: st.closing.USD,
            last: st.rows.length ? formatJalali(st.rows[st.rows.length - 1].tx.date) : "—",
          });
        }
        prow.sort(
          (a, b) =>
            Math.abs(b.closeIRT) - Math.abs(a.closeIRT) || Math.abs(b.closeUSD) - Math.abs(a.closeUSD),
        );
        const cols: ExportColumn[] = [{ key: "party", header: "طرف حساب" }, { key: "type", header: "نوع" }, { key: "count", header: "تعداد تراکنش" }];
        if (showIRT)
          cols.push(
            { key: "recIRT", header: "دریافت در بازه (تومان)" },
            { key: "payIRT", header: "پرداخت در بازه (تومان)" },
            { key: "closeIRT", header: "مانده پایانی (تومان)" },
          );
        if (showUSD)
          cols.push(
            { key: "recUSD", header: "دریافت در بازه (دلار)" },
            { key: "payUSD", header: "پرداخت در بازه (دلار)" },
            { key: "closeUSD", header: "مانده پایانی (دلار)" },
          );
        cols.push({ key: "last", header: "آخرین فعالیت" });
        const rows: AnyRow[] = prow.map((p) => {
          const r: AnyRow = { party: p.name, type: p.type, count: p.count.toLocaleString("fa-IR") };
          if (showIRT) {
            r.recIRT = p.recIRT.toLocaleString("fa-IR");
            r.payIRT = p.payIRT.toLocaleString("fa-IR");
            r.closeIRT = p.closeIRT.toLocaleString("fa-IR");
          }
          if (showUSD) {
            r.recUSD = p.recUSD.toLocaleString("fa-IR");
            r.payUSD = p.payUSD.toLocaleString("fa-IR");
            r.closeUSD = p.closeUSD.toLocaleString("fa-IR");
          }
          r.last = p.last;
          return r;
        });
        const zeroCount = prow.filter((p) => p.closeIRT === 0 && p.closeUSD === 0).length;
        const posCount = prow.filter((p) => p.closeIRT > 0 || p.closeUSD > 0).length;
        return {
          title: "مانده طرف حساب‌ها",
          columns: cols,
          rows,
          sections: [
            {
              items: [
                { label: "طرف حساب‌های فعال", value: prow.length.toLocaleString("fa-IR") },
                { label: "مانده صفر", value: zeroCount.toLocaleString("fa-IR") },
                { label: "دریافت بیشتر از پرداخت", value: posCount.toLocaleString("fa-IR") },
              ],
            },
            ...(prow.some((p) => p.closeIRT !== 0)
              ? [{ tag: "تومان", items: [{ label: "جمع مانده", value: faNum(prow.reduce((s, p) => s + p.closeIRT, 0)) }] }]
              : []),
            ...(prow.some((p) => p.closeUSD !== 0)
              ? [{ tag: "دلار", items: [{ label: "جمع مانده", value: faNum(prow.reduce((s, p) => s + p.closeUSD, 0)) }] }]
              : []),
          ],
        };
      }

      /* ----------------------------- analysis ----------------------------- */
      case "netPosition": {
        const cash = totalCashBalances(accounts, transactions);
        const open = outstanding.filter(
          (o) => o.status !== "cancelled" && outstandingRemaining(o) > 0,
        );
        const sumKind = (k: "receivable" | "payable", c: "IRT" | "USD") =>
          sumAmounts(
            open.filter((o) => o.kind === k && o.currency === c).map((o) => outstandingRemaining(o)),
            c,
          );
        const rec = { IRT: sumKind("receivable", "IRT"), USD: sumKind("receivable", "USD") };
        const pay = { IRT: sumKind("payable", "IRT"), USD: sumKind("payable", "USD") };
        const net = {
          IRT: cash.IRT + rec.IRT - pay.IRT,
          USD: cash.USD + rec.USD - pay.USD,
        };
        const cols: ExportColumn[] = [{ key: "component", header: "مؤلفه" }, { key: "note", header: "توضیح" }];
        if (showIRT) cols.push({ key: "irt", header: "تومان" });
        if (showUSD) cols.push({ key: "usd", header: "دلار" });
        const mk = (component: string, note: string, v: { IRT: number; USD: number }): AnyRow => {
          const r: AnyRow = { component, note };
          if (showIRT) r.irt = v.IRT.toLocaleString("fa-IR");
          if (showUSD) r.usd = v.USD.toLocaleString("fa-IR");
          return r;
        };
        const rows: AnyRow[] = [
          mk("نقد و بانک", "مانده فعلی همه صندوق‌ها و حساب‌های فعال", cash),
          mk("مطالبات باز", "طلب ما از طرف حساب‌ها (تسویه‌نشده)", rec),
          mk("بدهی‌های باز", "طلب طرف حساب‌ها از ما (تسویه‌نشده)", pay),
          mk("خالص وضعیت", "نقد + مطالبات − بدهی‌ها", net),
        ];
        const netSection = (c: "IRT" | "USD"): SummarySection => ({
          tag: curTag(c),
          items: [
            { label: "نقد و بانک", value: faNum(cash[c]) },
            { label: "مطالبات باز", value: faNum(rec[c]) },
            { label: "بدهی باز", value: faNum(pay[c]) },
            { label: "خالص وضعیت", value: faNum(net[c]) },
          ],
        });
        return {
          title: "وضعیت مالی کلی",
          columns: cols,
          rows,
          sections: [
            ...(showIRT && (cash.IRT !== 0 || rec.IRT !== 0 || pay.IRT !== 0) ? [netSection("IRT")] : []),
            ...(showUSD && (cash.USD !== 0 || rec.USD !== 0 || pay.USD !== 0) ? [netSection("USD")] : []),
          ],
        };
      }

      case "topParties": {
        const pool = transactions.filter(
          (t) => countsTowardTotals(t) && t.partyId && (t.type === "receipt" || t.type === "payment"),
        );
        const currencies: ("IRT" | "USD")[] = currency === "all" ? ["IRT", "USD"] : [currency === "IRT" ? "IRT" : "USD"];
        type TRow = { party: string; count: number; receipts: number; payments: number; volume: number; cur: "IRT" | "USD" };
        const trows: TRow[] = [];
        for (const c of currencies) {
          const byParty = new Map<string, { count: number; rec: number[]; pay: number[] }>();
          for (const t of pool) {
            if (t.currency !== c || !t.partyId) continue;
            const b = byParty.get(t.partyId) ?? { count: 0, rec: [], pay: [] };
            b.count++;
            if (t.type === "receipt") b.rec.push(t.amount);
            else b.pay.push(t.amount);
            byParty.set(t.partyId, b);
          }
          const ranked = [...byParty.entries()]
            .map(([id, b]) => ({
              party: partyName(id),
              count: b.count,
              receipts: sumAmounts(b.rec, c),
              payments: sumAmounts(b.pay, c),
              volume: sumAmounts([...b.rec, ...b.pay], c),
              cur: c,
            }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10);
          trows.push(...ranked);
        }
        const best = (c: "IRT" | "USD") => trows.filter((r) => r.cur === c)[0];
        return {
          title: "طرف حساب‌های برتر",
          columns: [
            { key: "rank", header: "رتبه" },
            { key: "party", header: "طرف حساب" },
            { key: "count", header: "تعداد تراکنش" },
            { key: "receipts", header: "دریافت" },
            { key: "payments", header: "پرداخت" },
            { key: "volume", header: "حجم تعامل" },
            { key: "currency", header: "ارز" },
          ],
          rows: trows.map((r, i) => ({
            rank: toPersianDigits(i + 1),
            party: r.party,
            count: r.count.toLocaleString("fa-IR"),
            receipts: r.receipts.toLocaleString("fa-IR"),
            payments: r.payments.toLocaleString("fa-IR"),
            volume: r.volume.toLocaleString("fa-IR"),
            currency: curLabel(r.cur),
          })),
          sections: [
            {
              items: [
                {
                  label: "طرف حساب‌های دارای تعامل",
                  value: new Set(pool.map((t) => t.partyId!)).size.toLocaleString("fa-IR"),
                },
              ],
            },
            ...(best("IRT")
              ? [
                  {
                    tag: "تومان",
                    items: [
                      { label: "بزرگ‌ترین", value: `${best("IRT")!.party} — ${faNum(best("IRT")!.volume)}` },
                    ],
                  },
                ]
              : []),
            ...(best("USD")
              ? [
                  {
                    tag: "دلار",
                    items: [
                      { label: "بزرگ‌ترین", value: `${best("USD")!.party} — ${faNum(best("USD")!.volume)}` },
                    ],
                  },
                ]
              : []),
          ],
        };
      }

      case "aging": {
        const open = outstanding
          .filter((o) => o.status !== "cancelled" && outstandingRemaining(o) > 0)
          .filter((o) => currency === "all" || o.currency === currency)
          .filter(dueInRange);
        const totalOf = (k: "receivable" | "payable", c: "IRT" | "USD") =>
          sumAmounts(
            open.filter((o) => o.kind === k && o.currency === c).map((o) => outstandingRemaining(o)),
            c,
          );
        const cells = new Map<string, { count: number; amounts: number[] }>();
        for (const o of open) {
          const bucket = ageBucketOf(o, today);
          const key = `${o.kind}|${bucket}|${o.currency}`;
          const cell = cells.get(key) ?? { count: 0, amounts: [] };
          cell.count++;
          cell.amounts.push(outstandingRemaining(o));
          cells.set(key, cell);
        }
        const rows: AnyRow[] = [];
        for (const kindDir of ["receivable", "payable"] as const) {
          for (const bucket of BUCKET_ORDER) {
            for (const c of ["IRT", "USD"] as const) {
              if (currency !== "all" && c !== (currency === "IRT" ? "IRT" : "USD")) continue;
              const cell = cells.get(`${kindDir}|${bucket}|${c}`);
              if (!cell) continue;
              const total = totalOf(kindDir, c);
              const sum = sumAmounts(cell.amounts, c);
              rows.push({
                bucket,
                kind: OUTSTANDING_KIND_LABELS[kindDir],
                currency: curLabel(c),
                count: cell.count.toLocaleString("fa-IR"),
                remaining: sum.toLocaleString("fa-IR"),
                share: total > 0 ? faPct(Math.round((sum / total) * 1000) / 10) : "—",
              });
            }
          }
        }
        const overdueCount = open.filter((o) => o.dueDate && dayDiff(o.dueDate, today) >= 0).length;
        return {
          title: "تحلیل سنی مانده‌ها",
          columns: [
            { key: "bucket", header: "سطل سنی" },
            { key: "kind", header: "نوع" },
            { key: "currency", header: "ارز" },
            { key: "count", header: "تعداد" },
            { key: "remaining", header: "جمع مانده" },
            { key: "share", header: "سهم از مانده باز" },
          ],
          rows,
          sections: [
            {
              items: [
                { label: "موارد باز", value: open.length.toLocaleString("fa-IR") },
                { label: "سررسید گذشته", value: overdueCount.toLocaleString("fa-IR") },
              ],
            },
            ...(totalOf("receivable", "IRT") !== 0 || totalOf("payable", "IRT") !== 0
              ? [
                  {
                    tag: "تومان",
                    items: [
                      ...(totalOf("receivable", "IRT") !== 0
                        ? [{ label: "مطالبات باز", value: faNum(totalOf("receivable", "IRT")) }]
                        : []),
                      ...(totalOf("payable", "IRT") !== 0
                        ? [{ label: "بدهی باز", value: faNum(totalOf("payable", "IRT")) }]
                        : []),
                    ],
                  },
                ]
              : []),
            ...(totalOf("receivable", "USD") !== 0 || totalOf("payable", "USD") !== 0
              ? [
                  {
                    tag: "دلار",
                    items: [
                      ...(totalOf("receivable", "USD") !== 0
                        ? [{ label: "مطالبات باز", value: faNum(totalOf("receivable", "USD")) }]
                        : []),
                      ...(totalOf("payable", "USD") !== 0
                        ? [{ label: "بدهی باز", value: faNum(totalOf("payable", "USD")) }]
                        : []),
                    ],
                  },
                ]
              : []),
          ],
        };
      }

      case "category": {
        type CatAgg = {
          count: number;
          rec: Record<"IRT" | "USD", number[]>;
          pay: Record<"IRT" | "USD", number[]>;
          wd: Record<"IRT" | "USD", number[]>;
        };
        const map = new Map<string, CatAgg>();
        for (const t of baseTx) {
          const key = t.category?.trim() || "بدون دسته";
          const agg = map.get(key) ?? {
            count: 0,
            rec: { IRT: [], USD: [] },
            pay: { IRT: [], USD: [] },
            wd: { IRT: [], USD: [] },
          };
          agg.count++;
          if (t.type === "receipt") agg.rec[t.currency].push(t.amount);
          else if (t.type === "payment") agg.pay[t.currency].push(t.amount);
          else if (t.type === "withdrawal") agg.wd[t.currency].push(t.amount);
          map.set(key, agg);
        }
        const catList = [...map.entries()]
          .map(([name, a]) => ({
            name,
            count: a.count,
            rIRT: sumAmounts(a.rec.IRT, "IRT"),
            rUSD: sumAmounts(a.rec.USD, "USD"),
            pIRT: sumAmounts(a.pay.IRT, "IRT"),
            pUSD: sumAmounts(a.pay.USD, "USD"),
            wIRT: sumAmounts(a.wd.IRT, "IRT"),
            wUSD: sumAmounts(a.wd.USD, "USD"),
          }))
          .map((x) => ({ ...x, volIRT: x.rIRT + x.pIRT + x.wIRT, volUSD: x.rUSD + x.pUSD + x.wUSD }))
          .sort((a, b) => b.volIRT - a.volIRT || b.volUSD - a.volUSD);
        const totalIRT = catList.reduce((s, x) => s + x.volIRT, 0);
        const totalUSD = catList.reduce((s, x) => s + x.volUSD, 0);
        const cols: ExportColumn[] = [{ key: "category", header: "دسته" }, { key: "count", header: "تعداد" }];
        if (showIRT)
          cols.push(
            { key: "recIRT", header: "دریافت (تومان)" },
            { key: "payIRT", header: "پرداخت (تومان)" },
            { key: "wIRT", header: "برداشت (تومان)" },
            { key: "shareIRT", header: "سهم (تومان)" },
          );
        if (showUSD)
          cols.push(
            { key: "recUSD", header: "دریافت (دلار)" },
            { key: "payUSD", header: "پرداخت (دلار)" },
            { key: "wUSD", header: "برداشت (دلار)" },
            { key: "shareUSD", header: "سهم (دلار)" },
          );
        const rows: AnyRow[] = catList.map((x) => {
          const r: AnyRow = {
            category: x.name,
            count: x.count.toLocaleString("fa-IR"),
          };
          if (showIRT) {
            r.recIRT = x.rIRT.toLocaleString("fa-IR");
            r.payIRT = x.pIRT.toLocaleString("fa-IR");
            r.wIRT = x.wIRT.toLocaleString("fa-IR");
            r.shareIRT = totalIRT > 0 ? faPct(Math.round((x.volIRT / totalIRT) * 1000) / 10) : "—";
          }
          if (showUSD) {
            r.recUSD = x.rUSD.toLocaleString("fa-IR");
            r.payUSD = x.pUSD.toLocaleString("fa-IR");
            r.wUSD = x.wUSD.toLocaleString("fa-IR");
            r.shareUSD = totalUSD > 0 ? faPct(Math.round((x.volUSD / totalUSD) * 1000) / 10) : "—";
          }
          return r;
        });
        const top = catList[0];
        return {
          title: "تفکیک دسته‌ای تراکنش‌ها",
          columns: cols,
          rows,
          sections: [
            { items: [{ label: "تعداد دسته‌ها", value: catList.length.toLocaleString("fa-IR") }] },
            ...(totalIRT !== 0
              ? [
                  {
                    tag: "تومان",
                    items: [
                      ...(top && top.volIRT > 0
                        ? [{ label: "پرحجم‌ترین دسته", value: `${top.name} — ${faNum(top.volIRT)}` }]
                        : []),
                      { label: "جمع حجم", value: faNum(totalIRT) },
                    ],
                  },
                ]
              : []),
            ...(totalUSD !== 0
              ? [
                  {
                    tag: "دلار",
                    items: [
                      ...(top && top.volUSD > 0
                        ? [{ label: "پرحجم‌ترین دسته", value: `${top.name} — ${faNum(top.volUSD)}` }]
                        : []),
                      { label: "جمع حجم", value: faNum(totalUSD) },
                    ],
                  },
                ]
              : []),
          ],
        };
      }

      case "currencySummary": {
        const totals = totalsByType(baseTx);
        const rows: AnyRow[] = [];
        for (const c of ["IRT", "USD"] as const) {
          if (currency !== "all" && c !== (currency === "IRT" ? "IRT" : "USD")) continue;
          const rec = totals.totals.receipt?.[c] ?? 0;
          const pay = totals.totals.payment?.[c] ?? 0;
          rows.push({
            currency: curLabel(c),
            count: baseTx.filter((t) => t.currency === c).length.toLocaleString("fa-IR"),
            receipts: rec.toLocaleString("fa-IR"),
            payments: pay.toLocaleString("fa-IR"),
            net: (rec - pay).toLocaleString("fa-IR"),
            withdrawals: (totals.totals.withdrawal?.[c] ?? 0).toLocaleString("fa-IR"),
            transfers: (totals.totals.transfer?.[c] ?? 0).toLocaleString("fa-IR"),
            openings: (totals.totals.opening?.[c] ?? 0).toLocaleString("fa-IR"),
            adjustments: (totals.totals.adjustment?.[c] ?? 0).toLocaleString("fa-IR"),
          });
        }
        const netOf = (c: "IRT" | "USD") =>
          (totals.totals.receipt?.[c] ?? 0) - (totals.totals.payment?.[c] ?? 0);
        const sections: SummarySection[] = [];
        for (const c of ["IRT", "USD"] as const) {
          if (currency !== "all" && c !== (currency === "IRT" ? "IRT" : "USD")) continue;
          const sub = baseTx.filter((t) => t.currency === c);
          if (sub.length === 0) continue;
          const items: { label: string; value: string }[] = [
            { label: "تعداد", value: sub.length.toLocaleString("fa-IR") },
          ];
          const rec = totals.totals.receipt?.[c] ?? 0;
          const pay = totals.totals.payment?.[c] ?? 0;
          const wd = totals.totals.withdrawal?.[c] ?? 0;
          if (rec !== 0) items.push({ label: "دریافت", value: faNum(rec) });
          if (pay !== 0) items.push({ label: "پرداخت", value: faNum(pay) });
          if (wd !== 0) items.push({ label: "برداشت", value: faNum(wd) });
          items.push({ label: "خالص (دریافت − پرداخت)", value: faNum(netOf(c)) });
          sections.push({ tag: curTag(c), items });
        }
        return {
          title: "خلاصه ارزی تراکنش‌ها",
          columns: [
            { key: "currency", header: "ارز" },
            { key: "count", header: "تعداد" },
            { key: "receipts", header: "دریافت" },
            { key: "payments", header: "پرداخت" },
            { key: "net", header: "خالص (دریافت − پرداخت)" },
            { key: "withdrawals", header: "برداشت" },
            { key: "transfers", header: "انتقال" },
            { key: "openings", header: "مانده اولیه" },
            { key: "adjustments", header: "تعدیل" },
          ],
          rows,
          sections,
        };
      }

      case "periodic": {
        const buckets = groupByPeriod(baseTx, granularity, (iso, g) => {
          if (g === "year") return formatJalali(iso).slice(0, 4);
          if (g === "month") return formatJalali(iso, "medium");
          return formatJalali(iso);
        });
        const rows: AnyRow[] = buckets.map((b) => ({
          period: b.label,
          count: b.count.toLocaleString("fa-IR"),
          receiptsIRT: b.receipts.IRT.toLocaleString("fa-IR"),
          paymentsIRT: b.payments.IRT.toLocaleString("fa-IR"),
          withdrawalsIRT: b.withdrawals.IRT.toLocaleString("fa-IR"),
          netIRT: (b.receipts.IRT - b.payments.IRT).toLocaleString("fa-IR"),
          receiptsUSD: fromMinor(b.receipts.USD, "USD").toLocaleString("fa-IR"),
          paymentsUSD: fromMinor(b.payments.USD, "USD").toLocaleString("fa-IR"),
          withdrawalsUSD: fromMinor(b.withdrawals.USD, "USD").toLocaleString("fa-IR"),
          netUSD: fromMinor(b.receipts.USD - b.payments.USD, "USD").toLocaleString("fa-IR"),
        }));
        return {
          title: `خلاصه ${granularity === "day" ? "روزانه" : granularity === "week" ? "هفتگی" : granularity === "month" ? "ماهانه" : "سالانه"}`,
          columns: [
            { key: "period", header: "دوره" },
            { key: "count", header: "تعداد تراکنش" },
            { key: "receiptsIRT", header: "دریافت (تومان)" },
            { key: "paymentsIRT", header: "پرداخت (تومان)" },
            { key: "withdrawalsIRT", header: "برداشت (تومان)" },
            { key: "netIRT", header: "خالص (تومان)" },
            { key: "receiptsUSD", header: "دریافت (دلار)" },
            { key: "paymentsUSD", header: "پرداخت (دلار)" },
            { key: "withdrawalsUSD", header: "برداشت (دلار)" },
            { key: "netUSD", header: "خالص (دلار)" },
          ],
          rows,
          sections: [
            { items: [{ label: "تعداد دوره‌ها", value: buckets.length.toLocaleString("fa-IR") }] },
            ...(buckets.some((b) => b.receipts.IRT !== 0)
              ? [
                  {
                    tag: "تومان",
                    items: [
                      { label: "جمع دریافت", value: faNum(buckets.reduce((s, b) => s + b.receipts.IRT, 0)) },
                    ],
                  },
                ]
              : []),
            ...(buckets.some((b) => b.receipts.USD !== 0)
              ? [
                  {
                    tag: "دلار",
                    items: [
                      {
                        label: "جمع دریافت",
                        value: faNum(buckets.reduce((s, b) => s + fromMinor(b.receipts.USD, "USD"), 0)),
                      },
                    ],
                  },
                ]
              : []),
          ],
        };
      }

      case "docs": {
        const list = (docs ?? []).filter(
          (d) =>
            (!from || new Date(d.createdAt).toISOString().slice(0, 10) >= from) &&
            (!to || new Date(d.createdAt).toISOString().slice(0, 10) <= to),
        );
        const totalSize = list.reduce((s, d) => s + d.size, 0);
        return {
          title: "بایگاری اسناد حسابداری",
          columns: [
            { key: "name", header: "نام فایل" },
            { key: "category", header: "دسته" },
            { key: "party", header: "طرف حساب" },
            { key: "size", header: "حجم (KB)" },
            { key: "date", header: "تاریخ بارگذاری" },
          ],
          rows: list.map((d) => ({
            name: d.name,
            category: d.category ?? "سند",
            party: d.partyId ? partyName(d.partyId) : "",
            size: Math.round(d.size / 1024).toLocaleString("fa-IR"),
            date: formatJalali(new Date(d.createdAt).toISOString().slice(0, 10)),
          })),
          sections: [
            {
              items: [
                { label: "تعداد اسناد", value: list.length.toLocaleString("fa-IR") },
                {
                  label: "حجم کل",
                  value: `${(totalSize / 1048576).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`,
                },
              ],
            },
          ],
        };
      }

      case "audit": {
        const list = (activities ?? []).filter((a) => a.entity.startsWith("acc"));
        const lastTs = list.length ? Math.max(...list.map((a) => a.ts)) : 0;
        return {
          title: "گزارش حسابرسی حسابداری",
          columns: [
            { key: "time", header: "زمان" },
            { key: "action", header: "عملیات" },
            { key: "title", header: "عنوان" },
            { key: "detail", header: "جزئیات" },
          ],
          rows: list.map((a) => ({
            time: new Date(a.ts).toLocaleString("fa-IR"),
            action: a.type,
            title: a.title,
            detail: a.detail ?? "",
          })),
          sections: [
            {
              items: [
                { label: "تعداد رویداد", value: list.length.toLocaleString("fa-IR") },
                { label: "آخرین رویداد", value: lastTs ? new Date(lastTs).toLocaleString("fa-IR") : "—" },
              ],
            },
          ],
        };
      }

      default:
        return { title: "", columns: [], rows: [], sections: [] };
    }
  }, [kind, baseTx, partyId, accountId, from, to, currency, granularity, transactions, parties, accounts, outstanding, docs, activities]);

  /* --------------------------- kind-dependent flags -------------------------- */

  const needsParty = kind === "partyStatement";
  const needsAccount = kind === "accountStatement";
  const usesStatusFilter = [
    "overall",
    "receipts",
    "payments",
    "withdrawals",
    "category",
    "currencySummary",
    "periodic",
  ].includes(kind);

  /* ------------------------------ subtitle line ----------------------------- */

  const subtitleLine = useMemo(() => {
    const presetLabel = PRESETS.find((p) => p.key === preset)?.label;
    const range =
      presetLabel && preset !== "all" && preset !== "custom"
        ? presetLabel
        : from || to
          ? `${from ? formatJalali(from) : "ابتدا"} تا ${to ? formatJalali(to) : "امروز"}`
          : "همه دوره‌ها";
    const cur = currency === "all" ? "تومان و دلار" : currency === "IRT" ? "تومان" : "دلار";
    const extra =
      kind === "netPosition"
        ? " • وضعیت به تاریخ امروز"
        : needsParty && partyId
          ? ` • ${partyName(partyId)}`
          : needsAccount && accountId
            ? ` • ${accountName(accountId)}`
            : "";
    return `${range} • ${cur}${extra}`;
  }, [preset, from, to, currency, kind, partyId, accountId, needsParty, needsAccount]);

  /* ------------------------------ preview table ----------------------------- */

  const previewColumns: Column<AnyRow>[] = report.columns.slice(0, 8).map((c, i) => {
    const isMoney = MONEY_PREVIEW_KEYS.has(c.key);
    const isStatus = STATUS_PREVIEW_KEYS.has(c.key);
    return {
      key: c.key,
      header: c.header,
      align: isMoney ? "end" : isStatus ? "center" : "start",
      render: (row) => {
        const v = String(row[c.key] ?? "");
        if (isStatus) {
          const tone = pillToneFor(v);
          return tone ? (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>
              {v}
            </span>
          ) : (
            <span className="num text-xs">{v || "—"}</span>
          );
        }
        if (isMoney) return <span className="num text-[12.5px] font-bold">{v || "—"}</span>;
        return (
          <span className={`text-xs ${i === 0 ? "font-semibold" : "num"}`}>{v || "—"}</span>
        );
      },
    };
  });

  const emptyMsg =
    needsParty && !partyId
      ? { title: "ابتدا یک طرف حساب انتخاب کنید", description: "برای دیدن صورتحساب، طرف حساب را از فیلترها انتخاب کنید." }
      : needsAccount && !accountId
        ? { title: "ابتدا یک حساب انتخاب کنید", description: "برای دیدن صورتحساب، صندوق/حساب بانکی را از فیلترها انتخاب کنید." }
        : { title: "داده‌ای برای این گزارش نیست", description: "فیلترها را تغییر دهید یا ابتدا داده ثبت کنید." };

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------- grouped report picker ------------------------ */}
      <SectionCard title="گزارش‌ها" icon={<FileBarChart size={16} className="text-[#0b9e6e]" />}>
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {REPORT_GROUPS.map((g) => (
            <div key={g.key} className="glass-soft rounded-2xl p-3.5">
              <div className="mb-2.5 flex items-center gap-2.5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${g.tone}`}>
                  <g.icon size={17} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold">{g.title}</p>
                  <p className="num text-[10px] text-ink-400">{toPersianDigits(g.kinds.length)} گزارش</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.kinds.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                      kind === k.value
                        ? "bg-[#0b9e6e] text-white shadow-lg shadow-[#0b9e6e]/25"
                        : "bg-white/60 text-ink-600 hover:text-[#0b9e6e] dark:bg-white/8 dark:text-ink-300 dark:hover:text-[#3ddc9a]"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {KIND_HINTS[kind] && (
          <p className="mt-3 rounded-xl bg-[#10b981]/10 px-3.5 py-2.5 text-[11.5px] leading-5 text-[#0b7a55] dark:bg-[#10b981]/12 dark:text-[#3ddc9a]">
            {KIND_HINTS[kind]}
          </p>
        )}
      </SectionCard>

      {/* ------------------------------- filters -------------------------------- */}
      <SectionCard title="فیلترها و بازه" icon={<FileBarChart size={16} className="text-[#2563eb]" />}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-200 active:scale-95 ${
                  preset === p.key
                    ? "bg-[#2563eb] text-white shadow-lg shadow-[#2563eb]/25"
                    : "bg-white/60 text-ink-600 hover:text-[#2563eb] dark:bg-white/8 dark:text-ink-300 dark:hover:text-[#6ba3f8]"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="flex-1" />
            <FilterSelect
              value={currency}
              onChange={setCurrency}
              ariaLabel="ارز"
              options={[
                { value: "all", label: "هر دو ارز" },
                { value: "IRT", label: "تومان" },
                { value: "USD", label: "دلار" },
              ]}
            />
            {usesStatusFilter && (
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel="وضعیت"
                options={[
                  { value: "all", label: "همه وضعیت‌ها" },
                  { value: "final", label: "قطعی" },
                  { value: "reversed", label: "برگشت خورده" },
                  { value: "cancelled", label: "ابطال شده" },
                ]}
              />
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[150px]">
              <p className="mb-1.5 text-[13px] font-bold">از تاریخ</p>
              <JalaliDatePicker
                value={from}
                onChange={(v) => {
                  setFrom(v);
                  setPreset("custom");
                }}
                placeholder="از"
              />
            </div>
            <div className="w-[150px]">
              <p className="mb-1.5 text-[13px] font-bold">تا تاریخ</p>
              <JalaliDatePicker
                value={to}
                onChange={(v) => {
                  setTo(v);
                  setPreset("custom");
                }}
                placeholder="تا"
              />
            </div>
            {kind === "periodic" && (
              <div className="w-[160px]">
                <p className="mb-1.5 text-[13px] font-bold">دوره‌بندی</p>
                <FilterSelect
                  value={granularity}
                  onChange={(v) => setGranularity(v as typeof granularity)}
                  options={[
                    { value: "day", label: "روزانه" },
                    { value: "week", label: "هفتگی" },
                    { value: "month", label: "ماهانه" },
                    { value: "year", label: "سالانه" },
                  ]}
                />
              </div>
            )}
            {needsParty && (
              <div className="min-w-[220px] flex-1">
                <p className="mb-1.5 text-[13px] font-bold">طرف حساب</p>
                <SearchSelect
                  items={(parties ?? []).map((p) => ({ id: p.id, title: p.name, subtitle: p.code }))}
                  value={partyId}
                  onSelect={setPartyId}
                  placeholder="انتخاب طرف حساب…"
                />
              </div>
            )}
            {needsAccount && (
              <div className="min-w-[220px] flex-1">
                <p className="mb-1.5 text-[13px] font-bold">حساب</p>
                <SearchSelect
                  items={(accounts ?? []).map((a) => ({ id: a.id, title: a.name, subtitle: ACCOUNT_TYPE_LABELS[a.type] }))}
                  value={accountId}
                  onSelect={setAccountId}
                  placeholder="انتخاب حساب…"
                />
              </div>
            )}
            <div className="flex-1" />
            <Button variant="primary" icon={FileDown} onClick={() => setExportOpen(true)} disabled={report.rows.length === 0}>
              خروجی گزارش
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* ------------------------------ summary tiles --------------------------- */}
      {report.sections.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {report.sections.map((sec, i) => (
            <div key={i} className="flex flex-wrap items-stretch gap-2.5">
              {sec.tag && (
                <span
                  className={`flex shrink-0 items-center justify-center self-stretch rounded-2xl px-4 text-[12px] font-extrabold text-white shadow-md ${
                    sec.tag === "دلار"
                      ? "bg-gradient-to-br from-[#3b82f6] to-[#2563eb] shadow-[#2563eb]/30"
                      : "bg-gradient-to-br from-[#10b981] to-[#0b9e6e] shadow-[#0b9e6e]/30"
                  }`}
                >
                  {sec.tag}
                </span>
              )}
              {sec.items.map((s) => (
                <div key={s.label} className="glass min-w-[128px] flex-1 rounded-2xl px-3.5 py-3">
                  <p className="text-[10.5px] font-medium text-ink-500 dark:text-ink-400">{s.label}</p>
                  <p className="num mt-0.5 text-[15px] font-extrabold leading-6">{s.value}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* -------------------- per-party breakdown (in-page) -------------------- */}
      {report.partySummary && report.partySummary.rows.length > 0 && (
        <SectionCard
          title="جمع‌بندی به تفکیک طرف حساب"
          icon={<Users size={16} className="text-[#0b9e6e]" />}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-right">
              <thead>
                <tr className="bg-[#10b981]/10 text-[11px] font-bold text-[#0b7a55] dark:text-[#3ddc9a]">
                  {report.partySummary.columns.map((h, i) => (
                    <th
                      key={i}
                      className={`whitespace-nowrap px-3 py-2.5 ${i === 0 ? "rounded-r-xl text-right" : "text-center"} ${
                        i === report.partySummary!.columns.length - 1 ? "rounded-l-xl" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.partySummary.rows.map((row, r) => (
                  <tr key={r} className="border-b border-ink-900/5 text-[12px] dark:border-white/6">
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={`whitespace-nowrap px-3 py-2.5 ${c === 0 ? "text-right font-bold" : "num text-center font-semibold"} ${
                          cell === "—" ? "text-ink-300 dark:text-ink-600" : ""
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-[#10b981]/10 text-[12px] font-extrabold text-[#0b7a55] dark:text-[#3ddc9a]">
                  {report.partySummary.totalRow.map((cell, c) => (
                    <td key={c} className={`whitespace-nowrap px-3 py-2.5 ${c === 0 ? "rounded-r-xl text-right" : "num text-center"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ------------------------------ data preview ---------------------------- */}
      <DataTable
        columns={previewColumns}
        rows={report.rows.slice(0, 60)}
        rowKey={(row) => String(report.rows.indexOf(row))}
        loading={!transactions}
        empty={
          <EmptyState
            icon={FileBarChart}
            title={emptyMsg.title}
            description={emptyMsg.description}
          />
        }
        footer={
          report.rows.length > 60
            ? `پیش‌نمایش ۶۰ ردیف اول از ${report.rows.length.toLocaleString("fa-IR")} — در خروجی همه ردیف‌ها می‌آیند`
            : `${report.rows.length.toLocaleString("fa-IR")} ردیف`
        }
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={report.title || KIND_LABEL[kind]}
        subtitle={subtitleLine}
        columns={report.columns}
        rows={report.rows}
        defaultFilename={`acc-report-${kind}`}
        summarySections={report.sections}
        partySummary={report.partySummary}
        theme="acc"
      />
    </div>
  );
}
