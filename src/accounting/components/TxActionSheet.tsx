/**
 * TxActionSheet — click a transaction anywhere (party profile, account
 * statement) and manage it RIGHT THERE: edit, reverse/cancel with a reason,
 * or permanently purge it from history. No need to visit the transactions
 * page anymore.
 */

import { useState } from "react";
import {
  Ban,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatJalali } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import { TX_TYPE_LABELS } from "../types";
import type { FinTransaction } from "../types";
import {
  reverseTransaction,
  cancelInformationalTx,
  deleteTransactionPermanently,
} from "../repo";
import {
  InformationalBadge,
  SignedAmount,
  TxStatusPill,
  TxTypePill,
} from "./Bits";
import { TransactionFormModal } from "./TransactionFormModal";

export function canEditTx(tx: FinTransaction): boolean {
  return tx.status === "final" && !tx.reversedBy && !tx.reversalOf;
}

export function TxActionSheet({
  tx,
  onClose,
}: {
  tx: FinTransaction | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FinTransaction | null>(null);

  const reset = () => {
    setReason("");
    setBusy(false);
    setEditing(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  if (!tx) return null;

  const editable = canEditTx(tx);

  const doReverse = async () => {
    if (!reason.trim()) {
      toast.error("دلیل برگشت الزامی است.");
      return;
    }
    setBusy(true);
    try {
      const counter = await reverseTransaction(tx.id, reason.trim());
      toast.success(`تراکنش با ${counter.number} خنثی شد`);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "برگشت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!reason.trim()) {
      toast.error("دلیل ابطال الزامی است.");
      return;
    }
    setBusy(true);
    try {
      await cancelInformationalTx(tx.id, reason.trim());
      toast.success("رکورد اطلاعاتی ابطال شد");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ابطال ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const doPurge = async () => {
    const ok = await confirm({
      title: `حذف دائمی ${tx.number} از تاریخچه؟`,
      message:
        "تراکنش با همه اثر مالی‌اش برای همیشه پاک می‌شود (اگر برگشت خورده باشد، تراکنش خنثی‌سازش هم همراهش پاک می‌شود). اسناد پیوست فقط جدا می‌شوند و پاک نمی‌شوند. این عمل بازگشت‌پذیر نیست!",
      danger: true,
      confirmLabel: "حذف دائمی",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteTransactionPermanently(tx.id);
      toast.success("تراکنش برای همیشه حذف شد");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف دائمی ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={!!tx && !editing}
        onClose={busy ? () => undefined : close}
        title={`تراکنش ${tx.number}`}
        subtitle={TX_TYPE_LABELS[tx.type]}
        size="sm"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="btn btn-ghost btn-sm" onClick={close} disabled={busy}>
              بستن
            </button>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button size="sm" variant="glass" icon={Pencil} onClick={() => setEditing(tx)} disabled={busy}>
                  ویرایش
                </Button>
              )}
              {editable &&
                (tx.affectsBalance ? (
                  <Button size="sm" variant="danger-soft" icon={Undo2} onClick={() => void doReverse()} disabled={busy}>
                    برگشت تراکنش
                  </Button>
                ) : (
                  <Button size="sm" variant="danger-soft" icon={Ban} onClick={() => void doCancel()} disabled={busy}>
                    ابطال رکورد
                  </Button>
                ))}
              <Button
                size="sm"
                variant="danger-soft"
                icon={Trash2}
                className="!text-rose-600 dark:!text-rose-400"
                onClick={() => void doPurge()}
                disabled={busy}
              >
                حذف دائمی
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <TxTypePill type={tx.type} />
            <TxStatusPill status={tx.status} />
            {!tx.affectsBalance && <InformationalBadge />}
            <span className="num text-ink-500 dark:text-ink-400">{formatJalali(tx.date)}</span>
          </div>
          <div className="glass flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5">
            <span className="text-ink-500 dark:text-ink-400">مبلغ</span>
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
          </div>
          {tx.description && (
            <p className="rounded-2xl bg-brand-500/6 px-3 py-2 leading-6">{tx.description}</p>
          )}
          {tx.reason && (
            <p className="text-xs text-ink-500 dark:text-ink-400">دلیل: {tx.reason}</p>
          )}
          {tx.type === "exchange" && tx.destAmount != null && tx.destCurrency && (
            <p className="num text-xs text-ink-500 dark:text-ink-400">
              سمت مقصد: {formatMoney(tx.destAmount, tx.destCurrency)}
            </p>
          )}
          {tx.reversedBy && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              این تراکنش برگشت خورده است — حذف دائمی آن، تراکنش خنثی‌سازش را هم پاک می‌کند.
            </p>
          )}

          {editable && (
            <div className="mt-1">
              <label className="mb-1 block text-[11.5px] font-bold text-ink-500 dark:text-ink-400">
                {tx.affectsBalance ? "دلیل برگشت (الزامی)" : "دلیل ابطال (الزامی)"}
              </label>
              <input
                className="field"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tx.affectsBalance ? "مثلاً ثبت اشتباه مبلغ…" : "مثلاً صرف اطلاع بود…"}
              />
            </div>
          )}
        </div>
      </Modal>

      {editing && (
        <TransactionFormModal
          open
          onClose={() => setEditing(null)}
          editTx={editing}
        />
      )}
    </>
  );
}
