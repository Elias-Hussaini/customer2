/**
 * The single reusable financial transaction form.
 * Handles all six types, real-vs-informational posting, dual-currency
 * exchange, inline party creation, live validation with balance checks,
 * insufficient-funds override, and document attachments.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileText, Paperclip, Trash2, X } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { useDropTarget } from "../../components/ui/DropZone";
import { Checkbox, Input, Select, Textarea } from "../../components/ui/fields";
import { FormField } from "../../components/ui/fields";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { RadioSelect, SearchSelect } from "../../components/ui/inputs";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import type { Currency } from "../../types";
import { todayIso, formatJalali } from "../../utils/jalali";
import { formatMoney, parseAmountInput } from "../../utils/num";
import { uid } from "../../utils/id";
import { computeAllAccountBalances, validateTx } from "../engine";
import {
  addAccDoc,
  createParty,
  editTransaction,
  postTransaction,
  TxValidationError,
  type PostTxInput,
} from "../repo";
import {
  TX_TYPE_LABELS,
  type AccParty,
  type FinAccount,
  type FinTransaction,
  type FinTxType,
} from "../types";
import { useAccAccounts, useAccParties, useAccSettings, useAccTransactions } from "../hooks";

const TYPE_OPTIONS: { value: FinTxType; label: string }[] = [
  { value: "receipt", label: "دریافت" },
  { value: "payment", label: "پرداخت" },
  { value: "withdrawal", label: "برداشت" },
  { value: "transfer", label: "انتقال" },
  { value: "exchange", label: "تبدیل ارز" },
  { value: "adjustment", label: "تعدیل" },
];

const OTHER_CURRENCY: Record<Currency, Currency> = { USD: "IRT", IRT: "USD" };

export interface TxFormInitial {
  type?: FinTxType;
  partyId?: string | null;
  settlementOf?: string | null;
  amount?: number | null;
  currency?: Currency | null;
  date?: string | null;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
}

interface TransactionFormModalProps {
  open: boolean;
  onClose: () => void;
  initial?: TxFormInitial;
  /** Pass a transaction to edit it (controlled, audited). */
  editTx?: FinTransaction | null;
}

interface PendingDoc {
  id: string;
  file: File;
}

