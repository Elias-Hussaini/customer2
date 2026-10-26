/** Managed cash boxes & bank accounts — balances always derived from
 *  transactions, never hand-edited. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Banknote,
  CheckCheck,
  Landmark,
  MoreVertical,
  Plus,
  Wallet,
} from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatMoney } from "../../utils/num";
import { computeAllAccountBalances } from "../../accounting/engine";
import { deleteOrDeactivateAccount } from "../../accounting/repo";
import {
  ACCOUNT_TYPE_LABELS,
  type FinAccount,
} from "../../accounting/types";
import { useAccAccounts, useAccTransactions } from "../../accounting/hooks";
import { FinAccountFormModal } from "../../accounting/components/FinAccountFormModal";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";

export function AccAccountsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const accounts = useAccAccounts();
  const transactions = useAccTransactions();

  const [formOpen, setFormOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<FinAccount | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [depositFor, setDepositFor] = useState<FinAccount | null>(null);

  const balances = useMemo(
    () => (accounts && transactions ? computeAllAccountBalances(accounts, transactions) : null),
    [accounts, transactions],
  );

  const totals = useMemo(() => {
    const t = { IRT: 0, USD: 0 };
    for (const a of accounts ?? []) {
      if (!a.active) continue;
      const bal = balances?.get(a.id)?.balance ?? 0;
      t[a.currency] += bal;
    }
    return t;
  }, [accounts, balances]);

  const removeAccount = async (account: FinAccount) => {
    const ok = await confirm({
      title: `حذف یا غیرفعال‌سازی «${account.name}»`,
      message:
        "اگر حساب تراکنش داشته باشد فقط غیرفعال می‌شود تا سابقه مالی حفظ شود؛ حساب خالی کامل حذف می‌شود.",
      confirmLabel: "ادامه",
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await deleteOrDeactivateAccount(account.id);
      toast.success(
        result === "deleted" ? "حساب خالی بود و کامل حذف شد." : "حساب دارای تراکنش بود و فقط غیرفعال شد.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات ناموفق بود.");
    }
  };

  const TypeIcon = ({ type }: { type: FinAccount["type"] }) =>
    type === "cash" ? <Wallet size={18} /> : type === "bank" ? <Landmark size={18} /> : <Banknote size={18} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="glass flex flex-wrap items-center gap-4 rounded-3xl px-4 py-3 text-xs">
          <span className="font-bold">موجودی کل:</span>
          <span className="num font-extrabold">{formatMoney(totals.IRT, "IRT")}</span>
          <span className="num font-extrabold">{formatMoney(totals.USD, "USD")}</span>
          <span className="text-ink-400">(فقط حساب‌های فعال)</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="glass" icon={ArrowLeftRight} onClick={() => setTransferOpen(true)}>
            انتقال / تبدیل
          </Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => { setEditAccount(null); setFormOpen(true); }}>
            حساب جدید
          </Button>
        </div>
      </div>

      {!accounts ? (
        <div className="glass h-24 animate-pulse rounded-3xl" />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="هنوز صندوق یا حساب بانکی نساخته‌اید"
          description="برای ثبت دریافت و پرداخت واقعی، حداقل یک صندوق نقدی یا حساب بانکی بسازید. مانده اولیه به‌صورت تراکنش قابل حسابرسی ثبت می‌شود."
          action={
            <Button variant="primary" icon={Plus} onClick={() => { setEditAccount(null); setFormOpen(true); }}>
              ساخت اولین حساب
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const bal = balances?.get(a.id);
            return (
              <div
                key={a.id}
                className="glass group relative flex cursor-pointer flex-col gap-2.5 rounded-3xl p-4 transition-transform active:scale-[0.98]"
                onClick={() => navigate(`/accounting/accounts/${a.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                    <TypeIcon type={a.type} />
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={<IconButton icon={MoreVertical} label="عملیات" size={16} />}
                      items={[
                        { label: "واریز / دریافت به این حساب", onClick: () => setDepositFor(a) },
                        { label: "ویرایش", onClick: () => { setEditAccount(a); setFormOpen(true); } },
                        { label: a.active ? "غیرفعال‌سازی" : "فعال‌سازی", danger: a.active, onClick: () => void removeAccount(a) },
                      ]}
                    />
                  </span>
                </div>
                <div>
                  <p className="truncate text-sm font-extrabold">{a.name}</p>
                  <p className="text-[11px] font-semibold text-ink-500 dark:text-ink-400">
                    {ACCOUNT_TYPE_LABELS[a.type]} · {a.currency === "USD" ? "دلار" : "تومان"}
                    {!a.active && " · غیرفعال"}
                  </p>
                </div>
                <p className="num text-xl font-extrabold">
                  {formatMoney(bal?.balance ?? 0, a.currency)}
                </p>
                <p className="text-[11px] text-ink-400">
                  {(bal?.txCount ?? 0).toLocaleString("fa-IR")} تراکنش مؤثر بر مانده
                </p>
                {a.description && (
                  <p className="truncate text-[11px] leading-5 text-ink-400">{a.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FinAccountFormModal open={formOpen} onClose={() => setFormOpen(false)} editAccount={editAccount} />
      <TransactionFormModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        initial={{ type: "transfer" }}
      />
      <TransactionFormModal
        open={depositFor != null}
        onClose={() => setDepositFor(null)}
        initial={{
          type: "receipt",
          currency: depositFor?.currency ?? "IRT",
          destAccountId: depositFor?.id ?? null,
        }}
      />
    </div>
  );
}
