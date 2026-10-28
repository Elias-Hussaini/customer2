import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarRange, FileBarChart, FileDown, Wallet } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, RadioSelect, SectionCard } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { StatusPill } from "../components/ui/Badges";
import { ExportDialog } from "../components/exports/ExportDialog";
import { useCustomers, useLists, usePayments, useRepresentatives, useRequests, useTags } from "../hooks/useData";
import { computeBalances } from "../services/stats";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import {
  REQUEST_DATE_BASIS_OPTIONS,
  basisRangePlaceholders,
  isRequestDateBasis,
  quickDateRanges,
  requestBasisLabel,
  requestWithinRange,
  type RequestDateBasis,
} from "../utils/requestDateFilter";
import { formatMoney } from "../utils/num";
import { customerFullName } from "../db/customers";
import { requestStatusFa } from "../types";
import type { Representative } from "../types";

type ReportKind = "requests" | "payments" | "balances";

interface BalanceRow {
  repId: string;
  repName: string;
  currency: "USD" | "IRT";
  quoted: number;
  paid: number;
  balance: number;
  total: number;
  issued: number;
}

export function ReportsPage() {
  const navigate = useNavigate();
  const requests = useRequests();
  const payments = usePayments();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();

  const [kind, setKind] = useState<ReportKind>("requests");
  const [repId, setRepId] = useState("");
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState("");
  const [tagId, setTagId] = useState("");
  /** Which request date (registration / issuance / rejection) the range applies to. */
  const [dateBasis, setDateBasis] = useState<RequestDateBasis>("registration");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const filteredRequests = useMemo(() => {
    return (requests ?? []).filter((r) => {
      if (repId && r.representativeId !== repId) return false;
      if (listId && r.listId !== listId) return false;
      if (status === "issued" && !r.issued) return false;
      if (status === "pending" && (r.issued || r.rejected)) return false;
      if (status === "rejected" && !r.rejected) return false;
      if (tagId && !r.tags.includes(tagId)) return false;
      if (!requestWithinRange(r, dateBasis, from, to)) return false;
      return true;
    });
  }, [requests, repId, listId, status, tagId, dateBasis, from, to]);

  const filteredPayments = useMemo(() => {
    return (payments ?? []).filter((p) => {
      if (repId && p.representativeId !== repId) return false;
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      return true;
    });
  }, [payments, repId, from, to]);

  const balanceRows = useMemo<BalanceRow[]>(() => {
    const out: BalanceRow[] = [];
    for (const rep of representatives ?? []) {
      const repReqs = filteredRequests.filter((r) => r.representativeId === rep.id);
      const repPays = filteredPayments.filter((p) => p.representativeId === rep.id);
      if (repReqs.length === 0 && repPays.length === 0) continue;
      const balances = computeBalances(repReqs, repPays);
      for (const b of balances) {
        out.push({
          repId: rep.id,
          repName: rep.name,
          currency: b.currency,
          quoted: b.quoted,
          paid: b.paid,
          balance: b.balance,
          total: repReqs.length,
          issued: repReqs.filter((r) => r.issued).length,
        });
      }
    }
    return out.sort((a, b) => a.repName.localeCompare(b.repName, "fa"));
  }, [representatives, filteredRequests, filteredPayments]);

  const requestColumns = [
    { key: "customer", header: "مشتری" },
    { key: "passportNo", header: "پاسپورت" },
    { key: "visaType", header: "نوع ویزا" },
    { key: "representative", header: "نماینده" },
    { key: "list", header: "لیست" },
    { key: "amount", header: "مبلغ" },
    { key: "currency", header: "ارز" },
    { key: "registrationDate", header: "تاریخ ثبت" },
    { key: "status", header: "وضعیت" },
    { key: "issuedAt", header: "تاریخ صدور" },
    { key: "rejectedAt", header: "تاریخ رد" },
    { key: "notes", header: "توضیحات" },
  ];

  const requestExportRows = filteredRequests.map((r) => {
    const c = (customers ?? []).find((x) => x.id === r.customerId);
    return {
      customer: c ? customerFullName(c) : "",
      passportNo: c?.passportNo ?? "",
      visaType: r.visaType ?? "",
      representative: (representatives ?? []).find((x) => x.id === r.representativeId)?.name ?? "",
      list: (lists ?? []).find((l) => l.id === r.listId)?.name ?? "",
      amount: r.quotedAmount ?? "",
      currency: r.currency === "USD" ? "دلار" : r.currency === "IRT" ? "تومان" : "",
      registrationDate: formatJalali(r.registrationDate),
      status: requestStatusFa(r),
      issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
      rejectedAt: r.rejectedAt ? formatJalali(r.rejectedAt) : "",
      notes: r.notes ?? "",
    };
  });

  const paymentExportRows = filteredPayments.map((p) => ({
    date: formatJalali(p.date),
    representative: (representatives ?? []).find((x) => x.id === p.representativeId)?.name ?? "",
    amount: p.amount,
    currency: p.currency === "USD" ? "دلار" : "تومان",
    request: (() => {
      const r = (requests ?? []).find((x) => x.id === p.requestId);
      const c = r && (customers ?? []).find((x) => x.id === r.customerId);
      return c ? customerFullName(c) : "";
    })(),
    description: p.description ?? "",
  }));

  const balanceColumns = [
    { key: "repName", header: "نماینده" },
    { key: "currency", header: "ارز" },
    { key: "quoted", header: "مطالبات" },
    { key: "paid", header: "دریافتی" },
    { key: "balance", header: "مانده" },
    { key: "total", header: "درخواست‌ها" },
    { key: "issued", header: "صادر شده" },
  ];

  const balanceExportRows = balanceRows.map((b) => ({
    repName: b.repName,
    currency: b.currency === "USD" ? "دلار" : "تومان",
    quoted: b.quoted,
    paid: b.paid,
    balance: b.balance,
    total: b.total,
    issued: b.issued,
  }));

  const balanceTableColumns: Column<BalanceRow>[] = balanceColumns.map((c) => ({
    key: c.key,
    header: c.header,
    sortValue: (row: BalanceRow) => row[c.key as keyof BalanceRow] as string | number,
    render:
      c.key === "quoted" || c.key === "paid" || c.key === "balance"
        ? (row: BalanceRow) => (
            <span
              className={`num font-bold ${
                c.key === "balance" ? (row.balance > 0 ? "text-[#dc3535]" : "text-[#0b9e6e]") : ""
              }`}
            >
              {formatMoney(row[c.key as "quoted" | "paid" | "balance"], row.currency)}
            </span>
          )
        : c.key === "currency"
          ? (row: BalanceRow) => (row.currency === "USD" ? "دلار" : "تومان")
          : c.key === "repName"
            ? (row: BalanceRow) => <span className="font-semibold">{row.repName}</span>
            : (row: BalanceRow) => <span className="num">{toPersianDigits(row[c.key as "total" | "issued"])}</span>,
  }));

  const rangePlaceholders = basisRangePlaceholders(dateBasis);
  const quickRanges = useMemo(() => quickDateRanges(), []);

  /** rep name → profile photo — small, next to each name in grouped exports. */
  const repPhotos = useMemo(
    () =>
      Object.fromEntries(
        (representatives ?? []).map((r) => [r.name, r.photo ?? undefined]),
      ),
    [representatives],
  );
  /** Section grouping for the export — by representative, with photos. */
  const exportGrouping = useMemo(
    () => ({
      columnKey: kind === "balances" ? "repName" : "representative",
      label: "نماینده",
      photos: repPhotos,
    }),
    [kind, repPhotos],
  );

  const clearAllFilters = () => {
    setRepId("");
    setListId("");
    setStatus("");
    setTagId("");
    setDateBasis("registration");
    setFrom(null);
    setTo(null);
  };

  const filtersBar = (
    <div className="glass flex flex-col gap-2.5 rounded-3xl p-3.5">
      <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        ariaLabel="نماینده"
        value={repId}
        onChange={setRepId}
        options={[
          { value: "", label: "همه نمایندگان" },
          ...(representatives ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      {kind !== "payments" && (
        <>
          {kind === "requests" && (
            <>
              <FilterSelect
                ariaLabel="لیست"
                value={listId}
                onChange={setListId}
                options={[
                  { value: "", label: "همه لیست‌ها" },
                  ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
              <FilterSelect
                ariaLabel="وضعیت"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "", label: "همه وضعیت‌ها" },
                  { value: "issued", label: "صادر شده" },
                  { value: "pending", label: "در حال کار" },
                  { value: "rejected", label: "رد شده" },
                ]}
              />
              <FilterSelect
                ariaLabel="تگ"
                value={tagId}
                onChange={setTagId}
                options={[
                  { value: "", label: "همه تگ‌ها" },
                  ...(tags ?? []).map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </>
          )}
          <div className="flex items-center gap-1.5">
            <span className="hidden shrink-0 text-[11px] font-bold text-ink-400 sm:inline">مبنای بازه:</span>
            <FilterSelect
              ariaLabel="مبنای بازه تاریخ"
              value={dateBasis}
              onChange={(v) => setDateBasis(isRequestDateBasis(v) ? v : "registration")}
              options={REQUEST_DATE_BASIS_OPTIONS}
            />
          </div>
        </>
      )}
      <JalaliDatePicker
        value={from}
        onChange={setFrom}
        placeholder={kind === "payments" ? "از تاریخ" : rangePlaceholders.from}
        className="w-40"
      />
      <JalaliDatePicker
        value={to}
        onChange={setTo}
        placeholder={kind === "payments" ? "تا تاریخ" : rangePlaceholders.to}
        className="w-40"
      />
      {(repId || listId || status || tagId || from || to) && (
        <button className="btn btn-ghost btn-sm mr-auto" onClick={clearAllFilters}>
          پاک‌کردن فیلترها
        </button>
      )}
      </div>
      {/* One-click ranges — applied to the basis date (ثبت/صدور/رد) on request reports */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-900/5 pt-2 dark:border-white/5">
        <span className="shrink-0 text-[11px] font-bold text-ink-400">بازه سریع:</span>
        {quickRanges.map((q) => {
          const active = from === q.from && to === q.to;
          return (
            <button
              key={q.key}
              type="button"
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition-all ${
                active
                  ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
                  : "bg-ink-900/5 text-ink-500 hover:bg-brand-500/12 hover:text-brand-600 dark:bg-white/5 dark:text-ink-400 dark:hover:text-brand-300"
              }`}
              onClick={() => {
                setFrom(q.from);
                setTo(q.to);
              }}
            >
              {q.label}
            </button>
          );
        })}
        {kind !== "payments" && dateBasis !== "registration" && (from || to) && (
          <span className="text-[11px] text-ink-400">بازه بر اساس «{requestBasisLabel(dateBasis)}» اعمال می‌شود</span>
        )}
      </div>
    </div>
  );

  const totalsPerCurrency = useMemo(() => {
    const acc = { USD: 0, IRT: 0 };
    for (const p of filteredPayments) acc[p.currency] += p.amount;
    return acc;
  }, [filteredPayments]);

  /** Human-readable summary of the active filters — printed on PDF/PNG exports. */
  const repName = (id: string) => (representatives ?? []).find((r) => r.id === id)?.name ?? "";
  const rangeText = from || to ? `${from ? formatJalali(from) : "…"} تا ${to ? formatJalali(to) : "…"}` : null;
  const statusLabel =
    status === "issued" ? "صادر شده" : status === "pending" ? "در حال کار" : status === "rejected" ? "رد شده" : "";
  const exportSubtitle =
    kind === "payments"
      ? [repId ? `نماینده: ${repName(repId)}` : null, rangeText ? `تاریخ پرداخت: ${rangeText}` : null]
          .filter(Boolean)
          .join(" • ")
      : [
          repId ? `نماینده: ${repName(repId)}` : null,
          listId ? `لیست: ${lists?.find((l) => l.id === listId)?.name ?? ""}` : null,
          status ? `وضعیت: ${statusLabel}` : null,
          rangeText ? `${requestBasisLabel(dateBasis)}: ${rangeText}` : null,
        ]
          .filter(Boolean)
          .join(" • ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="گزارش‌ها"
        subtitle="گزارش بگیرید و در قالب اکسل، CSV، PDF یا تصویر خروجی بگیرید"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-glass btn-sm" onClick={() => navigate("/stats")}>
              <CalendarRange size={14} /> آمار ماهانه
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setExportOpen(true)}>
              <FileDown size={14} /> خروجی گزارش
            </button>
          </div>
        }
      />

      <RadioSelect
        options={[
          { value: "requests", label: "درخواست‌ها" },
          { value: "payments", label: "پرداخت‌ها" },
          { value: "balances", label: "مانده نمایندگان" },
        ]}
        value={kind}
        onChange={(v) => setKind(v as ReportKind)}
      />

      {filtersBar}

      {kind === "requests" && (
        <DataTable
          columns={[
            {
              key: "customer",
              header: "مشتری",
              sortValue: (r) => {
                const c = (customers ?? []).find((x) => x.id === r.customerId);
                return c ? customerFullName(c) : "";
              },
              render: (r) => {
                const c = (customers ?? []).find((x) => x.id === r.customerId);
                return <span className="font-semibold">{c ? customerFullName(c) : "—"}</span>;
              },
            },
            { key: "visaType", header: "نوع ویزا", sortValue: (r) => r.visaType ?? "", render: (r) => r.visaType ?? "—" },
            {
              key: "representative",
              header: "نماینده",
              sortValue: (r) => representatives?.find((x) => x.id === r.representativeId)?.name ?? "",
              render: (r) => representatives?.find((x) => x.id === r.representativeId)?.name ?? "—",
            },
            {
              key: "amount",
              header: "مبلغ",
              sortValue: (r) => r.quotedAmount ?? -1,
              render: (r) =>
                r.quotedAmount != null && r.currency ? (
                  <span className="num">{formatMoney(r.quotedAmount, r.currency)}</span>
                ) : (
                  "—"
                ),
            },
            {
              key: "registrationDate",
              header: "تاریخ ثبت",
              sortValue: (r) => r.registrationDate,
              render: (r) => <span className="num">{formatJalali(r.registrationDate)}</span>,
            },
            {
              key: "issuedAt",
              header: "تاریخ صدور",
              sortValue: (r) => r.issuedAt ?? "",
              render: (r) =>
                r.issuedAt ? <span className="num font-semibold text-[#0b9e6e]">{formatJalali(r.issuedAt)}</span> : "—",
            },
            {
              key: "rejectedAt",
              header: "تاریخ رد",
              sortValue: (r) => r.rejectedAt ?? "",
              render: (r) =>
                r.rejectedAt ? (
                  <span className="num font-semibold text-[#dc3535] dark:text-[#f87b7b]">{formatJalali(r.rejectedAt)}</span>
                ) : (
                  "—"
                ),
            },
            {
              key: "status",
              header: "وضعیت",
              align: "center",
              sortValue: (r) => (r.rejected && !r.issued ? 2 : r.issued ? 1 : 0),
              render: (r) => <StatusPill issued={r.issued} rejected={r.rejected} />,
            },
          ]}
          rows={filteredRequests}
          rowKey={(r) => r.id}
          loading={requests === undefined}
          initialSort={{ key: "registrationDate", dir: "desc" }}
          mobileCard={(r) => {
            const c = (customers ?? []).find((x) => x.id === r.customerId);
            return (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-bold">{c ? customerFullName(c) : "—"}</span>
                  <StatusPill issued={r.issued} rejected={r.rejected} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                  <span>
                    ثبت: <span className="num">{formatJalali(r.registrationDate)}</span>
                  </span>
                  <span>
                    صدور: <span className="num">{r.issuedAt ? formatJalali(r.issuedAt) : "—"}</span>
                  </span>
                  {r.rejectedAt && (
                    <span className="text-[#dc3535] dark:text-[#f87b7b]">
                      رد: <span className="num">{formatJalali(r.rejectedAt)}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          }}
          empty={<EmptyState icon={FileBarChart} title="داده‌ای برای گزارش نیست" compact />}
        />
      )}

      {kind === "payments" && (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="chip num">جمع دلار: {formatMoney(totalsPerCurrency.USD, "USD")}</span>
            <span className="chip num">جمع تومان: {formatMoney(totalsPerCurrency.IRT, "IRT")}</span>
          </div>
          <DataTable
            columns={[
              {
                key: "date",
                header: "تاریخ",
                sortValue: (p) => p.date,
                render: (p) => <span className="num">{formatJalali(p.date)}</span>,
              },
              {
                key: "representative",
                header: "نماینده",
                sortValue: (p) => representatives?.find((x) => x.id === p.representativeId)?.name ?? "",
                render: (p) => representatives?.find((x) => x.id === p.representativeId)?.name ?? "—",
              },
              {
                key: "amount",
                header: "مبلغ",
                sortValue: (p) => p.amount,
                render: (p) => <span className="num font-bold">{formatMoney(p.amount, p.currency)}</span>,
              },
              { key: "description", header: "توضیحات", render: (p) => p.description ?? "—" },
            ]}
            rows={filteredPayments}
            rowKey={(p) => p.id}
            loading={payments === undefined}
            initialSort={{ key: "date", dir: "desc" }}
            empty={<EmptyState icon={Wallet} title="پرداختی در این بازه نیست" compact />}
          />
        </>
      )}

      {kind === "balances" && (
        <DataTable
          columns={balanceTableColumns}
          rows={balanceRows}
          rowKey={(b) => `${b.repId}-${b.currency}`}
          loading={representatives === undefined}
          empty={<EmptyState icon={Wallet} title="مانده‌ای برای نمایش نیست" compact />}
        />
      )}

      <SectionCard title="نکته" className="!p-4">
        <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          خروجی‌های PDF و تصویر، متن فارسی را کامل و راست‌به‌چپ نمایش می‌دهند و مناسب چاپ هستند.
          در خروجی اکسل، جهت صفحه راست‌به‌چپ تنظیم شده است.
        </p>
      </SectionCard>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={
          kind === "requests" ? "گزارش درخواست‌ها" : kind === "payments" ? "گزارش پرداخت‌ها" : "گزارش مانده نمایندگان"
        }
        subtitle={exportSubtitle || undefined}
        rows={
          kind === "requests" ? requestExportRows : kind === "payments" ? paymentExportRows : balanceExportRows
        }
        columns={
          kind === "requests"
            ? requestColumns
            : kind === "payments"
              ? [
                  { key: "date", header: "تاریخ" },
                  { key: "representative", header: "نماینده" },
                  { key: "amount", header: "مبلغ" },
                  { key: "currency", header: "ارز" },
                  { key: "request", header: "درخواست مرتبط" },
                  { key: "description", header: "توضیحات" },
                ]
              : balanceColumns
        }
        defaultFilename={`${kind}-report`}
        grouping={exportGrouping}
        summary={
          kind === "payments"
            ? [
                { label: "تعداد", value: toPersianDigits(filteredPayments.length) },
                { label: "جمع دلار", value: formatMoney(totalsPerCurrency.USD, "USD") },
                { label: "جمع تومان", value: formatMoney(totalsPerCurrency.IRT, "IRT") },
              ]
            : undefined
        }
      />
    </div>
  );
}

export type { Representative };
