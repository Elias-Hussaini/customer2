/**
 * Accounting reports — 16 kinds, all computed from real stored data with the
 * same business rules as the engine. Every report exports to XLSX / CSV /
 * PDF / PNG through the shared export dialog.
 */

import { useMemo, useState } from "react";
import { FileBarChart, FileDown } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SectionCard, FilterSelect, SearchSelect } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { ExportDialog } from "../../components/exports/ExportDialog";
import type { ExportColumn } from "../../utils/export/tabular";
import { formatJalali, todayIso } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import {
  buildStatementRows,
  computeAllAccountBalances,
  groupByPeriod,
  outstandingEffectiveStatus,
  outstandingRemaining,
  totalsByType,
} from "../../accounting/engine";
import {
  ACCOUNT_TYPE_LABELS,
  OUTSTANDING_KIND_LABELS,
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

type ReportKind =
  | "overall"
  | "partyStatement"
  | "receipts"
  | "payments"
  | "withdrawals"
  | "accountStatement"
  | "cashBalances"
  | "receivables"
  | "payables"
  | "outstandingDue"
  | "docs"
  | "audit"
  | "currencySummary"
  | "periodic";

const REPORTS: { value: ReportKind; label: string }[] = [
  { value: "overall", label: "گزارش کل تراکنش‌ها" },
  { value: "partyStatement", label: "صورتحساب طرف حساب" },
  { value: "receipts", label: "گزارش دریافت‌ها" },
  { value: "payments", label: "گزارش پرداخت‌ها" },
  { value: "withdrawals", label: "گزارش برداشت‌ها" },
  { value: "accountStatement", label: "صورتحساب صندوق / حساب بانکی" },
  { value: "cashBalances", label: "گزارش مانده صندوق‌ها و بانک‌ها" },
  { value: "receivables", label: "گزارش مطالبات" },
  { value: "payables", label: "گزارش بدهی‌ها" },
  { value: "outstandingDue", label: "مانده‌های باز و سررسیدگذشته" },
  { value: "docs", label: "گزارش بایگانی اسناد" },
  { value: "audit", label: "گزارش حسابرسی" },
  { value: "currencySummary", label: "خلاصه ارزی" },
  { value: "periodic", label: "خلاصه دوره‌ای (روزانه/ماهانه…)" },
];

type AnyRow = Record<string, string | number>;

export function AccReportsPage() {
  const transactions = useAccTransactions();
  const parties = useAccParties();
  const accounts = useAccAccounts();
  const outstanding = useAccOutstanding();
  const docs = useAccDocsMeta();
  const activities = useActivities(300);

  const [kind, setKind] = useState<ReportKind>("overall");
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
    summary?: { label: string; value: string }[];
  } => {
    if (!transactions || !parties || !accounts || !outstanding) {
      return { title: "", columns: [], rows: [] };
    }
    const cur = currency === "USD" ? "USD" : currency === "IRT" ? "IRT" : null;

    switch (kind) {
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
        return {
          title: REPORTS.find((r) => r.value === kind)!.label,
          columns: cols,
          rows,
          summary: [
            { label: "تعداد", value: list.length.toLocaleString("fa-IR") },
            { label: "جمع تومان", value: formatMoney((totals.totals.receipt?.IRT ?? 0) + (totals.totals.payment?.IRT ?? 0) + (totals.totals.withdrawal?.IRT ?? 0), "IRT") },
            { label: "جمع دلار", value: formatMoney((totals.totals.receipt?.USD ?? 0) + (totals.totals.payment?.USD ?? 0) + (totals.totals.withdrawal?.USD ?? 0), "USD") },
          ],
        };
      }

      case "partyStatement": {
        if (!partyId) return { title: "صورتحساب طرف حساب", columns: [], rows: [], summary: [{ label: "", value: "ابتدا یک طرف حساب انتخاب کنید" }] };
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
          summary: [
            { label: "مانده پایانی (تومان)", value: formatMoney(closing.IRT, "IRT") },
            { label: "مانده پایانی (دلار)", value: formatMoney(closing.USD, "USD") },
          ],
        };
      }

      case "accountStatement":
      case "cashBalances": {
        const balances = computeAllAccountBalances(accounts, transactions);
        if (kind === "cashBalances") {
          return {
            title: "مانده صندوق‌ها و حساب‌های بانکی",
            columns: [
              { key: "name", header: "حساب" },
              { key: "type", header: "نوع" },
              { key: "currency", header: "ارز" },
              { key: "balance", header: "مانده فعلی" },
              { key: "txCount", header: "تعداد تراکنش" },
              { key: "active", header: "وضعیت" },
            ],
            rows: accounts.map((a) => ({
              name: a.name,
              type: ACCOUNT_TYPE_LABELS[a.type],
              currency: a.currency === "USD" ? "دلار" : "تومان",
              balance: (balances.get(a.id)?.balance ?? 0).toLocaleString("fa-IR"),
              txCount: (balances.get(a.id)?.txCount ?? 0).toLocaleString("fa-IR"),
              active: a.active ? "فعال" : "غیرفعال",
            })),
            summary: [
              {
                label: "جمع مانده تومانی",
                value: formatMoney(
                  accounts.filter((a) => a.currency === "IRT").reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0),
                  "IRT",
                ),
              },
              {
                label: "جمع مانده دلاری",
                value: formatMoney(
                  accounts.filter((a) => a.currency === "USD").reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0),
                  "USD",
                ),
              },
            ],
          };
        }
        if (!accountId) return { title: "صورتحساب صندوق/حساب", columns: [], rows: [], summary: [{ label: "", value: "ابتدا یک حساب انتخاب کنید" }] };
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
          summary: [
            { label: "ارز حساب", value: account.currency === "USD" ? "دلار" : "تومان" },
            { label: "مانده فعلی", value: formatMoney(balances.get(account.id)?.balance ?? 0, account.currency) },
          ],
        };
      }

      case "receivables":
      case "payables":
      case "outstandingDue": {
        const wantKind = kind === "receivables" ? "receivable" : kind === "payables" ? "payable" : null;
        const today = todayIso();
        let list = outstanding.filter((o) => o.status !== "cancelled");
        if (wantKind) list = list.filter((o) => o.kind === wantKind);
        if (kind === "outstandingDue") list = list.filter((o) => outstandingEffectiveStatus(o, today) === "overdue");
        if (currency !== "all") list = list.filter((o) => o.currency === currency);
        return {
          title: REPORTS.find((r) => r.value === kind)!.label,
          columns: [
            { key: "party", header: "طرف حساب" },
            { key: "kind", header: "نوع" },
            { key: "amount", header: "مبلغ کل" },
            { key: "settled", header: "تسویه شده" },
            { key: "remaining", header: "مانده" },
            { key: "currency", header: "ارز" },
            { key: "due", header: "سررسید" },
            { key: "status", header: "وضعیت" },
            { key: "description", header: "شرح" },
          ],
          rows: list.map((o) => ({
            party: partyName(o.partyId),
            kind: OUTSTANDING_KIND_LABELS[o.kind],
            amount: o.amount.toLocaleString("fa-IR"),
            settled: (o.amount - outstandingRemaining(o)).toLocaleString("fa-IR"),
            remaining: outstandingRemaining(o).toLocaleString("fa-IR"),
            currency: o.currency === "USD" ? "دلار" : "تومان",
            due: o.dueDate ? formatJalali(o.dueDate) : "",
            status: outstandingEffectiveStatus(o, today),
            description: o.description ?? "",
          })),
          summary: [
            { label: "جمع مانده تومانی", value: formatMoney(list.filter((o) => o.currency === "IRT").reduce((s, o) => s + outstandingRemaining(o), 0), "IRT") },
            { label: "جمع مانده دلاری", value: formatMoney(list.filter((o) => o.currency === "USD").reduce((s, o) => s + outstandingRemaining(o), 0), "USD") },
          ],
        };
      }

      case "docs": {
        const list = (docs ?? []).filter(
          (d) => (!from || new Date(d.createdAt).toISOString().slice(0, 10) >= from) && (!to || new Date(d.createdAt).toISOString().slice(0, 10) <= to),
        );
        return {
          title: "بایگانی اسناد حسابداری",
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
          summary: [{ label: "تعداد اسناد", value: list.length.toLocaleString("fa-IR") }],
        };
      }

      case "audit": {
        const list = (activities ?? []).filter((a) => a.entity.startsWith("acc"));
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
          summary: [{ label: "تعداد رویداد", value: list.length.toLocaleString("fa-IR") }],
        };
      }

      case "currencySummary": {
        const totals = totalsByType(baseTx);
        const rows: AnyRow[] = [];
        for (const c of ["IRT", "USD"] as const) {
          if (cur && cur !== c) continue;
          rows.push({
            currency: c === "USD" ? "دلار" : "تومان",
            receipts: (totals.totals.receipt?.[c] ?? 0).toLocaleString("fa-IR"),
            payments: (totals.totals.payment?.[c] ?? 0).toLocaleString("fa-IR"),
            withdrawals: (totals.totals.withdrawal?.[c] ?? 0).toLocaleString("fa-IR"),
            transfers: (totals.totals.transfer?.[c] ?? 0).toLocaleString("fa-IR"),
            openings: (totals.totals.opening?.[c] ?? 0).toLocaleString("fa-IR"),
            adjustments: (totals.totals.adjustment?.[c] ?? 0).toLocaleString("fa-IR"),
          });
        }
        return {
          title: "خلاصه ارزی تراکنش‌ها",
          columns: [
            { key: "currency", header: "ارز" },
            { key: "receipts", header: "دریافت" },
            { key: "payments", header: "پرداخت" },
            { key: "withdrawals", header: "برداشت" },
            { key: "transfers", header: "انتقال" },
            { key: "openings", header: "مانده اولیه" },
            { key: "adjustments", header: "تعدیل" },
          ],
          rows,
          summary: [{ label: "بازه", value: from || to ? `${from ?? "ابتدا"} تا ${to ?? "امروز"}` : "همه دوره‌ها" }],
        };
      }

      case "periodic": {
        const buckets = groupByPeriod(baseTx, granularity, (iso, g) => {
          if (g === "year") return formatJalali(iso).slice(0, 4);
          if (g === "month") return formatJalali(iso, "medium");
          return formatJalali(iso);
        });
        return {
          title: `خلاصه ${granularity === "day" ? "روزانه" : granularity === "week" ? "هفتگی" : granularity === "month" ? "ماهانه" : "سالانه"}`,
          columns: [
            { key: "period", header: "دوره" },
            { key: "count", header: "تعداد تراکنش" },
            { key: "receiptsIRT", header: "دریافت (تومان)" },
            { key: "paymentsIRT", header: "پرداخت (تومان)" },
            { key: "receiptsUSD", header: "دریافت (دلار)" },
            { key: "paymentsUSD", header: "پرداخت (دلار)" },
          ],
          rows: buckets.map((b) => ({
            period: b.label,
            count: b.count.toLocaleString("fa-IR"),
            receiptsIRT: b.receipts.IRT.toLocaleString("fa-IR"),
            paymentsIRT: b.payments.IRT.toLocaleString("fa-IR"),
            receiptsUSD: (b.receipts.USD / 100).toLocaleString("fa-IR"),
            paymentsUSD: (b.payments.USD / 100).toLocaleString("fa-IR"),
          })),
          summary: [{ label: "تعداد دوره‌ها", value: buckets.length.toLocaleString("fa-IR") }],
        };
      }

      default:
        return { title: "", columns: [], rows: [] };
    }
  }, [kind, baseTx, partyId, accountId, from, to, currency, granularity, transactions, parties, accounts, outstanding, docs, activities]);

  const previewColumns: Column<AnyRow>[] = report.columns.slice(0, 8).map((c) => ({
    key: c.key,
    header: c.header,
    render: (row) => <span className="num text-xs">{String(row[c.key] ?? "")}</span>,
  }));

  const needsParty = kind === "partyStatement";
  const needsAccount = kind === "accountStatement";

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="انتخاب گزارش و فیلترها" icon={<FileBarChart size={16} className="text-brand-500" />}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[13px] font-bold">نوع گزارش</p>
              <FilterSelect value={kind} onChange={(v) => setKind(v as ReportKind)} options={REPORTS} />
            </div>
            {kind === "periodic" && (
              <div>
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
              <div>
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
              <div>
                <p className="mb-1.5 text-[13px] font-bold">حساب</p>
                <SearchSelect
                  items={(accounts ?? []).map((a) => ({ id: a.id, title: a.name, subtitle: ACCOUNT_TYPE_LABELS[a.type] }))}
                  value={accountId}
                  onSelect={setAccountId}
                  placeholder="انتخاب حساب…"
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[150px]">
              <p className="mb-1.5 text-[13px] font-bold">از تاریخ</p>
              <JalaliDatePicker value={from} onChange={setFrom} placeholder="از" />
            </div>
            <div className="w-[150px]">
              <p className="mb-1.5 text-[13px] font-bold">تا تاریخ</p>
              <JalaliDatePicker value={to} onChange={setTo} placeholder="تا" />
            </div>
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
            {kind !== "partyStatement" && kind !== "accountStatement" && (
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
            <div className="flex-1" />
            <Button variant="primary" icon={FileDown} onClick={() => setExportOpen(true)} disabled={report.rows.length === 0}>
              خروجی گزارش
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Summary chips */}
      {report.summary && report.summary.length > 0 && report.summary[0].label && (
        <div className="flex flex-wrap gap-2">
          {report.summary.map((s) => (
            <span key={s.label} className="glass-soft num rounded-full px-3.5 py-2 text-xs font-bold">
              {s.label}: {s.value}
            </span>
          ))}
        </div>
      )}

      <DataTable
        columns={previewColumns}
        rows={report.rows.slice(0, 60)}
        rowKey={(row) => String(report.rows.indexOf(row))}
        loading={!transactions}
        empty={
          <EmptyState
            icon={FileBarChart}
            title="داده‌ای برای این گزارش نیست"
            description="فیلترها را تغییر دهید یا ابتدا داده ثبت کنید."
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
        title={report.title}
        subtitle={from || to ? `بازه: ${from ?? "ابتدا"} تا ${to ?? "امروز"}` : "همه دوره‌ها"}
        columns={report.columns}
        rows={report.rows}
        defaultFilename={`acc-report-${kind}`}
        summary={report.summary?.filter((s) => s.label)}
      />
    </div>
  );
}