export function TransactionFormModal({ open, onClose, initial, editTx }: TransactionFormModalProps) {
  const toast = useToast();
  const { confirm } = useConfirm();

  const parties = useAccParties();
  const accounts = useAccAccounts();
  const allTx = useAccTransactions();
  const settings = useAccSettings();

  const [type, setType] = useState<FinTxType>("receipt");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency>("IRT");
  const [date, setDate] = useState<string | null>(todayIso());
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [destAccountId, setDestAccountId] = useState<string | null>(null);
  const [affectsBalance, setAffectsBalance] = useState(true);
  const [destAmount, setDestAmount] = useState<number | null>(null);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState("");
  const [overrideFunds, setOverrideFunds] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [insufficient, setInsufficient] = useState<{ available: number; requested: number } | null>(
    null,
  );
  const idempotencyKey = useRef(uid());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill / reset whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = uid();
    setFieldErrors({});
    setInsufficient(null);
    setOverrideFunds(false);
    setPendingDocs([]);
    if (editTx) {
      setType(editTx.type);
      setPartyId(editTx.partyId ?? null);
      setAmount(editTx.amount);
      setCurrency(editTx.currency);
      setDate(editTx.date);
      setSourceAccountId(editTx.sourceAccountId ?? null);
      setDestAccountId(editTx.destAccountId ?? null);
      setAffectsBalance(editTx.affectsBalance);
      setDestAmount(editTx.destAmount ?? null);
      setExchangeRate(editTx.exchangeRate ?? null);
      setDescription(editTx.description ?? "");
      setReference(editTx.reference ?? "");
      setCategory(editTx.category ?? "");
    } else {
      setType(initial?.type ?? "receipt");
      setPartyId(initial?.partyId ?? null);
      setAmount(initial?.amount ?? null);
      setCurrency(initial?.currency ?? settings.defaultCurrency);
      setDate(initial?.date ?? todayIso());
      setSourceAccountId(initial?.sourceAccountId ?? null);
      setDestAccountId(initial?.destAccountId ?? null);
      // Settlement flows always start informational OFF (they move real money).
      setAffectsBalance(true);
      setDestAmount(null);
      setExchangeRate(null);
      setDescription("");
      setReference("");
      setCategory("");
    }
  }, [open, editTx, initial, settings.defaultCurrency]);

  const destCurrency: Currency | null =
    type === "exchange" ? OTHER_CURRENCY[currency] : null;

  const balances = useMemo(
    () => (accounts && allTx ? computeAllAccountBalances(accounts, allTx) : null),
    [accounts, allTx],
  );

  const partyItems = useMemo(
    () =>
      (parties ?? []).map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.code} — ${p.active ? "" : "غیرفعال"}`,
      })),
    [parties],
  );

  const accountItems = (cur: Currency | null, excludeId?: string | null) =>
    (accounts ?? [])
      .filter((a) => a.active && (cur == null || a.currency === cur) && a.id !== excludeId)
      .map((a) => ({
        id: a.id,
        title: a.name,
        subtitle: `${a.currency === "USD" ? "دلار" : "تومان"} — مانده: ${formatMoney(
          balances?.get(a.id)?.balance ?? 0,
          a.currency,
        )}`,
      }));

  const liveInput: PostTxInput = useMemo(
    () => ({
      type,
      partyId,
      amount: amount ?? 0,
      currency,
      date: date ?? todayIso(),
      description,
      reference,
      category,
      sourceAccountId,
      destAccountId,
      affectsBalance,
      destAmount,
      destCurrency,
      exchangeRate,
    }),
    [type, partyId, amount, currency, date, description, reference, category, sourceAccountId, destAccountId, affectsBalance, destAmount, destCurrency, exchangeRate],
  );

  // Live validation (non-blocking) for inline errors.
  useEffect(() => {
    if (!accounts) return;
    const res = validateTx(liveInput, { accounts, balances: balances ?? undefined });
    const map: Record<string, string> = {};
    for (const e of res.errors) {
      if (!map[e.field]) map[e.field] = e.message;
    }
    setFieldErrors(map);
    setInsufficient(res.insufficientFunds ?? null);
  }, [liveInput, accounts, balances]);

  // Auto-compute the exchange rate from the two amounts (تومان بر دلار).
  useEffect(() => {
    if (type !== "exchange") return;
    if (amount != null && amount > 0 && destAmount != null && destAmount > 0) {
      const usd = currency === "USD" ? amount : destAmount;
      const irt = currency === "IRT" ? amount : destAmount;
      if (usd > 0) setExchangeRate(Math.round((irt / usd) * 100) / 100);
    }
  }, [type, amount, destAmount, currency]);

  const pickFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next: PendingDoc[] = [];
    for (const f of Array.from(files)) {
      const okMime =
        /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type) || /\.pdf$/i.test(f.name);
      if (!okMime) {
        toast.error(`«${f.name}»: فقط تصویر و PDF مجاز است`);
        continue;
      }
      if (f.size > 15 * 1024 * 1024) {
        toast.error(`«${f.name}»: بیشتر از ۱۵ مگابایت`);
        continue;
      }
      next.push({ id: uid(), file: f });
    }
    setPendingDocs((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // The dashed attachment button doubles as a drop zone.
  const docsDrop = useDropTarget((files) => pickFiles(files));

  const save = async () => {
    if (busy) return;
    if (!accounts) return;
    const res = validateTx(liveInput, { accounts, balances: balances ?? undefined });
    if (res.errors.length > 0) {
      const map: Record<string, string> = {};
      for (const e of res.errors) if (!map[e.field]) map[e.field] = e.message;
      setFieldErrors(map);
      toast.error(res.errors[0].message);
      return;
    }
    if (res.insufficientFunds && !overrideFunds) {
      setInsufficient(res.insufficientFunds);
      toast.error("مانده حساب مبدأ کافی نیست — برای ادامه، تأیید کسری را فعال کنید.");
      return;
    }
    setBusy(true);
    try {
      let saved: FinTransaction;
      if (editTx) {
        saved = await editTransaction(editTx.id, {
          ...liveInput,
          overrideInsufficientFunds: overrideFunds,
        });
        toast.success(`تراکنش ${saved.number} به‌روزرسانی شد`);
      } else {
        saved = await postTransaction({
          ...liveInput,
          settlementOf: initial?.settlementOf ?? null,
          overrideInsufficientFunds: overrideFunds,
          idempotencyKey: idempotencyKey.current,
        });
        toast.success(`تراکنش ${saved.number} ثبت شد`);
      }
      // Attach pending documents to the saved transaction.
      for (const doc of pendingDocs) {
        try {
          await addAccDoc({
            file: doc.file,
            transactionId: saved.id,
            partyId: saved.partyId ?? null,
            category: "رسید",
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "بارگذاری سند ناموفق بود");
        }
      }
      onClose();
    } catch (e) {
      if (e instanceof TxValidationError) {
        toast.error(e.messages[0] ?? "تراکنش معتبر نیست.");
        if (e.insufficientFunds) setInsufficient(e.insufficientFunds);
      } else {
        toast.error(e instanceof Error ? e.message : "ثبت تراکنش ناموفق بود.");
      }
    } finally {
      setBusy(false);
    }
  };

  const closeWithPendingDocs = () => {
    if (pendingDocs.length > 0 && !busy) {
      void confirm({
        title: "سندهای پیوست حذف می‌شوند",
        message: `${pendingDocs.length} فایل انتخاب کرده‌اید که هنوز ذخیره نشده‌اند. مطمئنید؟`,
        confirmLabel: "بستن",
        cancelLabel: "ماندن",
      }).then((ok) => {
        if (ok) onClose();
      });
      return;
    }
    onClose();
  };

  const sourceLabel =
    type === "payment"
      ? "از حساب (مبدأ)"
      : type === "withdrawal"
        ? "از حساب (برداشت)"
        : type === "transfer" || type === "exchange"
          ? "از حساب (مبدأ)"
          : type === "adjustment"
            ? "کاهش از حساب (اختیاری)"
            : "";
  const destLabel =
    type === "receipt"
      ? "به حساب (مقصد)"
      : type === "transfer" || type === "exchange"
        ? "به حساب (مقصد)"
        : type === "adjustment"
          ? "افزایش به حساب (اختیاری)"
          : "";

  const needsParty = type === "receipt" || type === "payment" || type === "withdrawal";

  return (
    <Modal
      open={open}
      onClose={closeWithPendingDocs}
      title={editTx ? `ویرایش تراکنش ${editTx.number}` : "تراکنش جدید"}
      subtitle={editTx ? "ویرایش کنترل‌شده — همه تغییرات در حسابرسی ثبت می‌شود" : "ثبت دریافت، پرداخت، برداشت، انتقال و تبدیل"}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={closeWithPendingDocs} disabled={busy}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {editTx ? "ذخیره تغییرات" : "ثبت تراکنش"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Type */}
        <FormField label="نوع تراکنش" required>
          <div className="grid grid-cols-3 gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setType(opt.value);
                  setSourceAccountId(null);
                  setDestAccountId(null);
                  setDestAmount(null);
                  setExchangeRate(null);
                }}
                className={`rounded-xl border px-2 py-2.5 text-xs font-bold transition-all ${
                  type === opt.value
                    ? "border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300"
                    : "border-ink-900/10 text-ink-500 hover:border-brand-400 dark:border-white/10 dark:text-ink-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FormField>

        {/* Party */}
        {needsParty && (
          <FormField label="طرف حساب (شخص / شرکت)" hint="برای ایجاد سریع، نام جدید را تایپ و «ایجاد» را بزنید">
            <SearchSelect
              items={partyItems}
              value={partyId}
              onSelect={setPartyId}
              placeholder="انتخاب طرف حساب…"
              onCreate={async (query) => {
                try {
                  const party = await createParty({
                    type: "individual",
                    name: query,
                    tags: [],
                    active: true,
                  });
                  setPartyId(party.id);
                  toast.success(`حساب ${party.code} برای «${party.name}» ایجاد شد`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "ایجاد طرف حساب ناموفق بود");
                }
              }}
              createLabel={(q) => `ایجاد حساب جدید برای «${q}»`}
            />
          </FormField>
        )}

        {/* Amount & currency */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="مبلغ" required error={fieldErrors.amount}>
            <MoneyInput
              amount={amount}
              currency={currency}
              onAmountChange={(v) => setAmount(v)}
              onCurrencyChange={(c) => {
                setCurrency(c);
                setSourceAccountId(null);
                setDestAccountId(null);
              }}
              disabled={type === "opening"}
            />
          </FormField>
          <FormField label="تاریخ تراکنش" required>
            <JalaliDatePicker value={date} onChange={setDate} clearable={false} />
          </FormField>
        </div>

        {/* Exchange destination side */}
        {type === "exchange" && destCurrency && (
          <div className="grid gap-4 rounded-2xl border border-brand-500/20 bg-brand-500/[0.04] p-3.5 sm:grid-cols-2">
            <FormField
              label={`مبلغ مقصد (${destCurrency === "USD" ? "دلار" : "تومان"})`}
              required
              error={fieldErrors.destAmount}
            >
              <div className="flex gap-2">
                <input
                  dir="ltr"
                  className="field num flex-1 text-right"
                  inputMode="decimal"
                  value={destAmount ?? ""}
                  onChange={(e) => setDestAmount(parseAmountInput(e.target.value))}
                  placeholder="0"
                />
              </div>
            </FormField>
            <FormField label="نرخ تبدیل (تومان بر دلار)" hint="به‌طور خودکار از دو مبلغ محاسبه می‌شود">
              <Input dir="ltr" className="num text-right" value={exchangeRate ?? ""} readOnly />
            </FormField>
          </div>
        )}

        {/* Real vs informational */}
        <FormField
          label="وضعیت ثبت"
          hint={
            affectsBalance
              ? "تراکنش واقعی — مانده صندوق/بانک را تغییر می‌دهد."
              : "رکورد اطلاعاتی — فقط در تاریخچه ثبت می‌شود و مانده واقعی را عوض نمی‌کند."
          }
        >
          <RadioSelect
            options={[
              { value: "real", label: "واقعی (تغییر مانده)" },
              { value: "info", label: "فقط ثبت (اطلاعاتی)" },
            ]}
            value={affectsBalance ? "real" : "info"}
            onChange={(v) => {
              const real = v === "real";
              setAffectsBalance(real);
              if (!real) {
                setSourceAccountId(null);
                setDestAccountId(null);
              }
            }}
          />
        </FormField>
        {fieldErrors.affectsBalance && <p className="text-xs text-[#ef4444]">{fieldErrors.affectsBalance}</p>}

        {/* Accounts */}
        {affectsBalance && (
          <div className="grid gap-4 sm:grid-cols-2">
            {sourceLabel && (
              <FormField label={sourceLabel} error={fieldErrors.sourceAccountId} required={type === "payment" || type === "withdrawal" || type === "transfer" || type === "exchange"}>
                <SearchSelect
                  items={accountItems(type === "exchange" ? currency : null, destAccountId)}
                  value={sourceAccountId}
                  onSelect={setSourceAccountId}
                  placeholder={
                    type === "exchange"
                      ? `حساب ${currency === "USD" ? "دلاری" : "تومانی"}…`
                      : "انتخاب حساب…"
                  }
                />
              </FormField>
            )}
            {destLabel && (
              <FormField label={destLabel} error={fieldErrors.destAccountId} required={type === "receipt" || type === "transfer" || type === "exchange"}>
                <SearchSelect
                  items={accountItems(
                    type === "exchange" ? destCurrency : type === "transfer" ? currency : currency,
                    sourceAccountId,
                  )}
                  value={destAccountId}
                  onSelect={setDestAccountId}
                  placeholder={
                    type === "exchange"
                      ? `حساب ${destCurrency === "USD" ? "دلاری" : "تومانی"}…`
                      : "انتخاب حساب…"
                  }
                />
              </FormField>
            )}
          </div>
        )}
        {fieldErrors.currency && <p className="text-xs text-[#ef4444]">{fieldErrors.currency}</p>}
        {fieldErrors.destAccountId && affectsBalance && (
          <p className="text-xs text-[#ef4444]">{fieldErrors.destAccountId}</p>
        )}

        {/* Insufficient funds warning + explicit override */}
        {insufficient && affectsBalance && (
          <div className="flex flex-col gap-2 rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3.5">
            <p className="flex items-center gap-2 text-xs font-bold text-[#c77d0a] dark:text-[#f5b84f]">
              <AlertTriangle size={15} />
              مانده حساب مبدأ کافی نیست — موجودی: {formatMoney(insufficient.available, currency)}،
              درخواست: {formatMoney(insufficient.requested, currency)}
            </p>
            <Checkbox
              checked={overrideFunds}
              onChange={setOverrideFunds}
              label="می‌دانم مانده کافی نیست؛ با ثبت تراکتور منفی، ادامه بده (در حسابرسی ثبت می‌شود)"
            />
          </div>
        )}

        {/* Details */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="شرح">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: دریافت خدمات ویزا"
            />
          </FormField>
          <FormField label="شماره پیگیری / مرجع">
            <Input dir="auto" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="—" />
          </FormField>
        </div>
        <FormField label="دسته‌بندی">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— بدون دسته —</option>
            {settings.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormField>

        {/* Attachments */}
        <FormField label="اسناد پیوست (تصویر / PDF)">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
          <button
            type="button"
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-300/70 py-3 text-xs font-bold text-ink-500 transition-all hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-400 ${
              docsDrop.hovering ? "border-brand-400 bg-brand-500/10 text-brand-600 ring-2 ring-brand-400/40" : ""
            }`}
            onClick={() => fileInputRef.current?.click()}
            title="انتخاب فایل — یا فایل‌ها را همین‌جا رها کنید"
            {...docsDrop.dropHandlers}
          >
            <Paperclip size={15} />
            افزودن رسید یا فاکتور
          </button>
          {pendingDocs.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 rounded-xl bg-white/40 px-3 py-2 text-xs dark:bg-white/[0.04]"
                >
                  <FileText size={14} className="shrink-0 text-brand-500" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{doc.file.name}</span>
                  <span className="num shrink-0 text-ink-400">
                    {Math.round(doc.file.size / 1024)} KB
                  </span>
                  <button
                    type="button"
                    className="icon-btn !h-7 !w-7 text-[#dc3535]"
                    onClick={() => setPendingDocs((prev) => prev.filter((d) => d.id !== doc.id))}
                    aria-label="حذف فایل"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </FormField>

        {/* Summary before save */}
        <div className="rounded-2xl bg-white/40 p-3.5 text-xs leading-6 dark:bg-white/[0.04]">
          <p className="font-bold">خلاصه تراکنش</p>
          <p className="text-ink-500 dark:text-ink-400">
            {TX_TYPE_LABELS[type]} ·{" "}
            {amount != null ? formatMoney(amount, currency) : "مبلغ؟"}
            {type === "exchange" && destAmount != null && destCurrency
              ? ` ⇄ ${formatMoney(destAmount, destCurrency)}`
              : ""}{" "}
            · {affectsBalance ? "تغییر مانده واقعی" : "فقط ثبت اطلاعاتی"}
            {date ? ` · ${formatJalali(date)}` : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}
