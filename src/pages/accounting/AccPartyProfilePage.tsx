/** Individual party profile — financial overview, full statement with running
 *  balance, outstanding items, documents, notes and audit history. */

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  FileDown,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  Scale,
} from "lucide-react";
import { PageHeader, StatCard } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { Tabs } from "../../components/ui/Tabs";
import { ListSkeleton } from "../../components/ui/EmptyState";
import { ActivityFeed } from "../../components/ui/ActivityFeed";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { formatJalali } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import {
  buildStatementRows,
  computePartyTotals,
  outstandingEffectiveStatus,
  outstandingRemaining,
} from "../../accounting/engine";
import {
  OUTSTANDING_KIND_LABELS,
  PARTY_TYPE_LABELS,
  TX_TYPE_LABELS,
} from "../../accounting/types";
import {
  useAccDocsFor,
  useAccOutstanding,
  useAccParty,
  useAccTransactions,
} from "../../accounting/hooks";
import {
  InformationalBadge,
  OutstandingStatusPill,
  PartyAvatar,
  SignedAmount,
  TxStatusPill,
  TxTypePill,
} from "../../accounting/components/Bits";
import { PartyFormModal } from "../../accounting/components/PartyFormModal";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";
import { useActivities } from "../../hooks/useData";

export function AccPartyProfilePage() {
  const { id } = useParams<{ id: string }>();
  const party = useAccParty(id);
  const transactions = useAccTransactions();
  const outstanding = useAccOutstanding();
  const docs = useAccDocsFor({ partyId: id });
  const activities = useActivities(30, id);

  const [editOpen, setEditOpen] = useState(false);
  const [txModal, setTxModal] = useState<null | "receipt" | "payment">(null);
  const [exportOpen, setExportOpen] = useState(false);

  const totals = useMemo(
    () => (party && transactions ? computePartyTotals(party.id, transactions) : null),
    [party, transactions],
  );

  const statement = useMemo(
    () => (party && transactions ? buildStatementRows(party.id, transactions) : null),
    [party, transactions],
  );

  const items = useMemo(
    () => (party && outstanding ? outstanding.filter((o) => o.partyId === party.id) : []),
    [party, outstanding],
  );

  if (!party) {
    return <ListSkeleton rows={5} />;
  }

  const statementColumns = [
    { key: "date", header: "تاریخ" },
    { key: "number", header: "شماره" },
    { key: "type", header: "نوع" },
    { key: "description", header: "شرح" },
    { key: "deposit", header: "بستانکار (دریافت)" },
    { key: "withdraw", header: "بدهکار (پرداخت)" },
    { key: "running", header: "مانده گردشی" },
  ];

  const statementRows = (statement?.rows ?? []).map((row) => ({
    date: formatJalali(row.tx.date),
    number: row.tx.number,
    type: TX_TYPE_LABELS[row.tx.type],
    description:
      (row.tx.description ?? "") + (row.tx.status !== "final" ? ` (${row.tx.status === "reversed" ? "برگشت خورده" : "ابطال شده"})` : ""),
    deposit: row.signedMinor > 0 ? formatMoney(row.tx.amount, row.tx.currency) : "",
    withdraw: row.signedMinor < 0 ? formatMoney(row.tx.amount, row.tx.currency) : "",
    running: `${formatMoney(row.running.IRT, "IRT")} | ${formatMoney(row.running.USD, "USD")}`,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back
        title={party.name}
        subtitle={`${party.code} — ${PARTY_TYPE_LABELS[party.type]}${party.active ? "" : " (غیرفعال)"}`}
        actions={
          <>
            <Button size="sm" variant="glass" icon={FileDown} onClick={() => setExportOpen(true)}>
              صورتحساب
            </Button>
            <Button size="sm" variant="glass" icon={ArrowDownLeft} onClick={() => setTxModal("receipt")}>
              دریافت
            </Button>
            <Button size="sm" variant="glass" icon={ArrowUpRight} onClick={() => setTxModal("payment")}>
              پرداخت
            </Button>
            <Button size="sm" variant="glass" icon={Pencil} onClick={() => setEditOpen(true)}>
              ویرایش
            </Button>
          </>
        }
      />

      {/* Contact strip */}
      <div className="glass flex flex-wrap items-center gap-4 rounded-3xl p-4">
        <PartyAvatar name={party.name} type={party.type} size={56} />
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {party.phone && (
            <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400">
              <Phone size={13} /> <span className="num" dir="ltr">{party.phone}</span>
            </span>
          )}
          {party.email && (
            <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400">
              <Mail size={13} /> <span dir="ltr">{party.email}</span>
            </span>
          )}
          {party.address && (
            <span className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400">
              <MapPin size={13} /> {party.address}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-ink-400">
            <Receipt size={13} /> عضویت از {formatJalali(new Date(party.createdAt).toISOString().slice(0, 10))}
          </span>
        </div>
        {party.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {party.tags.map((t) => (
              <span key={t} className="rounded-full bg-brand-500/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 dark:text-brand-300">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Financial overview */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={ArrowDownLeft}
          tone="success"
          label="جمع دریافت‌ها"
          value={
            totals ? (
              <span className="flex flex-col leading-6">
                <span>{formatMoney(totals.receipts.IRT, "IRT")}</span>
                <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(totals.receipts.USD, "USD")}</span>
              </span>
            ) : "…"
          }
        />
        <StatCard
          icon={ArrowUpRight}
          tone="danger"
          label="جمع پرداخت‌ها"
          value={
            totals ? (
              <span className="flex flex-col leading-6">
                <span>{formatMoney(totals.payments.IRT, "IRT")}</span>
                <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(totals.payments.USD, "USD")}</span>
              </span>
            ) : "…"
          }
        />
        <StatCard
          icon={Banknote}
          tone="warning"
          label="جمع برداشت‌ها"
          value={
            totals ? (
              <span className="flex flex-col leading-6">
                <span>{formatMoney(totals.withdrawals.IRT, "IRT")}</span>
                <span className="text-[13px] text-ink-500 dark:text-ink-400">{formatMoney(totals.withdrawals.USD, "USD")}</span>
              </span>
            ) : "…"
          }
        />
        <StatCard
          icon={Scale}
          tone="brand"
          label="حرکت خالص (دریافت − پرداخت)"
          value={
            totals ? (
              <span className="flex flex-col leading-6">
                <span className={totals.net.IRT >= 0 ? "text-[#0b9e6e] dark:text-[#3ddc9a]" : "text-[#dc3535] dark:text-[#f87b7b]"}>
                  {formatMoney(totals.net.IRT, "IRT")}
                </span>
                <span className={`text-[13px] ${totals.net.USD >= 0 ? "text-[#0b9e6e] dark:text-[#3ddc9a]" : "text-[#dc3535] dark:text-[#f87b7b]"}`}>
                  {formatMoney(totals.net.USD, "USD")}
                </span>
              </span>
            ) : "…"
          }
          hint={totals ? `${totals.count.toLocaleString("fa-IR")} تراکنش` : undefined}
        />
      </div>

      <Tabs
        tabs={[
          {
            key: "statement",
            label: "گردش تراکنش‌ها",
            badge: statement?.rows.length,
            content: (
              <div className="flex flex-col gap-1.5">
                {(statement?.rows ?? []).length === 0 && (
                  <p className="py-8 text-center text-xs text-ink-400">
                    هنوز تراکنشی برای این حساب ثبت نشده است.
                  </p>
                )}
                {(statement?.rows ?? []).map((row) => (
                  <div
                    key={row.tx.id}
                    className="glass flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs"
                  >
                    <span className="num shrink-0 text-ink-400">{formatJalali(row.tx.date)}</span>
                    <span className="num shrink-0 font-bold text-ink-500 dark:text-ink-400">{row.tx.number}</span>
                    <TxTypePill type={row.tx.type} />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {row.tx.description || "—"}
                    </span>
                    {row.tx.status === "final" ? (
                      <SignedAmount
                        amount={row.tx.amount}
                        currency={row.tx.currency}
                        direction={row.signedMinor > 0 ? "in" : row.signedMinor < 0 ? "out" : "flat"}
                      />
                    ) : (
                      <TxStatusPill status={row.tx.status} />
                    )}
                    {!row.tx.affectsBalance && <InformationalBadge />}
                  </div>
                ))}
                {statement && statement.rows.length > 0 && (
                  <div className="glass mt-1 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-xs font-bold">
                    <span>مانده پایانی</span>
                    <span className="num flex gap-4">
                      <span>{formatMoney(statement.closing.IRT, "IRT")}</span>
                      <span>{formatMoney(statement.closing.USD, "USD")}</span>
                    </span>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "outstanding",
            label: "مطالبات و بدهی‌ها",
            badge: items.filter((o) => o.status !== "settled" && o.status !== "cancelled").length,
            content: (
              <div className="flex flex-col gap-2">
                {items.length === 0 && (
                  <p className="py-8 text-center text-xs text-ink-400">
                    مانده باز یا تسویه‌شده‌ای برای این حساب ثبت نشده است.
                  </p>
                )}
                {items.map((o) => (
                  <div key={o.id} className="glass flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-xs">
                    <span className="font-bold">{OUTSTANDING_KIND_LABELS[o.kind]}</span>
                    <span className="num font-bold">{formatMoney(o.amount, o.currency)}</span>
                    <span className="text-ink-400">
                      مانده: <span className="num font-bold">{formatMoney(outstandingRemaining(o), o.currency)}</span>
                    </span>
                    {o.dueDate && (
                      <span className="num text-ink-500 dark:text-ink-400">سررسید: {formatJalali(o.dueDate)}</span>
                    )}
                    <OutstandingStatusPill status={outstandingEffectiveStatus(o, new Date().toISOString().slice(0, 10))} />
                    {o.settlements.length > 0 && (
                      <span className="num text-ink-400">{o.settlements.length.toLocaleString("fa-IR")} تسویه</span>
                    )}
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "docs",
            label: "اسناد",
            badge: docs?.length,
            content: (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {(docs ?? []).length === 0 && (
                  <p className="col-span-full py-8 text-center text-xs text-ink-400">
                    سندی برای این حساب بارگذاری نشده است. از فرم تراکنش یا بخش اسناد می‌توانید پیوست اضافه کنید.
                  </p>
                )}
                {(docs ?? []).map((doc) => (
                  <div key={doc.id} className="glass flex flex-col gap-1.5 rounded-2xl p-3 text-[11px]">
                    <span className="truncate font-bold">{doc.name}</span>
                    <span className="text-ink-400">{doc.category ?? "سند"}</span>
                    <a
                      className="font-bold text-brand-600 dark:text-brand-300"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        const url = URL.createObjectURL(doc.blob);
                        window.open(url, "_blank");
                        setTimeout(() => URL.revokeObjectURL(url), 30000);
                      }}
                    >
                      مشاهده
                    </a>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "notes",
            label: "یادداشت",
            content: (
              <div className="glass rounded-3xl p-4 text-[13px] leading-7">
                {party.notes ? party.notes : <span className="text-ink-400">یادداشتی ثبت نشده است.</span>}
                {party.idNumber && (
                  <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                    {party.type === "company" ? "شناسه ملی" : "کد ملی"}: <span className="num" dir="ltr">{party.idNumber}</span>
                  </p>
                )}
                {party.regNumber && (
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    شماره ثبت: <span className="num" dir="ltr">{party.regNumber}</span>
                  </p>
                )}
              </div>
            ),
          },
          {
            key: "audit",
            label: "حسابرسی",
            content: <ActivityFeed activities={activities ?? []} />,
          },
        ]}
      />

      <PartyFormModal open={editOpen} onClose={() => setEditOpen(false)} editParty={party} />
      <TransactionFormModal
        open={txModal != null}
        onClose={() => setTxModal(null)}
        initial={{ partyId: party.id, type: txModal ?? "receipt" }}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`صورتحساب ${party.name}`}
        subtitle={`${party.code} — ${PARTY_TYPE_LABELS[party.type]}`}
        columns={statementColumns}
        rows={statementRows}
        defaultFilename={`statement-${party.code}`}
        summary={
          statement
            ? [
                { label: "جمع دریافت (تومان)", value: formatMoney(totals?.receipts.IRT ?? 0, "IRT") },
                { label: "جمع پرداخت (تومان)", value: formatMoney(totals?.payments.IRT ?? 0, "IRT") },
                { label: "جمع دریافت (دلار)", value: formatMoney(totals?.receipts.USD ?? 0, "USD") },
                { label: "جمع پرداخت (دلار)", value: formatMoney(totals?.payments.USD ?? 0, "USD") },
                { label: "مانده پایانی (تومان)", value: formatMoney(statement.closing.IRT, "IRT") },
                { label: "مانده پایانی (دلار)", value: formatMoney(statement.closing.USD, "USD") },
              ]
            : undefined
        }
      />
    </div>
  );
}
