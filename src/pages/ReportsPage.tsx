import { useMemo, useState } from "react";
import { FileBarChart, FileDown, Wallet } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, RadioSelect, SectionCard } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { ExportDialog } from "../components/exports/ExportDialog";
import { useCustomers, useLists, usePayments, useRepresentatives, useRequests, useTags } from "../hooks/useData";
import { computeBalances } from "../services/stats";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { formatMoney } from "../utils/num";
import { customerFullName } from "../db/customers";
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
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const filteredRequests = useMemo(() => {
    return (requests ?? []).filter((r) => {
      if (repId && r.representativeId !== repId) return false;
      if (listId && r.listId !== listId) return false;
      if (status === "issued" && !r.issued) return false;
      if (status === "pending" && r.issued) return false;
      if (tagId && !r.tags.includes(tagId)) return false;
      if (from && r.registrationDate < from) return false;
      if (to && r.registrationDate > to) return false;
      return true;
    });
  }, [requests, repId, listId, status, tagId, from, to]);

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
      status: r.issued ? "صادر شده" : "در حال کار",
      issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
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

  const filtersBar = (
    <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3.5">
      <FilterSelect
        ariaLabel="نماینده"
        value={repId}
        onChange={setRepId}
        options={[
          { value: "", label: "همه نمایندگان" },
          ...(representatives ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
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
      <JalaliDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" className="w-40" />
      <JalaliDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" className="w-40" />
      {(repId || listId || status || tagId || from || to) && (
        <button
          className="btn btn-ghost btn-sm mr-auto"
          onClick={() => {
            setRepId("");
            setListId("");
            setStatus("");
            setTagId("");
            setFrom(null);
            setTo(null);
          }}
        >
          پاک‌کردن فیلترها
        </button>
      )}
    </div>
  );

  const totalsPerCurrency = useMemo(() => {
    const acc = { USD: 0, IRT: 0 };
    for (const p of filteredPayments) acc[p.currency] += p.amount;
    return acc;
  }, [filteredPayments]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="گزارش‌ها"
        subtitle="گزارش بگیرید و در قالب اکسل، CSV، PDF یا تصویر خروجی بگیرید"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setExportOpen(true)}>
            <FileDown size={14} /> خروجی گزارش
          </button>
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
              key: "status",
              header: "وضعیت",
              sortValue: (r) => (r.issued ? 1 : 0),
              render: (r) => (r.issued ? "✅ صادر شده" : "⏳ در حال کار"),
            },
          ]}
          rows={filteredRequests}
          rowKey={(r) => r.id}
          loading={requests === undefined}
          initialSort={{ key: "registrationDate", dir: "desc" }}
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
