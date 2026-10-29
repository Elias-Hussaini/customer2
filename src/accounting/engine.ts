/**
 * Pure financial engine — no database, no React. Every function here is
 * deterministic and unit-tested. Balances are ALWAYS derived from finalized
 * transactions so they can never drift away from the audit trail.
 *
 * Integer-safety: all internal arithmetic uses minor units
 * (USD → cents, IRT/AFN → whole units) via utils/num.
 */

import type { Currency } from "../types";
import { CURRENCIES, currencyLabel, zeroByCurrency } from "../types";
import { fromMinor, sumAmounts, toMinor } from "../utils/num";
import type {
  FinAccount,
  FinTransaction,
  FinTxType,
  OutstandingItem,
  OutstandingStatus,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  Account effects & balances                                                */
/* -------------------------------------------------------------------------- */

/** One signed effect on one managed account, in MINOR units. */
export interface AccountEffect {
  accountId: string;
  minor: number; // positive = money enters, negative = money leaves
}

export interface TxValidationError {
  field: string;
  message: string;
}

/**
 * Signed balance effects of a single transaction.
 * Returns [] for informational or cancelled transactions.
 *
 * NOTE: a REVERSED transaction keeps its effects — it genuinely happened,
 * and its linked counter-transaction cancels it (exactly-once). Skipping
 * reversed transactions here would double-subtract the counter entry.
 */
export function txEffects(tx: FinTransaction): AccountEffect[] {
  if (!tx.affectsBalance || tx.status === "cancelled") return [];
  const amt = toMinor(tx.amount, tx.currency);
  switch (tx.type) {
    case "receipt":
    case "opening":
      return tx.destAccountId ? [{ accountId: tx.destAccountId, minor: amt }] : [];
    case "payment":
    case "withdrawal":
      return tx.sourceAccountId ? [{ accountId: tx.sourceAccountId, minor: -amt }] : [];
    case "transfer":
      return [
        ...(tx.sourceAccountId ? [{ accountId: tx.sourceAccountId, minor: -amt }] : []),
        ...(tx.destAccountId ? [{ accountId: tx.destAccountId, minor: amt }] : []),
      ];
    case "exchange": {
      // source side leaves in tx.currency; destination side enters in destCurrency.
      const dstMinor =
        tx.destCurrency && tx.destAmount != null
          ? toMinor(tx.destAmount, tx.destCurrency)
          : null;
      return [
        ...(tx.sourceAccountId ? [{ accountId: tx.sourceAccountId, minor: -amt }] : []),
        ...(tx.destAccountId && dstMinor != null
          ? [{ accountId: tx.destAccountId, minor: dstMinor }]
          : []),
      ];
    }
    case "adjustment": {
      // Direction by which side is set: dest = increase, source = decrease.
      if (tx.destAccountId) return [{ accountId: tx.destAccountId, minor: amt }];
      if (tx.sourceAccountId) return [{ accountId: tx.sourceAccountId, minor: -amt }];
      return [];
    }
    default:
      return [];
  }
}

export interface AccountBalance {
  /** Major units, in the account's own currency. */
  balance: number;
  /** Count of balance-affecting final transactions. */
  txCount: number;
}

/** Derive the current balance of one account from all its transactions. */
export function computeAccountBalance(
  account: FinAccount,
  transactions: FinTransaction[],
): AccountBalance {
  let minor = 0;
  let txCount = 0;
  for (const tx of transactions) {
    const effects = txEffects(tx);
    for (const e of effects) {
      if (e.accountId === account.id) {
        minor += e.minor;
        txCount++;
      }
    }
  }
  return { balance: fromMinor(minor, account.currency), txCount };
}

/** Balances of every account, keyed by account id (major units). */
export function computeAllAccountBalances(
  accounts: FinAccount[],
  transactions: FinTransaction[],
): Map<string, AccountBalance> {
  const minorById = new Map<string, number>();
  const countById = new Map<string, number>();
  for (const tx of transactions) {
    for (const e of txEffects(tx)) {
      minorById.set(e.accountId, (minorById.get(e.accountId) ?? 0) + e.minor);
      countById.set(e.accountId, (countById.get(e.accountId) ?? 0) + 1);
    }
  }
  const out = new Map<string, AccountBalance>();
  for (const acc of accounts) {
    out.set(acc.id, {
      balance: fromMinor(minorById.get(acc.id) ?? 0, acc.currency),
      txCount: countById.get(acc.id) ?? 0,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

export interface TxValidationContext {
  accounts: FinAccount[];
  /** Current balances keyed by account id (for the insufficient-funds warning). */
  balances?: Map<string, AccountBalance>;
}

export interface TxValidationResult {
  errors: TxValidationError[];
  /** Warning (not blocking): source account lacks sufficient funds. */
  insufficientFunds?: { accountId: string; available: number; requested: number };
}

export interface TxInputLike {
  type: FinTxType;
  amount: number;
  currency: Currency;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
  affectsBalance: boolean;
  destAmount?: number | null;
  destCurrency?: Currency | null;
  exchangeRate?: number | null;
}

/**
 * Structural + monetary validation of a transaction input.
 * Returns a list of user-facing errors (empty = valid) and an optional
 * insufficient-funds warning the UI must surface explicitly.
 */
export function validateTx(input: TxInputLike, ctx: TxValidationContext): TxValidationResult {
  const errors: TxValidationError[] = [];
  const result: TxValidationResult = { errors };
  const accountsById = new Map(ctx.accounts.map((a) => [a.id, a]));

  if (!(input.amount > 0)) {
    errors.push({ field: "amount", message: "مبلغ باید بزرگ‌تر از صفر باشد." });
  }
  if (!input.affectsBalance) {
    // Informational record — must NOT reference accounts at all.
    if (input.sourceAccountId || input.destAccountId) {
      errors.push({
        field: "affectsBalance",
        message: "رکورد اطلاعاتی نباید صندوق/حساب بانکی داشته باشد.",
      });
    }
    return result;
  }

  const src = input.sourceAccountId ? accountsById.get(input.sourceAccountId) : undefined;
  const dst = input.destAccountId ? accountsById.get(input.destAccountId) : undefined;

  switch (input.type) {
    case "receipt":
    case "opening":
      if (!dst) {
        errors.push({ field: "destAccountId", message: "حساب مقصد (دریافت) الزامی است." });
      } else if (dst.currency !== input.currency) {
        errors.push({
          field: "destAccountId",
          message: `ارز حساب «${dst.name}» (${currencyLabel(dst.currency)}) با ارز تراکنش یکی نیست.`,
        });
      }
      break;

    case "payment":
    case "withdrawal":
      if (!src) {
        errors.push({ field: "sourceAccountId", message: "حساب مبدأ (پرداخت) الزامی است." });
      } else if (src.currency !== input.currency) {
        errors.push({
          field: "sourceAccountId",
          message: `ارز حساب «${src.name}» با ارز تراکنش یکی نیست.`,
        });
      } else if (ctx.balances) {
        const bal = ctx.balances.get(src.id);
        if (bal && bal.balance < input.amount) {
          result.insufficientFunds = {
            accountId: src.id,
            available: bal.balance,
            requested: input.amount,
          };
        }
      }
      break;

    case "transfer":
      if (!src) errors.push({ field: "sourceAccountId", message: "حساب مبدأ الزامی است." });
      if (!dst) errors.push({ field: "destAccountId", message: "حساب مقصد الزامی است." });
      if (src && dst) {
        if (src.id === dst.id) {
          errors.push({ field: "destAccountId", message: "حساب مبدأ و مقصد نباید یکی باشد." });
        } else if (src.currency !== input.currency || dst.currency !== input.currency) {
          errors.push({
            field: "currency",
            message: "انتقال داخلی فقط بین دو حساب با ارز یکسان ممکن است؛ برای ارز متفاوت از «تبدیل ارز» استفاده کنید.",
          });
        }
        if (src && ctx.balances && src.currency === input.currency) {
          const bal = ctx.balances.get(src.id);
          if (bal && bal.balance < input.amount) {
            result.insufficientFunds = {
              accountId: src.id,
              available: bal.balance,
              requested: input.amount,
            };
          }
        }
      }
      break;

    case "exchange": {
      if (!src) errors.push({ field: "sourceAccountId", message: "حساب مبدأ الزامی است." });
      if (!dst) errors.push({ field: "destAccountId", message: "حساب مقصد الزامی است." });
      if (src && dst) {
        if (src.id === dst.id) {
          errors.push({ field: "destAccountId", message: "حساب مبدأ و مقصد نباید یکی باشد." });
        }
        if (src.currency === dst.currency) {
          errors.push({
            field: "destAccountId",
            message: "تبدیل ارز فقط بین دو حساب با ارز متفاوت معنا دارد؛ برای ارز یکسان از «انتقال داخلی» استفاده کنید.",
          });
        }
        if (src.currency !== input.currency) {
          errors.push({ field: "currency", message: "ارز تراکنش باید با ارز حساب مبدأ یکی باشد." });
        }
      }
      if (!(input.destAmount && input.destAmount > 0)) {
        errors.push({ field: "destAmount", message: "مبلغ مقصد باید بزرگ‌تر از صفر باشد." });
      }
      if (!(input.exchangeRate && input.exchangeRate > 0)) {
        errors.push({ field: "exchangeRate", message: "نرخ تبدیل باید بزرگ‌تر از صفر باشد." });
      }
      if (src && ctx.balances && src.currency === input.currency) {
        const bal = ctx.balances.get(src.id);
        if (bal && bal.balance < input.amount) {
          result.insufficientFunds = {
            accountId: src.id,
            available: bal.balance,
            requested: input.amount,
          };
        }
      }
      break;
    }

    case "adjustment":
      if (src && dst) {
        errors.push({
          field: "sourceAccountId",
          message: "برای تعدیل فقط یک حساب انتخاب کنید (مقصد = افزایش، مبدأ = کاهش).",
        });
      } else if (!src && !dst) {
        errors.push({ field: "destAccountId", message: "حساب تعدیل‌شده را انتخاب کنید." });
      } else {
        const acc = dst ?? src!;
        if (acc.currency !== input.currency) {
          errors.push({ field: "currency", message: "ارز حساب با ارز تعدیل یکی نیست." });
        }
      }
      break;
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Reversal                                                                  */
/* -------------------------------------------------------------------------- */

export interface ReversalDraft {
  type: FinTxType;
  amount: number;
  currency: Currency;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
  affectsBalance: boolean;
  destAmount?: number | null;
  destCurrency?: Currency | null;
  exchangeRate?: number | null;
}

/**
 * The mirrored counter-entry that exactly cancels the original's effects.
 * For a receipt the counter is a payment-like outflow from the same account,
 * and vice versa. Transfers/exchanges swap their two sides.
 */
export function buildReversalDraft(original: FinTransaction): ReversalDraft {
  switch (original.type) {
    case "receipt":
    case "opening":
      return {
        type: "payment",
        amount: original.amount,
        currency: original.currency,
        sourceAccountId: original.destAccountId,
        destAccountId: null,
        affectsBalance: original.affectsBalance,
      };
    case "payment":
    case "withdrawal":
      return {
        type: "receipt",
        amount: original.amount,
        currency: original.currency,
        sourceAccountId: null,
        destAccountId: original.sourceAccountId,
        affectsBalance: original.affectsBalance,
      };
    case "transfer":
      return {
        type: original.type,
        amount: original.amount,
        currency: original.currency,
        sourceAccountId: original.destAccountId,
        destAccountId: original.sourceAccountId,
        affectsBalance: original.affectsBalance,
      };
    case "exchange":
      // The counter moves the ORIGINAL DESTINATION side out (it became the
      // source) and brings the ORIGINAL primary side back in as its dest.
      return {
        type: "exchange",
        amount: original.destAmount ?? original.amount,
        currency: original.destCurrency ?? original.currency,
        sourceAccountId: original.destAccountId,
        destAccountId: original.sourceAccountId,
        affectsBalance: original.affectsBalance,
        destAmount: original.amount,
        destCurrency: original.currency,
        exchangeRate: original.exchangeRate ?? null,
      };
    case "adjustment":
      // Mirror: an increase becomes a decrease on the same account.
      return original.destAccountId
        ? {
            type: "adjustment",
            amount: original.amount,
            currency: original.currency,
            sourceAccountId: original.destAccountId,
            destAccountId: null,
            affectsBalance: original.affectsBalance,
          }
        : {
            type: "adjustment",
            amount: original.amount,
            currency: original.currency,
            sourceAccountId: null,
            destAccountId: original.sourceAccountId,
            affectsBalance: original.affectsBalance,
          };
    default:
      return {
        type: "adjustment",
        amount: original.amount,
        currency: original.currency,
        sourceAccountId: original.sourceAccountId,
        destAccountId: original.destAccountId,
        affectsBalance: original.affectsBalance,
      };
  }
}

/** True when effects(tx) + effects(reversal) === zero on every account. */
export function reversalCancelsExactly(original: FinTransaction, reversal: FinTransaction): boolean {
  const sum = new Map<string, number>();
  for (const e of [...txEffects(original), ...txEffects(reversal)]) {
    sum.set(e.accountId, (sum.get(e.accountId) ?? 0) + e.minor);
  }
  return [...sum.values()].every((v) => v === 0);
}

/* -------------------------------------------------------------------------- */
/*  Party statements                                                          */
/* -------------------------------------------------------------------------- */

export interface PartyTotals {
  receipts: Record<Currency, number>;
  payments: Record<Currency, number>;
  withdrawals: Record<Currency, number>;
  /** receipts − payments per currency (party's net movement against us). */
  net: Record<Currency, number>;
  count: number;
}

/**
 * Financial totals for one party across the historical record.
 * Reversed transactions count (they happened; their counter-entries net them
 * out) — only cancelled records are excluded.
 */
export function computePartyTotals(partyId: string, transactions: FinTransaction[]): PartyTotals {
  const empty = () => ({ USD: 0, IRT: 0, AFN: 0 }) as Record<Currency, number>;
  const totals: PartyTotals = {
    receipts: empty(),
    payments: empty(),
    withdrawals: empty(),
    net: empty(),
    count: 0,
  };
  const add = (map: Record<Currency, number>, currency: Currency, amounts: number[]) => {
    map[currency] = sumAmounts([...(map[currency] ? [map[currency]] : []), ...amounts], currency);
  };
  const byCurrency: Record<string, Record<Currency, number[]>> = {
    receipt: { USD: [], IRT: [], AFN: [] },
    payment: { USD: [], IRT: [], AFN: [] },
    withdrawal: { USD: [], IRT: [], AFN: [] },
  };
  for (const tx of transactions) {
    if (tx.partyId !== partyId) continue;
    if (tx.status === "cancelled") continue;
    totals.count++;
    const bucket = byCurrency[tx.type];
    if (bucket) bucket[tx.currency].push(tx.amount);
  }
  for (const c of CURRENCIES) {
    add(totals.receipts, c, byCurrency.receipt[c]);
    add(totals.payments, c, byCurrency.payment[c]);
    add(totals.withdrawals, c, byCurrency.withdrawal[c]);
    const received = toMinor(totals.receipts[c], c);
    const paid = toMinor(totals.payments[c], c);
    totals.net[c] = fromMinor(received - paid, c);
  }
  return totals;
}

export interface StatementRow {
  tx: FinTransaction;
  /** Signed party-side movement in minor units (receipt +, payment −). */
  signedMinor: number;
  /** Running balance in MAJOR units per currency after this row. */
  running: Record<Currency, number>;
}

/**
 * Chronological party statement with a per-currency running balance.
 * Only receipt / payment / withdrawal rows move the party balance;
 * transfers/exchanges/openings are listed for completeness with zero effect.
 */
export function buildStatementRows(partyId: string, transactions: FinTransaction[]): {
  rows: StatementRow[];
  closing: Record<Currency, number>;
} {
  const relevant = transactions
    .filter((t) => t.partyId === partyId && t.status !== "cancelled")
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  const running: Record<Currency, number> = { USD: 0, IRT: 0, AFN: 0 };
  const rows: StatementRow[] = [];
  for (const tx of relevant) {
    const amt = toMinor(tx.amount, tx.currency);
    let signed = 0;
    if (tx.status === "final") {
      if (tx.type === "receipt") signed = amt;
      else if (tx.type === "payment" || tx.type === "withdrawal") signed = -amt;
    }
    running[tx.currency] += signed;
    rows.push({
      tx,
      signedMinor: signed,
      running: {
        USD: fromMinor(running.USD, "USD"),
        IRT: running.IRT,
        AFN: running.AFN,
      },
    });
  }
  return {
    rows,
    closing: { USD: fromMinor(running.USD, "USD"), IRT: running.IRT, AFN: running.AFN },
  };
}

/* -------------------------------------------------------------------------- */
/*  Outstanding items                                                         */
/* -------------------------------------------------------------------------- */

/** Remaining amount (major units) of an outstanding item. */
export function outstandingRemaining(item: OutstandingItem): number {
  const settled = item.settlements.reduce((s, x) => s + toMinor(x.amount, item.currency), 0);
  return fromMinor(toMinor(item.amount, item.currency) - settled, item.currency);
}

/** Effective status — always re-derived from the actual settlements. */
export function outstandingEffectiveStatus(
  item: OutstandingItem,
  todayIso: string,
): OutstandingStatus | "overdue" {
  if (item.status === "cancelled") return "cancelled";
  const totalMinor = toMinor(item.amount, item.currency);
  const settledMinor = item.settlements.reduce(
    (s, x) => s + toMinor(x.amount, item.currency),
    0,
  );
  if (settledMinor >= totalMinor) return "settled";
  if (item.dueDate && item.dueDate < todayIso) return "overdue";
  if (settledMinor > 0) return "partial";
  return "open";
}

/** Validate a new settlement against the remaining amount. */
export function validateSettlement(item: OutstandingItem, amount: number): string | null {
  if (!(amount > 0)) return "مبلغ تسویه باید بزرگ‌تر از صفر باشد.";
  const remaining = outstandingRemaining(item);
  if (toMinor(amount, item.currency) > toMinor(remaining, item.currency)) {
    return `مبلغ تسویه از مانده (${remaining.toLocaleString("fa-IR")}) بیشتر است.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Aggregations for dashboard & reports                                      */
/* -------------------------------------------------------------------------- */

export type PeriodGranularity = "day" | "week" | "month" | "year";

export interface TypeTotals {
  /** Count of final transactions per type. */
  count: Partial<Record<FinTxType, number>>;
  /** Totals per type per currency (major units). */
  totals: Partial<Record<FinTxType, Record<Currency, number>>>;
}

/**
 * Does this transaction count toward income/expense totals and charts?
 * A REVERSED transaction and its counter-entry (reversalOf) are BOTH
 * excluded: the reversal is an internal correction, not real business
 * income/expense — so a refunded receipt must lower the receipts total
 * back down instead of inflating both sides. Balances still net to zero
 * through the mirrored counter-entry (see txEffects).
 */
export function countsTowardTotals(tx: FinTransaction): boolean {
  return tx.status !== "cancelled" && tx.status !== "reversed" && !tx.reversalOf;
}

export function totalsByType(transactions: FinTransaction[]): TypeTotals {
  const out: TypeTotals = { count: {}, totals: {} };
  for (const tx of transactions) {
    if (!countsTowardTotals(tx)) continue;
    out.count[tx.type] = (out.count[tx.type] ?? 0) + 1;
    const bucket = (out.totals[tx.type] ?? { USD: 0, IRT: 0, AFN: 0 }) as Record<Currency, number>;
    bucket[tx.currency] = sumAmounts([bucket[tx.currency], tx.amount], tx.currency);
    out.totals[tx.type] = bucket;
  }
  return out;
}

export interface PeriodBucket {
  /** Bucket key — ISO date of the bucket start (day/week/month/year). */
  key: string;
  label: string;
  receipts: Record<Currency, number>;
  payments: Record<Currency, number>;
  withdrawals: Record<Currency, number>;
  count: number;
}

/**
 * Group transactions into period buckets for charts.
 * Buckets are built on Jalali months/years but keyed by Gregorian ISO start
 * date so sorting stays trivial.
 */
export function groupByPeriod(
  transactions: FinTransaction[],
  granularity: PeriodGranularity,
  jalaliLabel: (iso: string, granularity: PeriodGranularity) => string,
): PeriodBucket[] {
  const map = new Map<string, PeriodBucket>();
  for (const tx of transactions) {
    if (!countsTowardTotals(tx)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) continue;
    const key = bucketKey(tx.date, granularity);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: jalaliLabel(key, granularity),
        receipts: { USD: 0, IRT: 0, AFN: 0 },
        payments: { USD: 0, IRT: 0, AFN: 0 },
        withdrawals: { USD: 0, IRT: 0, AFN: 0 },
        count: 0,
      };
      map.set(key, bucket);
    }
    bucket.count++;
    const minor = toMinor(tx.amount, tx.currency);
    const target =
      tx.type === "receipt"
        ? bucket.receipts
        : tx.type === "payment"
          ? bucket.payments
          : tx.type === "withdrawal"
            ? bucket.withdrawals
            : null;
    if (target) target[tx.currency] += minor;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

function bucketKey(iso: string, g: PeriodGranularity): string {
  switch (g) {
    case "day":
      return iso;
    case "week": {
      // Saturday-start week (Iranian convention).
      const d = new Date(`${iso}T00:00:00`);
      const day = (d.getDay() + 1) % 7; // Sat=0 … Fri=6
      d.setDate(d.getDate() - day);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
    }
    case "month":
      return iso.slice(0, 7) + "-01";
    case "year":
      return iso.slice(0, 4) + "-01-01";
  }
}

/** Total actual cash+bank balances per currency across all active accounts. */
export function totalCashBalances(
  accounts: FinAccount[],
  transactions: FinTransaction[],
): Record<Currency, number> {
  const balances = computeAllAccountBalances(accounts, transactions);
  const out = zeroByCurrency();
  for (const c of CURRENCIES) {
    const curAccounts = accounts.filter((a) => a.currency === c && a.active);
    out[c] = sumAmounts(curAccounts.map((a) => balances.get(a.id)?.balance ?? 0), c);
  }
  return out;
}
