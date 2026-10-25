import { useState } from "react";
import type { Currency } from "../../types";
import { CURRENCY_LABELS } from "../../types";
import { formatAmountPlain, parseAmountInput } from "../../utils/num";

interface MoneyInputProps {
  amount: number | null | undefined;
  currency: Currency | undefined;
  onAmountChange: (amount: number | null) => void;
  onCurrencyChange: (currency: Currency) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Amount input with live Persian digit normalization + currency switch. */
export function MoneyInput({
  amount,
  currency,
  onAmountChange,
  onCurrencyChange,
  placeholder = "مبلغ",
  disabled,
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const display = focused
    ? draft
    : amount != null
      ? formatAmountPlain(amount).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      : "";

  return (
    <div className="flex gap-2">
      <input
        dir="ltr"
        className="field num flex-1 text-right"
        value={display}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          setFocused(true);
          setDraft(amount != null ? String(amount) : "");
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          onAmountChange(parseAmountInput(draft));
        }}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          setDraft(cleaned);
          onAmountChange(parseAmountInput(cleaned));
        }}
      />
      <div className="flex shrink-0 overflow-hidden rounded-[0.85rem] border border-ink-900/10 dark:border-white/10">
        {(Object.keys(CURRENCY_LABELS) as Currency[]).map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => onCurrencyChange(c)}
            className={`px-3.5 text-xs font-bold transition-colors ${
              currency === c
                ? "bg-brand-500 text-white"
                : "bg-white/60 text-ink-500 hover:bg-white/90 dark:bg-white/5 dark:text-ink-300 dark:hover:bg-white/10"
            }`}
          >
            {CURRENCY_LABELS[c]}
          </button>
        ))}
      </div>
    </div>
  );
}
