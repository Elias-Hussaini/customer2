import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { MoneyInput } from "../ui/MoneyInput";
import { SearchSelect } from "../ui/inputs";
import { createPayment, updatePayment } from "../../db/payments";
import { useCustomers, usePrefs, useRepresentatives, useRequests } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso } from "../../utils/jalali";
import { customerFullName } from "../../db/customers";
import type { Currency, Payment } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  payment?: Payment;
  defaultRepresentativeId?: string;
  onSaved?: () => void;
}

export function PaymentFormModal({ open, onClose, payment, defaultRepresentativeId, onSaved }: Props) {
  const toast = useToast();
  const reps = useRepresentatives() ?? [];
  const customers = useCustomers() ?? [];
  const requests = useRequests() ?? [];
  const prefs = usePrefs();

  const [representativeId, setRepresentativeId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency>("IRT");
  const [date, setDate] = useState<string | null>(todayIso());
  const [description, setDescription] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setErrors({});
      if (payment) {
        setRepresentativeId(payment.representativeId);
        setAmount(payment.amount);
        setCurrency(payment.currency);
        setDate(payment.date);
        setDescription(payment.description ?? "");
        setRequestId(payment.requestId);
      } else {
        setRepresentativeId(defaultRepresentativeId ?? null);
        setAmount(null);
        setCurrency(prefs.defaultCurrency);
        setDate(todayIso());
        setDescription("");
        setRequestId(null);
      }
    }
  }, [open, payment, defaultRepresentativeId, prefs.defaultCurrency]);

  const repItems = reps.map((r) => ({ id: r.id, title: r.name, subtitle: r.phone }));

  const requestItems = useMemo(() => {
    const scoped = representativeId
      ? requests.filter((r) => r.representativeId === representativeId)
      : requests;
    return scoped
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((r) => {
        const customer = customers.find((c) => c.id === r.customerId);
        return {
          id: r.id,
          title: customer ? customerFullName(customer) : "درخواست",
          subtitle: [r.visaType, r.issued ? "صادر شده" : "در حال کار"].filter(Boolean).join(" • "),
        };
      });
  }, [requests, customers, representativeId]);

  const save = async () => {
    const next: Record<string, string> = {};
    if (!representativeId) next.rep = "انتخاب نماینده الزامی است";
    if (amount == null || amount <= 0) next.amount = "مبلغ معتبر وارد کنید";
    if (!date) next.date = "تاریخ را انتخاب کنید";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const input = {
        representativeId: representativeId!,
        requestId,
        amount: amount!,
        currency,
        date: date!,
        description,
      };
      if (payment) {
        await updatePayment(payment.id, input);
        toast.success("پرداخت ویرایش شد");
      } else {
        await createPayment(input);
        toast.success("پرداخت ثبت شد");
      }
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره پرداخت");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={payment ? "ویرایش پرداخت" : "ثبت پرداخت"}
      subtitle="مبالغ دلار و تومان جداگانه نگه داشته می‌شوند"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {payment ? "ذخیره تغییرات" : "ثبت پرداخت"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نماینده" required error={errors.rep}>
          <SearchSelect
            items={repItems}
            value={representativeId}
            onSelect={setRepresentativeId}
            placeholder="انتخاب نماینده…"
            clearable={false}
          />
        </FormField>
        <FormField label="مبلغ" required error={errors.amount}>
          <MoneyInput amount={amount} currency={currency} onAmountChange={setAmount} onCurrencyChange={setCurrency} />
        </FormField>
        <FormField label="تاریخ پرداخت" required error={errors.date}>
          <JalaliDatePicker value={date} onChange={setDate} clearable={false} />
        </FormField>
        <FormField
          label="درخواست مرتبط"
          hint="اختیاری — برای ردیابی آسان‌تر، درخواست ویزای مرتبط را انتخاب کنید"
        >
          <SearchSelect
            items={requestItems}
            value={requestId}
            onSelect={setRequestId}
            placeholder="بدون درخواست مشخص…"
            emptyLabel="درخواستی برای این نماینده نیست"
          />
        </FormField>
        <FormField label="توضیحات">
          <Textarea
            className="!min-h-[64px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="مثلاً پیش‌پرداخت، قسط اول…"
          />
        </FormField>
      </div>
    </Modal>
  );
}
