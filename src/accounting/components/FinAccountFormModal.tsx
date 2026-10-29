/** Create / edit a managed cash box or bank account, with an auditable
 *  opening balance that is recorded as a real "opening" transaction. */

import { useEffect, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/fields";
import { FormField } from "../../components/ui/fields";
import { RadioSelect } from "../../components/ui/inputs";
import { JalaliDatePicker } from "../../components/ui/JalaliDatePicker";
import { useToast } from "../../hooks/useToast";
import { todayIso } from "../../utils/jalali";
import { parseAmountInput } from "../../utils/num";
import { ACC_CURRENCIES, CURRENCY_LABELS, type Currency } from "../../types";
import { createAccount, updateAccount } from "../repo";
import {
  ACCOUNT_TYPE_LABELS,
  type FinAccount,
  type FinAccountType,
} from "../types";

interface FinAccountFormModalProps {
  open: boolean;
  onClose: () => void;
  editAccount?: FinAccount | null;
}

export function FinAccountFormModal({ open, onClose, editAccount }: FinAccountFormModalProps) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<FinAccountType>("cash");
  const [currency, setCurrency] = useState<Currency>("IRT");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [openingBalance, setOpeningBalance] = useState<number | null>(null);
  const [openingDate, setOpeningDate] = useState<string | null>(todayIso());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editAccount) {
      setName(editAccount.name);
      setType(editAccount.type);
      setCurrency(editAccount.currency);
      setDescription(editAccount.description ?? "");
      setActive(editAccount.active);
      setOpeningBalance(null);
    } else {
      setName("");
      setType("cash");
      setCurrency("IRT");
      setDescription("");
      setActive(true);
      setOpeningBalance(null);
      setOpeningDate(todayIso());
    }
  }, [open, editAccount]);

  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      toast.error("نام حساب الزامی است.");
      return;
    }
    setBusy(true);
    try {
      if (editAccount) {
        await updateAccount(editAccount.id, {
          name,
          type,
          currency,
          description,
          active,
        });
        toast.success(`حساب «${name.trim()}» به‌روزرسانی شد`);
      } else {
        await createAccount({
          name,
          type,
          currency,
          description,
          active,
          openingBalance: openingBalance ?? undefined,
          openingDate: openingDate ?? todayIso(),
        });
        toast.success(
          openingBalance && openingBalance > 0
            ? `حساب «${name.trim()}» با مانده اولیه ساخته شد`
            : `حساب «${name.trim()}» ساخته شد`,
        );
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editAccount ? `ویرایش حساب «${editAccount.name}»` : "صندوق / حساب بانکی جدید"}
      subtitle={
        editAccount
          ? "تغییر ارز برای حساب‌های دارای تراکنش امکان‌پذیر نیست"
          : "مانده اولیه به‌صورت یک تراکنش قابل حسابرسی ثبت می‌شود"
      }
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {editAccount ? "ذخیره تغییرات" : "ایجاد حساب"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="نام حساب" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً: صندوق دفتر / بانک ملت - دلاری"
          />
        </FormField>

        <FormField label="نوع حساب" required>
          <RadioSelect
            options={[
              { value: "cash", label: ACCOUNT_TYPE_LABELS.cash },
              { value: "bank", label: ACCOUNT_TYPE_LABELS.bank },
              { value: "other", label: ACCOUNT_TYPE_LABELS.other },
            ]}
            value={type}
            onChange={(v) => setType(v as FinAccountType)}
          />
        </FormField>

        <FormField label="ارز حساب" required hint="هر حساب فقط یک ارز دارد — ارزها هرگز با هم ترکیب نمی‌شوند">
          <RadioSelect
            options={[
              { value: "IRT", label: "تومان" },
              { value: "USD", label: "دلار" },
              { value: "AFN", label: "افغانی" },
            ]}
            value={currency}
            onChange={(v) => setCurrency(v as Currency)}
            disabled={Boolean(editAccount)}
          />
        </FormField>

        {!editAccount && (
          <div className="grid gap-4 rounded-2xl border border-brand-500/20 bg-brand-500/[0.04] p-3.5 sm:grid-cols-2">
            <FormField label="مانده اولیه (اختیاری)">
              <Input
                dir="ltr"
                className="num text-right"
                inputMode="decimal"
                value={openingBalance ?? ""}
                onChange={(e) => setOpeningBalance(parseAmountInput(e.target.value))}
                placeholder="0"
              />
            </FormField>
            <FormField label="تاریخ مانده اولیه">
              <JalaliDatePicker value={openingDate} onChange={setOpeningDate} clearable={false} />
            </FormField>
          </div>
        )}

        <FormField label="توضیحات">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="شماره شبا، مسئول صندوق و…"
          />
        </FormField>

        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium">
          <input
            type="checkbox"
            className="sr-only"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-[7px] border transition-all ${
              active ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300 dark:border-ink-600"
            }`}
            aria-hidden
          >
            {active && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2 6.5 4.8 9 10 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          حساب فعال باشد
        </label>
      </div>
    </Modal>
  );
}
