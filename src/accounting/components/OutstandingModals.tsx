/**
 * Outstanding receivable / payable management:
 *  - OutstandingFormModal: create an item (amount, due date, party, kind)
 *  - SettleModal: record a partial/full settlement, optionally as a real
 *    receipt/payment transaction linked to the item
 *  - ReconcileModal: manual balance verification → audited adjustment
 */

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/fields";
import { FormField } from "../../components/ui/fields";
import { RadioSelect, SearchSelect } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { useToast } from "../../hooks/useToast";
import { todayIso, formatJalali } from "../../utils/jalali";
import { formatMoney, parseAmountInput } from "../../utils/num";
import { computeAccountBalance, outstandingRemaining } from "../engine";
import {
  createOutstanding,
  postTransaction,
  reconcileAccount,
  settleOutstanding,
  TxValidationError,
} from "../repo";
import {
  OUTSTANDING_KIND_LABELS,
  type FinAccount,
  type OutstandingItem,
  type OutstandingKind,
  type OutstandingSettlement,
} from "../types";
import { useAccAccounts, useAccParties, useAccTransactions } from "../hooks";

/* ------------------------------- Create item ------------------------------- */

export function OutstandingFormModal({
  open,
  onClose,
  editItem,
}: {
  open: boolean;
  onClose: () => void;
  editItem?: OutstandingItem | null;
}) {
  const toast = useToast();
  const parties = useAccParties();
  const [kind, setKind] = useState<OutstandingKind>("receivable");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<"USD" | "IRT">("IRT");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setKind(editItem.kind);
      setPartyId(editItem.partyId);
      setAmount(editItem.amount);
      setCurrency(editItem.currency);
      setDueDate(editItem.dueDate ?? null);
      setDescription(editItem.description ?? "");
    } else {
      setKind("receivable");
      setPartyId(null);
      setAmount(null);
      setCurrency("IRT");
      setDueDate(null);
      setDescription("");
    }
  }, [open, editItem]);

  const partyItems = useMemo(
    () => (parties ?? []).filter((p) => p.active).map((p) => ({ id: p.id, title: p.name, subtitle: p.code })),
    [parties],
  );

  const save = async () => {
    if (busy) return;
    if (!partyId) {
      toast.error("انتخاب طرف حساب الزامی است.");
      return;
    }
    if (!(amount && amount > 0)) {
      toast.error("مبلغ باید بزرگ‌تر از صفر باشد.");
      return;
    }
    setBusy(true);
    try {
      if (editItem) {
        // Editing the amount of a partially-settled item is not allowed —
        // cancel and re-create instead (keeps settlements consistent).
        toast.error("ویرایش مبلغ مانده پشتیبانی نمی‌شود — آن را ابطال و دوباره ثبت کنید.");
        return;
      }
      await createOutstanding({ kind, partyId, amount, currency, dueDate, description });
      toast.success(`${kind === "receivable" ? "مطالبه" : "بدهی"} ثبت شد`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editItem ? "مانده (نمایش)" : "ثبت مانده جدید"}
      subtitle="مطالبه = طلب ما از طرف حساب، بدهی = طلب طرف حساب از ما"
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          {!editItem && (
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              ثبت مانده
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نوع مانده" required>
          <RadioSelect
            options={[
              { value: "receivable", label: OUTSTANDING_KIND_LABELS.receivable },
              { value: "payable", label: OUTSTANDING_KIND_LABELS.payable },
            ]}
            value={kind}
            onChange={(v) => setKind(v as OutstandingKind)}
            disabled={Boolean(editItem)}
          />
        </FormField>
        <FormField label="طرف حساب" required>
          <SearchSelect
            items={partyItems}
            value={partyId}
            onSelect={setPartyId}
            disabled={Boolean(editItem)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="مبلغ" required>
            <div className="flex gap-2">
              <Input
                dir="ltr"
                className="num flex-1 text-right"
                inputMode="decimal"
                value={amount ?? ""}
                onChange={(e) => setAmount(parseAmountInput(e.target.value))}
                placeholder="0"
                disabled={Boolean(editItem)}
              />
              <div className="flex shrink-0 overflow-hidden rounded-[0.85rem] border border-ink-900/10 dark:border-white/10">
                {(["IRT", "USD"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={Boolean(editItem)}
                    onClick={() => setCurrency(c)}
                    className={`px-3 text-xs font-bold transition-colors ${
                      currency === c
                        ? "bg-brand-500 text-white"
                        : "bg-white/60 text-ink-500 dark:bg-white/5 dark:text-ink-300"
                    }`}
                  >
                    {c === "IRT" ? "تومان" : "دلار"}
                  </button>
                ))}
              </div>
            </div>
          </FormField>
          <FormField label="سررسید" hint="برای هشدار سررسید گذشته">
            <JalaliDatePicker value={dueDate} onChange={setDueDate} />
          </FormField>
        </div>
        <FormField label="شرح">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={Boolean(editItem)} />
        </FormField>
      </div>
    </Modal>
  );
}

/* ------------------------------- Settle item ------------------------------- */

export function SettleModal({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: OutstandingItem | null;
}) {
  const toast = useToast();
  const accounts = useAccAccounts();
  const allTx = useAccTransactions();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(todayIso());
  const [note, setNote] = useState("");
  const [asTransaction, setAsTransaction] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remaining = item ? outstandingRemaining(item) : 0;

  useEffect(() => {
    if (!open || !item) return;
    setAmount(outstandingRemaining(item));
    setDate(todayIso());
    setNote("");
    setAsTransaction(true);
    setAccountId(null);
  }, [open, item]);

  const eligibleAccounts = useMemo(
    () =>
      item
        ? (accounts ?? []).filter((a) => a.active && a.currency === item.currency)
        : [],
    [accounts, item],
  );

  const save = async () => {
    if (busy || !item) return;
    if (!(amount && amount > 0)) {
      toast.error("مبلغ تسویه باید بزرگ‌تر از صفر باشد.");
      return;
    }
    if (amount > remaining) {
      toast.error(`مبلغ تسویه نمی‌تواند از مانده (${formatMoney(remaining, item.currency)}) بیشتر باشد.`);
      return;
    }
    setBusy(true);
    try {
      if (asTransaction) {
        // Post a real receipt (receivable) / payment (payable) linked to the
        // item — the settlement is appended automatically by the repo.
        await postTransaction({
          type: item.kind === "receivable" ? "receipt" : "payment",
          partyId: item.partyId,
          amount,
          currency: item.currency,
          date: date ?? todayIso(),
          description: note.trim() || `تسویه ${item.kind === "receivable" ? "مطالبه" : "بدهی"}`,
          ...(item.kind === "receivable"
            ? { destAccountId: accountId }
            : { sourceAccountId: accountId }),
          affectsBalance: Boolean(accountId),
          settlementOf: item.id,
        });
        toast.success("تسویه همراه با تراکنش ثبت شد");
      } else {
        await settleOutstanding(item.id, { amount, date: date ?? todayIso(), note });
        toast.success("تسویه ثبت شد");
      }
      onClose();
    } catch (e) {
      if (e instanceof TxValidationError) toast.error(e.messages[0] ?? "ثبت ناموفق بود.");
      else toast.error(e instanceof Error ? e.message : "ثبت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ثبت تسویه"
      subtitle={item ? `مانده باقی‌مانده: ${formatMoney(remaining, item.currency)}` : undefined}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            ثبت تسویه
          </Button>
        </div>
      }
    >
      {item && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="مبلغ تسویه" required>
              <Input
                dir="ltr"
                className="num text-right"
                inputMode="decimal"
                value={amount ?? ""}
                onChange={(e) => setAmount(parseAmountInput(e.target.value))}
              />
            </FormField>
            <FormField label="تاریخ" required>
              <JalaliDatePicker value={date} onChange={setDate} clearable={false} />
            </FormField>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm flex-1 border-dashed"
              onClick={() => setAmount(remaining)}
            >
              تسویه کامل ({formatMoney(remaining, item.currency)})
            </button>
          </div>
          <FormField label="نوع ثبت" required>
            <RadioSelect
              options={[
                { value: "tx", label: "همراه با تراکنش واقعی" },
                { value: "manual", label: "فقط ثبت تسویه" },
              ]}
              value={asTransaction ? "tx" : "manual"}
              onChange={(v) => setAsTransaction(v === "tx")}
            />
          </FormField>
          {asTransaction && (
            <FormField
              label={item.kind === "receivable" ? "واریز به حساب" : "پرداخت از حساب"}
              hint="اگر پول واقعاً جابه‌جا شده، حساب را انتخاب کنید؛ خالی بگذارید تا فقط اطلاعاتی ثبت شود"
            >
              <SearchSelect
                items={eligibleAccounts.map((a) => ({ id: a.id, title: a.name, subtitle: a.currency === "USD" ? "دلار" : "تومان" }))}
                value={accountId}
                onSelect={setAccountId}
                placeholder="بدون تغییر مانده…"
              />
            </FormField>
          )}
          <FormField label="یادداشت">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />
          </FormField>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Reconciliation ----------------------------- */

export function ReconcileModal({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  account: FinAccount | null;
}) {
  const toast = useToast();
  const allTx = useAccTransactions();
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const derived = useMemo(() => {
    if (!account || !allTx) return null;
    return computeAccountBalance(account, allTx);
  }, [account, allTx]);

  useEffect(() => {
    if (!open) return;
    setCounted(derived?.balance ?? null);
    setNote("");
  }, [open, derived]);

  const difference =
    counted != null && derived ? counted - derived.balance : 0;

  const save = async () => {
    if (busy || !account) return;
    setBusy(true);
    try {
      const result = await reconcileAccount(account.id, counted ?? 0, note);
      if (result.difference === 0) {
        toast.success("مانده با شمارش فیزیکی مطابقت دارد — هیچ تعدیلی لازم نیست");
      } else {
        toast.success(
          `تعدیل ${formatMoney(Math.abs(result.difference), account.currency)} به‌صورت تراکنش حسابرسی‌شده ثبت شد`,
        );
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تطبیق ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`تطبیق مانده — ${account?.name ?? ""}`}
      subtitle="شمارش فیزیکی را وارد کنید؛ اختلاف فقط از طریق تراکنش تعدیلِ قابل حسابرسی ثبت می‌شود"
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            ثبت تطبیق
          </Button>
        </div>
      }
    >
      {account && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-white/40 p-3 text-xs leading-6 dark:bg-white/[0.04]">
            <p>
              مانده سیستمی:{" "}
              <span className="num font-bold">{formatMoney(derived?.balance ?? 0, account.currency)}</span>
            </p>
            <p className="text-ink-500 dark:text-ink-400">
              {derived?.txCount ?? 0} تراکنش مؤثر بر مانده
            </p>
          </div>
          <FormField label="مانده شمارش‌شده" required>
            <Input
              dir="ltr"
              className="num text-right"
              inputMode="decimal"
              value={counted ?? ""}
              onChange={(e) => setCounted(parseAmountInput(e.target.value))}
            />
          </FormField>
          {Math.abs(difference) > 0.001 && (
            <p className="rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3 text-xs font-bold leading-6 text-[#c77d0a] dark:text-[#f5b84f]">
              اختلاف: {formatMoney(Math.abs(difference), account.currency)}{" "}
              {difference > 0 ? "(افزایش مانده)" : "(کاهش مانده)"} — با ثبت، یک تراکنش تعدیل ایجاد می‌شود.
            </p>
          )}
          <FormField label="توضیح">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: شمارش نقدی پایان روز" />
          </FormField>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- Settlement list row --------------------------- */

export function SettlementHistory({
  settlements,
  currency,
  onRemove,
}: {
  settlements: OutstandingSettlement[];
  currency: "USD" | "IRT";
  onRemove?: (settlementId: string) => void;
}) {
  if (settlements.length === 0) {
    return <p className="text-xs text-ink-400">هنوز تسویه‌ای ثبت نشده است.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {settlements.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-2 rounded-xl bg-white/40 px-3 py-2 text-xs dark:bg-white/[0.04]"
        >
          <span className="num font-bold">{formatMoney(s.amount, currency)}</span>
          <span className="text-ink-400">·</span>
          <span className="num text-ink-500 dark:text-ink-400">{formatJalali(s.date)}</span>
          {s.note && <span className="min-w-0 flex-1 truncate text-ink-400">{s.note}</span>}
          {onRemove && (
            <button
              type="button"
              className="icon-btn !h-7 !w-7 text-[#dc3535]"
              onClick={() => onRemove(s.id)}
              aria-label="حذف تسویه"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
