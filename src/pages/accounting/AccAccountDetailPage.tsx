/** Single managed account: derived balance, full statement with running
 *  balance, reconciliation, and statement export. */

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCheck,
  FileDown,
  Pencil,
  Wallet,
} from "lucide-react";
import { PageHeader, StatCard } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { Tabs } from "../../components/ui/Tabs";
import { ListSkeleton } from "../../components/ui/EmptyState";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { currencyLabel } from "../../types";
import { formatJalali, todayIso } from "../../utils/jalali";
import { formatMoney, fromMinor, sumAmounts } from "../../utils/num";
import { computeAccountBalance, txEffects } from "../../accounting/engine";
import { ACCOUNT_TYPE_LABELS, TX_TYPE_LABELS } from "../../accounting/types";
import { useAccAccount, useAccAccounts, useAccTransactions } from "../../accounting/hooks";
import {
  FinAccountFormModal,
} from "../../accounting/components/FinAccountFormModal";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";
import { ReconcileModal } from "../../accounting/components/OutstandingModals";
import { InformationalBadge, TxTypePill } from "../../accounting/components/Bits";

export function AccAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const account = useAccAccount(id);
  const allTx = useAccTransactions();
  const accounts = useAccAccounts();

  const [editOpen, setEditOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [txModal, setTxModal] = useState<null | "receipt" | "payment" | "transfer">(null);
  const [exportOpen, setExportOpen] = useState(false);

  /** All transactions touching this account, newest first. */
  const accountTx = useMemo(() => {
    if (!id || !allTx) return [];
    return allTx
      .filter((t) => txEffects(t).some((e) => e.accountId === id))
      .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  }, [allTx, id]);

  /** Statement rows with a running balance in minor units of the account currency. */
  const statementRows = useMemo(() => {
    if (!account) return [];
    const rows: {
      tx: (typeof accountTx)[number];
      delta: number;
      running: number;
    }[] = [];
    let running = 0;
    for (const tx of accountTx) {
      const effect = txEffects(tx).find((e) => e.accountId === account.id);
      if (!effect) continue;
      running += effect.minor;
      rows.push({ tx, delta: effect.minor, running });
    }
    return rows.reverse(); // newest first for display
  }, [accountTx, account]);

  const balance = useMemo(
    () => (account && allTx ? computeAccountBalance(account, allTx) : null),
    [account, allTx],
  );

  const inflow = useMemo(() => {
    if (!account) return 0;
    return sumAmounts(
      statementRows.filter((r) => r.delta > 0).map((r) => r.tx.amount),
      account.currency,
    );
  }, [statementRows, account]);

  const outflow = useMemo(() => {
    if (!account) return 0;
    return sumAmounts(
      statementRows.filter((r) => r.delta < 0).map((r) => r.tx.amount),
      account.currency,
    );
  }, [statementRows, account]);

  if (!account) return <ListSkeleton rows={5} />;

  const toMajor = (minor: number) =>
    fromMinor(minor, account.currency);

  const exportColumns = [
    { key: "date", header: "تاریخ" },
    { key: "number", header: "شماره" },
    { key: "type", header: "نوع" },
    { key: "description", header: "شرح" },
    { key: "deposit", header: "واریز" },
    { key: "withdraw", header: "برداشت" },
    { key: "running", header: "مانده" },
  ];

  const exportRows = statementRows.map((r) => ({
    date: formatJalali(r.tx.date),
    number: r.tx.number,
    type: TX_TYPE_LABELS[r.tx.type],
    description: r.tx.description ?? "",
    deposit: r.delta > 0 ? r.tx.amount.toLocaleString("fa-IR") : "",
    withdraw: r.delta < 0 ? r.tx.amount.toLocaleString("fa-IR") : "",
    running: toMajor(r.running).toLocaleString("fa-IR"),
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back
        icon={Wallet}
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABELS[account.type]} — ${currencyLabel(account.currency)}${account.active ? "" : " (غیرفعال)"}`}
        actions={
          <>
            <Button size="sm" variant="glass" icon={FileDown} onClick={() => setExportOpen(true)}>
              صورتحساب
            </Button>
            <Button size="sm" variant="glass" icon={CheckCheck} onClick={() => setReconcileOpen(true)}>
              تطبیق مانده
            </Button>
            <Button size="sm" variant="glass" icon={ArrowDownLeft} onClick={() => setTxModal("receipt")}>
              واریز
            </Button>
            <Button size="sm" variant="glass" icon={ArrowUpRight} onClick={() => setTxModal("payment")}>
              برداشت/پرداخت
            </Button>
            <Button size="sm" variant="glass" icon={ArrowLeftRight} onClick={() => setTxModal("transfer")}>
              انتقال
            </Button>
            <Button size="sm" variant="glass" icon={Pencil} onClick={() => setEditOpen(true)}>
              ویرایش
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          tone="brand"
          label="مانده فعلی"
          value={formatMoney(balance?.balance ?? 0, account.currency)}
          hint={`${(balance?.txCount ?? 0).toLocaleString("fa-IR")} تراکنش مؤثر`}
        />
        <StatCard
          icon={ArrowDownLeft}
          tone="success"
          label="جمع ورودی‌ها"
          value={formatMoney(inflow, account.currency)}
        />
        <StatCard
          icon={ArrowUpRight}
          tone="danger"
          label="جمع خروجی‌ها"
          value={formatMoney(outflow, account.currency)}
        />
        <StatCard
          icon={CheckCheck}
          tone="neutral"
          label="آخرین تطبیق"
          value="—" // Adjustments appear in the statement as تعدیل entries
          hint="تعدیل‌ها در گردش با برچسب «تعدیل» دیده می‌شوند"
        />
      </div>

      <Tabs
        tabs={[
          {
            key: "statement",
            label: "صورتحساب حساب",
            badge: statementRows.length,
            content: (
              <div className="flex flex-col gap-1.5">
                {statementRows.length === 0 && (
                  <p className="py-8 text-center text-xs text-ink-400">
                    هنوز تراکنشی روی این حساب ثبت نشده است.
                  </p>
                )}
                {statementRows.map((r) => (
                  <div
                    key={r.tx.id}
                    className="glass flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs"
                  >
                    <span className="num shrink-0 text-ink-400">{formatJalali(r.tx.date)}</span>
                    <span className="num shrink-0 font-bold text-ink-500 dark:text-ink-400">{r.tx.number}</span>
                    <TxTypePill type={r.tx.type} />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {r.tx.description || TX_TYPE_LABELS[r.tx.type]}
                    </span>
                    <span
                      className={`num shrink-0 font-bold ${
                        r.delta > 0
                          ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
                          : "text-[#dc3535] dark:text-[#f87b7b]"
                      }`}
                    >
                      {r.delta > 0 ? "+" : "−"}
                      {formatMoney(r.tx.amount, account.currency)}
                    </span>
                    <span className="num shrink-0 rounded-lg bg-white/50 px-2 py-1 text-[11px] font-bold dark:bg-white/8">
                      {formatMoney(toMajor(r.running), account.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "info",
            label: "مشخصات",
            content: (
              <div className="glass flex flex-col gap-2 rounded-3xl p-4 text-[13px]">
                <p>
                  <span className="text-ink-500 dark:text-ink-400">نوع: </span>
                  <span className="font-bold">{ACCOUNT_TYPE_LABELS[account.type]}</span>
                </p>
                <p>
                  <span className="text-ink-500 dark:text-ink-400">ارز: </span>
                  <span className="font-bold">{currencyLabel(account.currency)}</span>
                </p>
                {account.description && (
                  <p>
                    <span className="text-ink-500 dark:text-ink-400">توضیحات: </span>
                    {account.description}
                  </p>
                )}
                <p>
                  <span className="text-ink-500 dark:text-ink-400">تاریخ ایجاد: </span>
                  <span className="num">{formatJalali(new Date(account.createdAt).toISOString().slice(0, 10))}</span>
                </p>
                <p className="text-[11px] leading-6 text-ink-400">
                  مانده این حساب هیچ‌وقت دستی ویرایش نمی‌شود؛ همیشه از مجموع تراکنش‌های قطعی محاسبه می‌شود و
                  اصلاح آن فقط از راه «تطبیق مانده» و با تراکنش تعدیلِ قابل حسابرسی انجام می‌شود.
                </p>
              </div>
            ),
          },
        ]}
      />

      <FinAccountFormModal open={editOpen} onClose={() => setEditOpen(false)} editAccount={account} />
      <ReconcileModal open={reconcileOpen} onClose={() => setReconcileOpen(false)} account={account} />
      <TransactionFormModal
        open={txModal != null}
        onClose={() => setTxModal(null)}
        initial={{
          type: txModal ?? "receipt",
          currency: account.currency,
          ...(txModal === "receipt"
            ? { destAccountId: account.id }
            : txModal === "payment"
              ? { sourceAccountId: account.id }
              : {}),
        }}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`صورتحساب ${account.name}`}
        subtitle={`${ACCOUNT_TYPE_LABELS[account.type]} — ${currencyLabel(account.currency)}`}
        columns={exportColumns}
        rows={exportRows}
        defaultFilename={`account-statement-${account.name.replace(/\s+/g, "-")}`}
        summary={[
          { label: "مانده فعلی", value: formatMoney(balance?.balance ?? 0, account.currency) },
          { label: "جمع ورودی", value: formatMoney(inflow, account.currency) },
          { label: "جمع خروجی", value: formatMoney(outflow, account.currency) },
          { label: "تعداد تراکنش", value: statementRows.length.toLocaleString("fa-IR") },
        ]}
        theme="acc"
      />
    </div>
  );
}
