import { useMemo, useState } from "react";
import { Banknote, FileDown, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SearchBox } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { Menu } from "../components/ui/Menu";
import { PaymentFormModal } from "../components/domain/PaymentFormModal";
import { AttachmentPreview } from "../components/ui/AttachmentPreview";
import { ExportDialog } from "../components/exports/ExportDialog";
import { deletePayment } from "../db/payments";
import { useCustomers, usePayments, useReceipts, useRepresentatives, useRequests } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { formatMoney } from "../utils/num";
import { customerFullName } from "../db/customers";
import type { Attachment, Payment } from "../types";

export function PaymentsPage() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const payments = usePayments();
  const representatives = useRepresentatives();
  const requests = useRequests();
  const customers = useCustomers();
  const receipts = useReceipts();

  const [repId, setRepId] = useState("");
  const [currency, setCurrency] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<Attachment | null>(null);

  const receiptByPayment = useMemo(
    () => new Map((receipts ?? []).map((r) => [r.paymentId ?? "", r] as const)),
    [receipts],
  );

  const filtered = useMemo(() => {
    return (payments ?? [])
      .filter((p) => {
        if (repId && p.representativeId !== repId) return false;
        if (currency && p.currency !== currency) return false;
        if (from && p.date < from) return false;
        if (to && p.date > to) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [payments, repId, currency, from, to]);

  const totals = useMemo(() => {
    const acc = { USD: 0, IRT: 0 };
    for (const p of filtered) acc[p.currency] += p.amount;
    return acc;
  }, [filtered]);

  const columns: Column<Payment>[] = [
    {
      key: "date",
      header: "تاریخ",
      sortValue: (p) => p.date,
      render: (p) => <span className="num font-semibold">{formatJalali(p.date)}</span>,
    },
    {
      key: "representative",
      header: "نماینده",
      sortValue: (p) => representatives?.find((r) => r.id === p.representativeId)?.name ?? "",
      render: (p) => representatives?.find((r) => r.id === p.representativeId)?.name ?? "—",
    },
    {
      key: "amount",
      header: "مبلغ",
      sortValue: (p) => p.amount,
      render: (p) => <span className="num font-bold">{formatMoney(p.amount, p.currency)}</span>,
    },
    {
      key: "request",
      header: "درخواست مرتبط",
      render: (p) => {
        const r = (requests ?? []).find((x) => x.id === p.requestId);
        if (!r) return <span className="text-ink-400">—</span>;
        const c = customers?.find((x) => x.id === r.customerId);
        return <span className="text-[12px]">{c ? customerFullName(c) : "درخواست"}</span>;
      },
    },
    {
      key: "description",
      header: "توضیحات",
      render: (p) => <span className="text-ink-600 dark:text-ink-300">{p.description ?? "—"}</span>,
    },
    {
      key: "receipt",
      header: "رسید",
      align: "center",
      sortValue: (p) => (receiptByPayment.has(p.id) ? 1 : 0),
      render: (p) => {
        const r = receiptByPayment.get(p.id);
        return r ? (
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#10b981]/12 text-[#0b9e6e] transition-colors hover:bg-[#10b981]/20 dark:text-[#3ddc9a]"
            title="مشاهده رسید"
            aria-label="مشاهده رسید"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewReceipt(r);
            }}
          >
            <Receipt size={15} />
          </button>
        ) : (
          <span className="text-[11px] text-ink-400">—</span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (p) => (
        <Menu
          items={[
            { icon: Pencil, label: "ویرایش", onClick: () => setEditing(p) },
            {
              icon: Trash2,
              label: "حذف",
              danger: true,
              onClick: async () => {
                const ok = await confirm({
                  title: "حذف پرداخت",
                  message: `${formatMoney(p.amount, p.currency)} — این عمل بازگشت‌پذیر نیست.`,
                  danger: true,
                  confirmLabel: "حذف",
                });
                if (ok) {
                  await deletePayment(p.id);
                  toast.info("پرداخت حذف شد");
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
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="پرداخت‌ها"
        subtitle="دفتر مالی — دلار و تومان جداگانه جمع می‌شوند"
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => setExportOpen(true)}>
              <FileDown size={14} /> خروجی
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> ثبت پرداخت
            </button>
          </>
        }
      />

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
        <FilterSelect
          ariaLabel="ارز"
          value={currency}
          onChange={setCurrency}
          options={[
            { value: "", label: "همه ارزها" },
            { value: "USD", label: "دلار" },
            { value: "IRT", label: "تومان" },
          ]}
        />
        <JalaliDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" className="w-40" />
        <JalaliDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" className="w-40" />
        <div className="mr-auto flex flex-wrap gap-1.5">
          {totals.USD > 0 && <span className="chip num">جمع دلار: {formatMoney(totals.USD, "USD")}</span>}
          {totals.IRT > 0 && <span className="chip num">جمع تومان: {formatMoney(totals.IRT, "IRT")}</span>}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        loading={payments === undefined}
        initialSort={{ key: "date", dir: "desc" }}
        empty={
          <EmptyState
            icon={Banknote}
            title="پرداختی ثبت نشده"
            description="پرداخت‌های نمایندگان را همراه با ارز و تاریخ ثبت کنید"
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
                <Plus size={15} /> ثبت پرداخت
              </button>
            }
          />
        }
        footer={`${toPersianDigits(filtered.length)} پرداخت`}
      />

      <PaymentFormModal
        open={addOpen || editing != null}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
        }}
        payment={editing ?? undefined}
      />

      <AttachmentPreview attachment={previewReceipt} onClose={() => setPreviewReceipt(null)} />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="گزارش پرداخت‌ها"
        rows={filtered.map((p) => ({
          customerId: (() => {
            const r = (requests ?? []).find((x) => x.id === p.requestId);
            return r?.customerId ?? "";
          })(),
          date: formatJalali(p.date),
          representative: representatives?.find((r) => r.id === p.representativeId)?.name ?? "",
          amount: p.amount,
          currency: p.currency === "USD" ? "دلار" : "تومان",
          request: (() => {
            const r = (requests ?? []).find((x) => x.id === p.requestId);
            if (!r) return "";
            const c = customers?.find((x) => x.id === r.customerId);
            return c ? customerFullName(c) : "";
          })(),
          description: p.description ?? "",
        }))}
        defaultFilename="payments-report"
        summary={[
          { label: "تعداد", value: toPersianDigits(filtered.length) },
          { label: "جمع دلار", value: formatMoney(totals.USD, "USD") },
          { label: "جمع تومان", value: formatMoney(totals.IRT, "IRT") },
        ]}
        columns={[
          { key: "date", header: "تاریخ" },
          { key: "representative", header: "نماینده" },
          { key: "amount", header: "مبلغ" },
          { key: "currency", header: "ارز" },
          { key: "request", header: "درخواست مرتبط" },
          { key: "description", header: "توضیحات" },
        ]}
        grouping={{
          columnKey: "representative",
          label: "نماینده",
          photos: Object.fromEntries(
            (representatives ?? []).map((r) => [r.name, r.photo ?? undefined]),
          ),
        }}
        rowPhotos={{
          columnKey: "request",
          idKey: "customerId",
          photos: Object.fromEntries(
            (customers ?? []).map((c) => [c.id, c.photo ?? undefined]),
          ),
        }}
      />
    </div>
  );
}
