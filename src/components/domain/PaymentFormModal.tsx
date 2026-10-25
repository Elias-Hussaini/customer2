import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Eye, ImagePlus, Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormField, Input, Textarea } from "../ui/fields";
import { JalaliDatePicker } from "../ui/JalaliDatePicker";
import { MoneyInput } from "../ui/MoneyInput";
import { SearchSelect } from "../ui/inputs";
import { AttachmentPreview } from "../ui/AttachmentPreview";
import { createPayment, updatePayment } from "../../db/payments";
import { saveReceipt, deleteAttachment, getReceipt } from "../../db/attachments";
import { useCustomers, usePrefs, useRepresentatives, useRequests } from "../../hooks/useData";
import { useToast } from "../../hooks/useToast";
import { todayIso } from "../../utils/jalali";
import { customerFullName } from "../../db/customers";
import type { Attachment, Currency, Payment } from "../../types";

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

  // Optional receipt photo — picked locally (new/replace) or existing.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptRemoved, setReceiptRemoved] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<Pick<Attachment, "name" | "mime" | "blob"> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingReceipt = useLiveQuery(
    () => (payment ? getReceipt(payment.id) : Promise.resolve(undefined)),
    [payment?.id],
  );

  const shownReceipt: Attachment | null = receiptRemoved
    ? null
    : (existingReceipt ?? null);

  useEffect(() => {
    if (open) {
      setErrors({});
      setReceiptFile(null);
      setReceiptRemoved(false);
      setPreviewAtt(null);
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
        // Receipt housekeeping: replace or remove together with the edit.
        if (receiptFile) {
          if (existingReceipt) await deleteAttachment(existingReceipt.id);
          await saveReceipt(payment.id, receiptFile);
        } else if (receiptRemoved && existingReceipt) {
          await deleteAttachment(existingReceipt.id);
        }
        toast.success("پرداخت ویرایش شد");
      } else {
        const created = await createPayment(input);
        if (receiptFile) await saveReceipt(created.id, receiptFile);
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

  const receiptUrl = receiptFile ? URL.createObjectURL(receiptFile) : null;
  // Keep the object URL stable while the file is unchanged.
  useEffect(() => {
    return () => {
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    };
  }, [receiptUrl]);

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

        {/* Optional receipt photo */}
        <FormField label="عکس رسید" hint="اختیاری — رسید پرداخت را همراه همین ثبت پیوست کنید">
          <div className="flex flex-wrap items-center gap-2.5">
            {receiptFile ? (
              <>
                <button
                  type="button"
                  className="h-16 w-16 overflow-hidden rounded-xl border border-ink-900/5 dark:border-white/10"
                  onClick={() =>
                    setPreviewAtt({ name: receiptFile.name, mime: receiptFile.type, blob: receiptFile })
                  }
                >
                  <img src={receiptUrl ?? ""} alt="رسید" className="h-full w-full object-cover" />
                </button>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-glass btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus size={14} /> جایگزینی
                  </button>
                  <button
                    type="button"
                    className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                    aria-label="حذف"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptRemoved(true);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </>
            ) : shownReceipt ? (
              <>
                <button
                  type="button"
                  className="h-16 w-16 overflow-hidden rounded-xl border border-ink-900/5 dark:border-white/10"
                  onClick={() => setPreviewAtt(shownReceipt)}
                >
                  {shownReceipt.mime.startsWith("image/") ? (
                    <img
                      src={URL.createObjectURL(shownReceipt.blob)}
                      alt="رسید"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-400">
                      {shownReceipt.name}
                    </span>
                  )}
                </button>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className="icon-btn !h-8 !w-8"
                    aria-label="مشاهده"
                    onClick={() => setPreviewAtt(shownReceipt)}
                  >
                    <Eye size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-glass btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus size={14} /> جایگزینی
                  </button>
                  <button
                    type="button"
                    className="icon-btn !h-8 !w-8 hover:!text-[#ef4444]"
                    aria-label="حذف"
                    onClick={() => setReceiptRemoved(true)}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </>
            ) : (
              <button type="button" className="btn btn-glass btn-sm" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={14} /> افزودن عکس رسید
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setReceiptFile(f);
                  setReceiptRemoved(false);
                }
                e.target.value = "";
              }}
            />
          </div>
        </FormField>
      </div>

      <AttachmentPreview attachment={previewAtt} onClose={() => setPreviewAtt(null)} />
    </Modal>
  );
}
