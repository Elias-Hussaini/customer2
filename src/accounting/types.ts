/**
 * Accounting module (بخش حسابداری) — a self-contained financial world:
 * parties (people & companies), managed cash/bank accounts, transactions
 * (receipts / payments / withdrawals / transfers / exchanges / adjustments),
 * outstanding receivables & payables, documents, and settings.
 *
 * Completely separate from the visa-management data — linked only through
 * the shared activity audit trail and the shared backup format.
 *
 * Money rules (critical):
 *  - Exactly two currencies: USD and IRT (displayed as تومان).
 *  - All arithmetic happens in integer minor units (USD cents / whole tomans)
 *    via utils/num toMinor/fromMinor. Currencies never mix.
 *  - Account balances are DERIVED from finalized transactions — never stored.
 *  - Informational transactions never touch actual balances.
 */

import type { Currency } from "../types";

/* ------------------------------- Parties --------------------------------- */

export type PartyType = "individual" | "company";

export interface AccParty {
  id: string;
  /** Human-readable account code, e.g. P-0001 / C-0002. */
  code: string;
  type: PartyType;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** شناسنامه/کد ملی for individuals, شناسه ملی for companies. */
  idNumber?: string;
  /** Company registration number (شماره ثبت). */
  regNumber?: string;
  notes?: string;
  tags: string[];
  /** Profile photo / logo document id (accDocs). */
  photoDocId?: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/* --------------------------- Managed accounts ----------------------------- */

export type FinAccountType = "cash" | "bank" | "other";

export interface FinAccount {
  id: string;
  name: string;
  type: FinAccountType;
  currency: Currency;
  description?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------ Transactions ------------------------------ */

export type FinTxType =
  | "receipt" // دریافت — money in
  | "payment" // پرداخت — money out to a party/supplier
  | "withdrawal" // برداشت — owner withdrawal / non-party outflow
  | "transfer" // انتقال داخلی — between accounts of the SAME currency
  | "exchange" // تبدیل ارز — between accounts of DIFFERENT currencies
  | "adjustment" // تعدیل — reconciliation correction
  | "opening"; // مانده اولیه — auditable opening balance entry

export type FinTxStatus = "final" | "reversed" | "cancelled";

export interface FinTransaction {
  id: string;
  /** Human-readable reference, e.g. TR-1404-0007. */
  number: string;
  type: FinTxType;
  partyId?: string | null;
  /** Major units, always positive. Direction follows the type. */
  amount: number;
  currency: Currency;
  /** ISO yyyy-mm-dd (Gregorian, displayed as Jalali). */
  date: string;
  description?: string;
  reference?: string;
  category?: string;
  /** Account the money leaves (source). */
  sourceAccountId?: string | null;
  /** Account the money enters (destination). */
  destAccountId?: string | null;
  /** Real cash movement (true) vs informational record (false). */
  affectsBalance: boolean;
  status: FinTxStatus;
  /** This transaction reverses that one. */
  reversalOf?: string | null;
  /** That (later) transaction reverses this one. */
  reversedBy?: string | null;
  /** Reason for reversal / cancellation / override. */
  reason?: string;
  /** Exchange only: destination side. */
  exchangeRate?: number | null;
  destAmount?: number | null;
  destCurrency?: Currency | null;
  /** Linked outstanding item this transaction settles (informational link). */
  settlementOf?: string | null;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------- Outstanding balances --------------------------- */

export type OutstandingKind = "receivable" | "payable";
export type OutstandingStatus = "open" | "partial" | "settled" | "cancelled";

export interface OutstandingSettlement {
  id: string;
  /** Optionally linked transaction that paid this part. */
  transactionId?: string | null;
  amount: number;
  date: string;
  note?: string;
}

export interface OutstandingItem {
  id: string;
  kind: OutstandingKind;
  partyId: string;
  amount: number;
  currency: Currency;
  dueDate?: string | null;
  description?: string;
  reference?: string;
  status: OutstandingStatus;
  settlements: OutstandingSettlement[];
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------- Documents ------------------------------- */

export interface AccDoc {
  id: string;
  partyId?: string | null;
  transactionId?: string | null;
  accountId?: string | null;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  category?: string;
  notes?: string;
  createdAt: number;
  /** Timestamp of the last at-rest compression attempt (background pass marker). */
  opt?: number;
}

/* -------------------------------- Settings -------------------------------- */

export interface AccSettings {
  id: "acc";
  /** Transaction sequence counters per Jalali year: {"1404": 12}. */
  txCounters: Record<string, number>;
  /** Party code sequence. */
  partyCounter: number;
  defaultCurrency: Currency;
  /** Transaction number prefix (TR). */
  txPrefix: string;
  /** Default transaction categories. */
  categories: string[];
  updatedAt: number;
}

export const DEFAULT_ACC_SETTINGS: AccSettings = {
  id: "acc",
  txCounters: {},
  partyCounter: 0,
  defaultCurrency: "IRT",
  txPrefix: "TR",
  categories: ["خدمات", "ویزا", "کمیسیون", "هزینه اداری", "سایر"],
  updatedAt: 0,
};

/* ------------------------------ Backup format ----------------------------- */

export interface AccBackupData {
  parties: AccParty[];
  accounts: FinAccount[];
  transactions: FinTransaction[];
  outstanding: OutstandingItem[];
  docsMeta: Omit<AccDoc, "blob">[];
  settings: AccSettings | null;
}

export interface AccBackupFile {
  format: "emanagement-acc-backup";
  version: number;
  exportedAt: number;
  schemaVersion: number;
  counts: Record<string, number>;
  data: AccBackupData;
}

/* --------------------------------- Labels --------------------------------- */

export const TX_TYPE_LABELS: Record<FinTxType, string> = {
  receipt: "دریافت",
  payment: "پرداخت",
  withdrawal: "برداشت",
  transfer: "انتقال داخلی",
  exchange: "تبدیل ارز",
  adjustment: "تعدیل",
  opening: "مانده اولیه",
};

export const TX_STATUS_LABELS: Record<FinTxStatus, string> = {
  final: "قطعی",
  reversed: "برگشت خورده",
  cancelled: "ابطال شده",
};

export const ACCOUNT_TYPE_LABELS: Record<FinAccountType, string> = {
  cash: "صندوق نقدی",
  bank: "حساب بانکی",
  other: "سایر",
};

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  individual: "شخص حقیقی",
  company: "شرکت",
};

export const OUTSTANDING_KIND_LABELS: Record<OutstandingKind, string> = {
  receivable: "مطالبات (طلب ما)",
  payable: "بدهی (طلب طرف حساب)",
};

export const OUTSTANDING_STATUS_LABELS: Record<OutstandingStatus | "overdue", string> = {
  open: "باز",
  partial: "پرداخت جزئی",
  settled: "تسویه شده",
  cancelled: "ابطال شده",
  overdue: "سررسید گذشته",
};

export const DOC_CATEGORY_LABELS = ["رسید", "فاکتور", "قرارداد", "سند بانکی", "سایر"] as const;
