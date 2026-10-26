/** All transactions with rich filters, detail dialog, reverse/cancel actions
 *  and full export (XLSX / CSV / PDF / PNG). */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban,
  FileDown,
  History,
  MoreVertical,
  Pencil,
  Plus,
  Receipt,
  Undo2,
} from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { Modal } from "../../components/ui/Modal";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterSelect, SearchBox } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatJalali } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import { reverseTransaction, cancelInformationalTx } from "../../accounting/repo";
import {
  TX_TYPE_LABELS,
  type FinTransaction,
} from "../../accounting/types";
import {
  useAccAccounts,
  useAccParties,
  useAccTransactions,
} from "../../accounting/hooks";
import {
  InformationalBadge,
  SignedAmount,
  TxStatusPill,
  TxTypePill,
} from "../../accounting/components/Bits";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";

export function AccTransactionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const transactions = useAccTransactions();
  const parties = useAccParties();
  const accounts = useAccAccounts();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [effectFilter, setEffectFilter] = useState("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const [detail, setDetail] = useState<FinTransaction | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editTx, setEditTx] = useState<FinTransaction | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const partyName = (id?: string | null) => (parties ?? []).find((p) => p.id === id)?.name ?? "—";
  const accountName = (id?: string | null) => (accounts ?? []).find((a) => a.id === id)?.name ?? "";

  const rows = useMemo(() => {
    let list = [...(transactions ?? [])].sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    );
    if (typeFilter !== "all") list = list.filter((t) => t.type === typeFilter);
    if (currencyFilter !== "all") list = list.filter((t) => t.currency === currencyFilter);
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (effectFilter !== "all") list = list.filter((t) => (effectFilter === "real" ? t.affectsBalance : !t.affectsBalance));
    if (partyFilter !== "all") list = list.filter((t) => t.partyId === partyFilter);
    if (fromDate) list = list.filter((t) => t.date >= fromDate);
    if (toDate) list = list.filter((t) => t.date <= toDate);
    const q = query.trim();
    if (q) {
      list = list.filter((t) =>
        `${t.number} ${t.description ?? ""} ${t.reference ?? ""} ${t.category ?? ""} ${t.partyId ? partyName(t.partyId) : ""}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      );
    }
    return list;
  }, [transactions, query, typeFilter, currencyFilter, statusFilter, effectFilter, partyFilter, fromDate, toDate, parties]);

  const canEdit = (tx: FinTransaction) =>
    tx.status === "final" && !tx.reversedBy && !tx.reversalOf;

  const doReverse = async (tx: FinTransaction) => {
    const reason = window.prompt(`دلیل برگشت تراکنش ${tx.number} (الزامی):`);
    if (reason == null) return;
    if (!reason.trim()) {
      toast.error("دلیل برگشت الزامی است.");
      return;
    }
    try {
      const counter = await reverseTransaction(tx.id, reason);
      toast.success(`تراکنش با ${counter.number} خنثی شد`);
      setDetail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "برگشت ناموفق بود.");
    }
  };

  const doCancel = async (tx: FinTransaction) => {
    const reason = window.prompt(`دلیل ابطال رکورد ${tx.number} (الزامی):`);
    if (reason == null) return;
    if (!reason.trim()) {
      toast.error("دلیل ابطال الزامی است.");
      return;
    }
    try {
      await cancelInformationalTx(tx.id, reason);
      toast.success("رکورد اطلاعاتی ابطال شد");
      setDetail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ابطال ناموفق بود.");
    }
  };

  const columns: Column<FinTransaction>[] = [
    {
      key: "date",
      header: "تاریخ",
      sortValue: (t) => t.date,
      render: (t) => <span className="num text-xs text-ink-500 dark:text-ink-400">{formatJalali(t.date)}</span>,
    },
    {
      key: "number",
      header: "شماره",
      sortValue: (t) => t.number,
      render: (t) => <span className="num text-xs font-bold">{t.number}</span>,
    },
    { key: "type", header: "نوع", align: "center", render: (t) => <TxTypePill type={t.type} /> },
    {
      key: "party",
      header: "طرف حساب",
      sortValue: (t) => (t.partyId ? partyName(t.partyId) : ""),
      render: (t) => <span className="text-xs font-semibold">{t.partyId ? partyName(t.partyId) : "—"}</span>,
    },
    {
      key: "amount",
      header: "مبلغ",
      align: "center",
      sortValue: (t) => t.amount,
      render: (t) => (
        <SignedAmount
          amount={t.amount}
          currency={t.currency}
          direction={
            t.status !== "final"
              ? "flat"
              : t.type === "receipt" || t.type === "opening"
                ? "in"
                : t.type === "payment" || t.type === "withdrawal"
                  ? "out"
                  : "flat"
          }
        />
      ),
    },
    {
      key: "accounts",
      header: "صندوق / حساب",
      render: (t) => (
        <span className="num flex flex-col text-[11px] text-ink-500 dark:text-ink-400">
          {t.sourceAccountId && <span>از: {accountName(t.sourceAccountId)}</span>}
          {t.destAccountId && <span>به: {accountName(t.destAccountId)}</span>}
          {!t.sourceAccountId && !t.destAccountId && <span>—</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: "وضعیت",
      align: "center",
      render: (t) => (
        <span className="flex flex-wrap items-center justify-center gap-1.5">
          <TxStatusPill status={t.status} />
          {!t.affectsBalance && <InformationalBadge />}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "center",
      render: (t) => (
        <Menu
          trigger={<IconButton icon={MoreVertical} label="عملیات" size={16} />}
          items={[
            { label: "جزئیات", onClick: () => setDetail(t) },
            ...(canEdit(t)
              ? [
                  { label: "ویرایش", icon: Pencil, onClick: () => setEditTx(t) },
                  ...(t.affectsBalance
                    ? [{ label: "برگشت تراکنش", icon: Undo2, onClick: () => void doReverse(t) }]
                    : [{ label: "ابطال رکورد", icon: Ban, onClick: () => void doCancel(t) }]),
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  const exportColumns = [
    { key: "date", header: "تاریخ" },
    { key: "number", header: "شماره تراکنش" },
    { key: "type", header: "نوع" },
    { key: "party", header: "طرف حساب" },
    { key: "amount", header: "مبلغ" },
    { key: "currency", header: "ارز" },
    { key: "fromAccount", header: "از حساب" },
    { key: "toAccount", header: "به حساب" },
    { key: "status", header: "وضعیت" },
    { key: "reference", header: "مرجع" },
    { key: "description", header: "شرح" },
  ];

  const exportRows = rows.map((t) => ({
    date: formatJalali(t.date),
    number: t.number,
    type: TX_TYPE_LABELS[t.type],
    party: t.partyId ? partyName(t.partyId) : "",
    amount: t.amount.toLocaleString("fa-IR"),
    currency: t.currency === "USD" ? "دلار" : "تومان",
    fromAccount: t.sourceAccountId ? accountName(t.sourceAccountId) : "",
    toAccount: t.destAccountId ? accountName(t.destAccountId) : "",
    status: t.status === "final" ? (t.affectsBalance ? "قطعی" : "قطعی - فقط ثبت") : t.status === "reversed" ? "برگشت خورده" : "ابطال شده",
    reference: t.reference ?? "",
    description: t.description ?? "",
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="جستجوی شماره، شرح، مرجع…"
          className="min-w-[200px] flex-1"
        />
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          ariaLabel="نوع"
          options={[
            { value: "all", label: "همه انواع" },
            ...Object.entries(TX_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
        <FilterSelect
          value={currencyFilter}
          onChange={setCurrencyFilter}
          ariaLabel="ارز"
          options={[
            { value: "all", label: "هر دو ارز" },
            { value: "IRT", label: "تومان" },
            { value: "USD", label: "دلار" },
          ]}
        />
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
        <FilterSelect
          value={effectFilter}
          onChange={setEffectFilter}
          ariaLabel="تأثیر بر مانده"
          options={[
            { value: "all", label: "واقعی + اطلاعاتی" },
            { value: "real", label: "فقط واقعی" },
            { value: "info", label: "فقط اطلاعاتی" },
          ]}
        />
        <FilterSelect
          value={partyFilter}
          onChange={setPartyFilter}
          ariaLabel="طرف حساب"
          options={[
            { value: "all", label: "همه طرف حساب‌ها" },
            ...(parties ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <div className="flex items-center gap-1.5">
          <JalaliDatePicker value={fromDate} onChange={setFromDate} placeholder="از تاریخ" />
          <JalaliDatePicker value={toDate} onChange={setToDate} placeholder="تا تاریخ" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500 dark:text-ink-400">
          {rows.length.toLocaleString("fa-IR")} تراکنش
          {fromDate || toDate ? " در بازه انتخابی" : ""}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="glass" icon={FileDown} onClick={() => setExportOpen(true)}>
            خروجی
          </Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
            تراکنش جدید
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        onRowClick={(t) => setDetail(t)}
        loading={!transactions}
        empty={
          <EmptyState
            icon={Receipt}
            title="تراکنشی یافت نشد"
            description="با تغییر فیلترها جستجو کنید یا اولین تراکنش را ثبت نمایید."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
                تراکنش جدید
              </Button>
            }
          />
        }
        mobileCard={(t) => (
          <div className="glass flex flex-col gap-2 rounded-2xl p-3.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="num font-bold">{t.number}</span>
              <TxTypePill type={t.type} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-400">{t.partyId ? partyName(t.partyId) : "—"}</span>
              <span className="num">{formatJalali(t.date)}</span>
            </div>
            <div className="flex items-center justify-between">
              <SignedAmount
                amount={t.amount}
                currency={t.currency}
                direction={
                  t.status !== "final"
                    ? "flat"
                    : t.type === "receipt" || t.type === "opening"
                      ? "in"
                      : t.type === "payment" || t.type === "withdrawal"
                        ? "out"
                        : "flat"
                }
              />
              <TxStatusPill status={t.status} />
            </div>
          </div>
        )}
      />

      {/* Detail dialog */}
      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `تراکنش ${detail.number}` : ""}
        subtitle={detail ? TX_TYPE_LABELS[detail.type] : undefined}
        size="md"
        footer={
          detail && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>
                بستن
              </button>
              <div className="flex gap-2">
                {canEdit(detail) && (
                  <Button size="sm" variant="glass" icon={Pencil} onClick={() => { setEditTx(detail); setDetail(null); }}>
                    ویرایش
                  </Button>
                )}
                {canEdit(detail) &&
                  (detail.affectsBalance ? (
                    <Button size="sm" variant="danger-soft" icon={Undo2} onClick={() => void doReverse(detail)}>
                      برگشت تراکنش
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger-soft" icon={Ban} onClick={() => void doCancel(detail)}>
                      ابطال رکورد
                    </Button>
                  ))}
              </div>
            </div>
          )
        }
      >
        {detail && (
          <div className="flex flex-col gap-2.5 text-[13px]">
            <DetailRow label="نوع" value={<TxTypePill type={detail.type} />} />
            <DetailRow label="مبلغ" value={<SignedAmount amount={detail.amount} currency={detail.currency} direction={detail.type === "receipt" || detail.type === "opening" ? "in" : detail.type === "payment" || detail.type === "withdrawal" ? "out" : "flat"} />} />
            {detail.type === "exchange" && detail.destAmount != null && detail.destCurrency && (
              <DetailRow label="مبلغ مقصد" value={formatMoney(detail.destAmount, detail.destCurrency)} />
            )}
            {detail.type === "exchange" && detail.exchangeRate != null && (
              <DetailRow label="نرخ تبدیل" value={`${detail.exchangeRate.toLocaleString("fa-IR")} تومان بر دلار`} />
            )}
            <DetailRow label="تاریخ" value={formatJalali(detail.date)} />
            <DetailRow label="طرف حساب" value={detail.partyId ? partyName(detail.partyId) : "—"} />
            {detail.sourceAccountId && <DetailRow label="از حساب" value={accountName(detail.sourceAccountId)} />}
            {detail.destAccountId && <DetailRow label="به حساب" value={accountName(detail.destAccountId)} />}
            <DetailRow label="وضعیت" value={<TxStatusPill status={detail.status} />} />
            <DetailRow label="تأثیر بر مانده" value={detail.affectsBalance ? "واقعی — تغییر مانده" : "فقط ثبت اطلاعاتی"} />
            {detail.category && <DetailRow label="دسته" value={detail.category} />}
            {detail.reference && <DetailRow label="مرجع" value={detail.reference} />}
            {detail.description && <DetailRow label="شرح" value={detail.description} />}
            {detail.reason && <DetailRow label="دلیل" value={detail.reason} />}
            {detail.reversedBy && (
              <DetailRow
                label="خنثی‌شده با"
                value={
                  <button
                    className="num font-bold text-brand-600 dark:text-brand-300"
                    onClick={() => {
                      const counter = (transactions ?? []).find((t) => t.id === detail.reversedBy);
                      if (counter) setDetail(counter);
                    }}
                  >
                    {(transactions ?? []).find((t) => t.id === detail.reversedBy)?.number ?? "—"}
                  </button>
                }
              />
            )}
            {detail.reversalOf && (
              <DetailRow
                label="برگشتِ تراکنش"
                value={
                  <button
                    className="num font-bold text-brand-600 dark:text-brand-300"
                    onClick={() => {
                      const original = (transactions ?? []).find((t) => t.id === detail.reversalOf);
                      if (original) setDetail(original);
                    }}
                  >
                    {(transactions ?? []).find((t) => t.id === detail.reversalOf)?.number ?? "—"}
                  </button>
                }
              />
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">
              <History size={12} />
              ثبت: {new Date(detail.createdAt).toLocaleString("fa-IR")} · آخرین تغییر:{" "}
              {new Date(detail.updatedAt).toLocaleString("fa-IR")}
            </div>
          </div>
        )}
      </Modal>

      <TransactionFormModal open={newOpen} onClose={() => setNewOpen(false)} />
      <TransactionFormModal
        open={editTx != null}
        onClose={() => setEditTx(null)}
        editTx={editTx}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="لیست تراکنش‌های حسابداری"
        subtitle="با فیلترهای فعلی"
        columns={exportColumns}
        rows={exportRows}
        defaultFilename="acc-transactions"
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/40 px-3 py-2 dark:bg-white/[0.04]">
      <span className="shrink-0 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</span>
      <span className="min-w-0 text-left text-xs font-bold">{value}</span>
    </div>
  );
}
