/** Shared presentational bits for the accounting section. */

import type { ReactNode } from "react";
import { Banknote, Building2, Landmark, UserRound, Wallet } from "lucide-react";
import type { Currency } from "../../types";
import { formatMoney } from "../../utils/num";
import {
  ACCOUNT_TYPE_LABELS,
  OUTSTANDING_STATUS_LABELS,
  PARTY_TYPE_LABELS,
  TX_STATUS_LABELS,
  TX_TYPE_LABELS,
  type FinAccountType,
  type FinTxStatus,
  type FinTxType,
  type OutstandingStatus,
  type PartyType,
} from "../types";

/* ------------------------------- Type pills ------------------------------- */

const TX_TYPE_STYLE: Record<FinTxType, string> = {
  receipt: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
  payment: "bg-[#ef4444]/12 text-[#dc3535] dark:text-[#f87b7b]",
  withdrawal: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
  transfer: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
  exchange: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  adjustment: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
  opening: "bg-[#8b5cf6]/12 text-[#7c3aed] dark:text-[#b79bf8]",
};

export function TxTypePill({ type }: { type: FinTxType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TX_TYPE_STYLE[type]}`}
    >
      {TX_TYPE_LABELS[type]}
    </span>
  );
}

const TX_STATUS_STYLE: Record<FinTxStatus, string> = {
  final: "bg-[#10b981]/10 text-[#0b9e6e] dark:text-[#3ddc9a]",
  reversed: "bg-[#f59e0b]/12 text-[#c77d0a] dark:text-[#f5b84f]",
  cancelled: "bg-ink-500/10 text-ink-500 dark:text-ink-400",
};

export function TxStatusPill({ status }: { status: FinTxStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TX_STATUS_STYLE[status]}`}
    >
      {TX_STATUS_LABELS[status]}
    </span>
  );
}

export function InformationalBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-dashed border-[#c77d0a]/60 px-2 py-0.5 text-[10px] font-bold text-[#c77d0a] dark:text-[#f5b84f]"
      title="این رکورد مانده واقعی صندوق/بانک را تغییر نمی‌دهد"
    >
      فقط ثبت
    </span>
  );
}

const OUT_STATUS_STYLE: Record<OutstandingStatus | "overdue", string> = {
  open: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
  partial: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
  settled: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
  cancelled: "bg-ink-500/10 text-ink-500 dark:text-ink-400",
  overdue: "bg-[#ef4444]/14 text-[#dc3535] dark:text-[#f87b7b]",
};

export function OutstandingStatusPill({ status }: { status: OutstandingStatus | "overdue" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${OUT_STATUS_STYLE[status]}`}
    >
      {OUTSTANDING_STATUS_LABELS[status]}
    </span>
  );
}

/* ------------------------------ Money display ----------------------------- */

/** Signed amount: green for inflow (+), red for outflow (−). */
export function SignedAmount({
  amount,
  currency,
  direction,
}: {
  amount: number;
  currency: Currency;
  direction: "in" | "out" | "flat";
}) {
  const color =
    direction === "in"
      ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
      : direction === "out"
        ? "text-[#dc3535] dark:text-[#f87b7b]"
        : "";
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  return (
    <span className={`num font-bold ${color}`}>
      {sign}
      {formatMoney(amount, currency)}
    </span>
  );
}

/** Both currencies side by side with small labels (never combined). */
export function DualMoney({
  usd,
  irt,
  usdLabel = "دلار",
  irtLabel = "تومان",
}: {
  usd: number;
  irt: number;
  usdLabel?: string;
  irtLabel?: string;
}) {
  return (
    <span className="num inline-flex flex-col leading-5">
      <span>{formatMoney(usd, "USD")}</span>
      <span className="text-ink-500 dark:text-ink-400">{formatMoney(irt, "IRT")}</span>
    </span>
  );
  void usdLabel;
  void irtLabel;
}

export function CurrencyChip({ currency }: { currency: Currency }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-extrabold ${
        currency === "USD"
          ? "bg-[#8b5cf6]/12 text-[#7c3aed] dark:text-[#b79bf8]"
          : "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]"
      }`}
    >
      {currency === "USD" ? "USD" : "IRT"}
    </span>
  );
}

/* --------------------------------- Accounts -------------------------------- */

export function AccountTypeIcon({ type, size = 16 }: { type: FinAccountType; size?: number }) {
  const Icon = type === "cash" ? Wallet : type === "bank" ? Landmark : Banknote;
  return <Icon size={size} />;
}

export function accountTypeLabel(type: FinAccountType): string {
  return ACCOUNT_TYPE_LABELS[type];
}

/* --------------------------------- Parties --------------------------------- */

export function PartyAvatar({
  name,
  type,
  photoUrl,
  size = 44,
}: {
  name: string;
  type: PartyType;
  photoUrl?: string | null;
  size?: number;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="shrink-0 rounded-2xl object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = type === "company" ? Building2 : UserRound;
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-2xl ${
        type === "company"
          ? "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]"
          : "bg-brand-500/12 text-brand-600 dark:text-brand-300"
      } font-extrabold`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      title={PARTY_TYPE_LABELS[type]}
    >
      {initials || <Icon size={size * 0.45} />}
    </span>
  );
}

/* ------------------------------- Misc helpers ------------------------------ */

export function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium text-ink-500 dark:text-ink-400">{children}</span>;
}

/** Small titled stat row used inside glass cards. */
export function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "in" | "out";
}) {
  const toneClass =
    tone === "in"
      ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
      : tone === "out"
        ? "text-[#dc3535] dark:text-[#f87b7b]"
        : "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/40 px-3 py-2 dark:bg-white/[0.04]">
      <span className="text-[11.5px] font-medium text-ink-500 dark:text-ink-400">{label}</span>
      <span className={`num text-[13px] font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}
