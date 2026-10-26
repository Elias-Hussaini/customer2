/**
 * Accounting repository — every financial write goes through here.
 *
 * Guarantees:
 *  - Atomic posting: transaction record + numbering + linked settlement +
 *    audit entry all commit inside ONE Dexie transaction, or not at all.
 *  - Idempotent submits: the form passes a per-attempt idempotency key which
 *    becomes the record's primary key — a duplicate submit collides on the
 *    primary key and returns the already-posted transaction instead of
 *    posting twice.
 *  - History preservation: no delete on financial transactions, ever.
 *    Corrections go through reverseTransaction / editTransaction (audited).
 */

import { db } from "../db/schema";
import { logActivity } from "../db/activities";
import { uid } from "../utils/id";
import { formatMoney } from "../utils/num";
import { todayIso, formatJalali } from "../utils/jalali";
import { toJalaali } from "jalaali-js";
import type { Currency } from "../types";
import {
  buildReversalDraft,
  computeAllAccountBalances,
  outstandingRemaining,
  reversalCancelsExactly,
  validateSettlement,
  validateTx,
  type AccountBalance,
} from "./engine";
import {
  DEFAULT_ACC_SETTINGS,
  TX_TYPE_LABELS,
  type AccDoc,
  type AccParty,
  type AccSettings,
  type FinAccount,
  type FinTransaction,
  type FinTxType,
  type OutstandingItem,
  type OutstandingKind,
  type OutstandingSettlement,
  type PartyType,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

export class TxValidationError extends Error {
  constructor(
    public messages: string[],
    public insufficientFunds?: { available: number; requested: number; currency: Currency },
  ) {
    super(messages.join(" — "));
    this.name = "TxValidationError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Settings & numbering                                                      */
/* -------------------------------------------------------------------------- */

export async function getAccSettings(): Promise<AccSettings> {
  const stored = await db.accMeta.get("acc");
  return { ...DEFAULT_ACC_SETTINGS, ...stored, id: "acc" };
}

export async function updateAccSettings(patch: Partial<AccSettings>): Promise<void> {
  const current = await getAccSettings();
  await db.accMeta.put({ ...current, ...patch, id: "acc", updatedAt: Date.now() });
  await logActivity({
    type: "settings",
    entity: "accSettings",
    title: "تنظیمات حسابداری به‌روزرسانی شد",
    detail: Object.keys(patch).join("، "),
  });
}

/** Jalali year of an ISO date — transaction numbers are per Jalali year. */
function jalaliYearOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return toJalaali(y, m, d).jy;
}

/** Reserve the next transaction number atomically (call inside a Dexie tx). */
async function reserveTxNumber(txDateIso: string): Promise<string> {
  const settings = (await db.accMeta.get("acc")) ?? DEFAULT_ACC_SETTINGS;
  const year = String(jalaliYearOf(txDateIso));
  const counters = { ...settings.txCounters };
  counters[year] = (counters[year] ?? 0) + 1;
  await db.accMeta.put({
    ...settings,
    id: "acc",
    txCounters: counters,
    updatedAt: Date.now(),
  });
  return `${settings.txPrefix || "TR"}-${year}-${String(counters[year]).padStart(4, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  Transactions                                                              */
/* -------------------------------------------------------------------------- */

export interface PostTxInput {
  type: FinTxType;
  partyId?: string | null;
  amount: number;
  currency: Currency;
  date: string;
  description?: string;
  reference?: string;
  category?: string;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
  affectsBalance: boolean;
  destAmount?: number | null;
  destCurrency?: Currency | null;
  exchangeRate?: number | null;
  settlementOf?: string | null;
  /** Explicit user acknowledgement of an insufficient-funds warning. */
  overrideInsufficientFunds?: boolean;
  /** Per-attempt key — re-submits return the original instead of double-posting. */
  idempotencyKey?: string;
}

function normalizeTxAmounts(input: PostTxInput): PostTxInput {
  return {
    ...input,
    amount: Math.abs(input.amount),
    destAmount: input.destAmount != null ? Math.abs(input.destAmount) : null,
  };
}

/** Human summary used in audit entries. */
async function txAuditDetail(tx: FinTransaction): Promise<string> {
  const parts: string[] = [
    `شماره ${tx.number} — ${TX_TYPE_LABELS[tx.type]} ${formatMoney(tx.amount, tx.currency)}`,
  ];
  if (tx.partyId) {
    const p = await db.accParties.get(tx.partyId);
    if (p) parts.push(`طرف حساب: ${p.name}`);
  }
  if (tx.destAccountId || tx.sourceAccountId) {
    const ids = [tx.destAccountId, tx.sourceAccountId].filter(Boolean) as string[];
    const names: string[] = [];
    for (const id of ids) {
      const a = await db.accAccounts.get(id);
      if (a) names.push(a.name);
    }
    if (names.length) parts.push(`حساب: ${names.join(" → ")}`);
  }
  if (!tx.affectsBalance) parts.push("رکورد اطلاعاتی (بدون تغییر مانده)");
  parts.push(`تاریخ: ${formatJalali(tx.date)}`);
  return parts.join(" | ");
}

/**
 * Validate + atomically post a transaction. Throws TxValidationError with
 * user-facing messages; insufficient funds requires an explicit override.
 */
export async function postTransaction(input: PostTxInput): Promise<FinTransaction> {
  const normalized = normalizeTxAmounts(input);

  // Atomic duplicate-submit guard: the idempotency key IS the primary key.
  if (normalized.idempotencyKey) {
    const existing = await db.accTransactions.get(normalized.idempotencyKey);
    if (existing) return existing;
  }

  const accounts = await db.accAccounts.toArray();
  const allTx = await db.accTransactions.toArray();
  const balances = computeAllAccountBalances(accounts, allTx);
  const validation = validateTx(normalized, { accounts, balances });
  if (validation.errors.length > 0) {
    throw new TxValidationError(validation.errors.map((e) => e.message));
  }
  if (validation.insufficientFunds && !normalized.overrideInsufficientFunds) {
    throw new TxValidationError(
      ["مانده حساب مبدأ برای این تراکنش کافی نیست."],
      {
        available: validation.insufficientFunds.available,
        requested: validation.insufficientFunds.requested,
        currency: normalized.currency,
      },
    );
  }

  const id = normalized.idempotencyKey ?? uid();
  const posted: FinTransaction = await db.transaction(
    "rw",
    [db.accTransactions, db.accOutstanding, db.accMeta, db.accParties, db.accAccounts, db.activities],
    async (): Promise<FinTransaction> => {
      // Idempotency inside the transaction too (double async submit).
      const existing = await db.accTransactions.get(id);
      if (existing) return existing;

      const number = await reserveTxNumber(normalized.date || todayIso());
      const now = Date.now();
      const tx: FinTransaction = {
        id,
        number,
        type: normalized.type,
        partyId: normalized.partyId || null,
        amount: normalized.amount,
        currency: normalized.currency,
        date: normalized.date || todayIso(),
        description: normalized.description?.trim() || undefined,
        reference: normalized.reference?.trim() || undefined,
        category: normalized.category?.trim() || undefined,
        sourceAccountId: normalized.affectsBalance ? normalized.sourceAccountId || null : null,
        destAccountId: normalized.affectsBalance ? normalized.destAccountId || null : null,
        affectsBalance: normalized.affectsBalance,
        status: "final",
        reversalOf: null,
        reversedBy: null,
        reason: validation.insufficientFunds
          ? "با اطلاع از کسری مانده ثبت شد"
          : undefined,
        exchangeRate:
          normalized.type === "exchange" && normalized.exchangeRate
            ? normalized.exchangeRate
            : null,
        destAmount: normalized.type === "exchange" ? normalized.destAmount ?? null : null,
        destCurrency: normalized.type === "exchange" ? normalized.destCurrency ?? null : null,
        settlementOf: normalized.settlementOf || null,
        createdAt: now,
        updatedAt: now,
      };
      await db.accTransactions.add(tx);

      // Linked outstanding item → append the settlement part.
      if (tx.settlementOf) {
        const item = await db.accOutstanding.get(tx.settlementOf);
        if (item && item.currency === tx.currency) {
          const settlement: OutstandingSettlement = {
            id: uid(),
            transactionId: tx.id,
            amount: Math.min(tx.amount, outstandingRemaining(item)),
            date: tx.date,
            note: `تسویه خودکار از تراکنش ${tx.number}`,
          };
          const settlements = [...item.settlements, settlement];
          await db.accOutstanding.put({
            ...item,
            settlements,
            status: deriveOutstandingStatus(item.amount, settlements, item.currency),
            updatedAt: now,
          });
        }
      }

      await logActivity({
        type: "acc-post",
        entity: "accTx",
        entityId: tx.id,
        title: `تراکنش ${TX_TYPE_LABELS[tx.type]} ثبت شد`,
        detail: await txAuditDetail(tx),
      });
      return tx;
    },
  );
  return posted;
}

function deriveOutstandingStatus(
  amount: number,
  settlements: OutstandingSettlement[],
  currency: Currency,
): OutstandingItem["status"] {
  const settledMinor = settlements.reduce((s, x) => s + Math.round(x.amount * (currency === "USD" ? 100 : 1)), 0);
  const totalMinor = Math.round(amount * (currency === "USD" ? 100 : 1));
  if (settledMinor <= 0) return "open";
  if (settledMinor >= totalMinor) return "settled";
  return "partial";
}

/** Controlled edit of a final transaction — full audit diff, blocked when unsafe. */
export async function editTransaction(id: string, input: PostTxInput): Promise<FinTransaction> {
  const existing = await db.accTransactions.get(id);
  if (!existing) throw new TxValidationError(["تراکنش یافت نشد."]);
  if (existing.status !== "final" || existing.reversedBy || existing.reversalOf) {
    throw new TxValidationError([
      "تراکنش برگشت‌خورده یا ابطال‌شده قابل ویرایش نیست — آن را برگشت بزنید و دوباره ثبت کنید.",
    ]);
  }
  // Linked settlements would desync if the amount changed.
  const outstanding = await db.accOutstanding.toArray();
  if (outstanding.some((i) => i.settlements.some((s) => s.transactionId === id))) {
    throw new TxValidationError([
      "این تراکنش به تسویه یک مانده متصل است — ابتدا تسویه مرتبط را حذف کنید.",
    ]);
  }

  const normalized = normalizeTxAmounts(input);
  const accounts = await db.accAccounts.toArray();
  const allTx = await db.accTransactions.toArray();
  const balances = computeAllAccountBalances(accounts, allTx);
  const validation = validateTx(normalized, { accounts, balances });
  if (validation.errors.length > 0) {
    throw new TxValidationError(validation.errors.map((e) => e.message));
  }
  if (validation.insufficientFunds && !normalized.overrideInsufficientFunds) {
    throw new TxValidationError(["مانده حساب مبدأ برای این تراکنش کافی نیست."], {
      available: validation.insufficientFunds.available,
      requested: validation.insufficientFunds.requested,
      currency: normalized.currency,
    });
  }

  const diff: string[] = [];
  const before = existing as unknown as Record<string, unknown>;
  const afterKeys: Record<string, unknown> = {
    amount: normalized.amount,
    currency: normalized.currency,
    date: normalized.date,
    type: normalized.type,
    partyId: normalized.partyId || null,
    sourceAccountId: normalized.affectsBalance ? normalized.sourceAccountId || null : null,
    destAccountId: normalized.affectsBalance ? normalized.destAccountId || null : null,
    affectsBalance: normalized.affectsBalance,
    description: normalized.description?.trim() || undefined,
    reference: normalized.reference?.trim() || undefined,
    category: normalized.category?.trim() || undefined,
    destAmount: normalized.type === "exchange" ? normalized.destAmount ?? null : null,
    exchangeRate: normalized.type === "exchange" && normalized.exchangeRate ? normalized.exchangeRate : null,
  };
  for (const key of Object.keys(afterKeys)) {
    const a = before[key];
    const b = afterKeys[key];
    if ((a ?? null) !== (b ?? null)) {
      if (key === "amount") {
        diff.push(`مبلغ: ${formatMoney(Number(a), existing.currency)} → ${formatMoney(Number(b), normalized.currency)}`);
      } else {
        diff.push(`${key}: ${String(a ?? "—")} → ${String(b ?? "—")}`);
      }
    }
  }

  return db.transaction(
    "rw",
    db.accTransactions,
    db.accMeta,
    db.activities,
    async (): Promise<FinTransaction> => {
      const updated: FinTransaction = {
        ...existing,
        ...afterKeys,
        updatedAt: Date.now(),
      } as FinTransaction;
      await db.accTransactions.put(updated);
      await logActivity({
        type: "update",
        entity: "accTx",
        entityId: id,
        title: `تراکنش ${existing.number} ویرایش شد`,
        detail: diff.length ? diff.join(" | ") : "بدون تغییر داده‌ای",
      });
      return updated;
    },
  );
}

/**
 * Reverse a finalized transaction with a mandatory reason: posts an exact
 * counter-entry (mirrored accounts), flags the original as reversed, and
 * removes any settlement the original had auto-created. Exactly-once.
 */
export async function reverseTransaction(id: string, reason: string): Promise<FinTransaction> {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new TxValidationError(["دلیل برگشت الزامی است."]);

  const original = await db.accTransactions.get(id);
  if (!original) throw new TxValidationError(["تراکنش یافت نشد."]);
  if (original.status !== "final") {
    throw new TxValidationError(["فقط تراکنش‌های قطعی قابل برگشت هستند."]);
  }
  if (original.reversedBy) {
    throw new TxValidationError(["این تراکنش قبلاً برگشت خورده است."]);
  }

  const draft = buildReversalDraft(original);
  const accounts = await db.accAccounts.toArray();

  return db.transaction(
    "rw",
    db.accTransactions,
    db.accOutstanding,
    db.accMeta,
    db.activities,
    async (): Promise<FinTransaction> => {
      const number = await reserveTxNumber(todayIso());
      const now = Date.now();
      const counter: FinTransaction = {
        id: uid(),
        number,
        type: draft.type,
        partyId: original.partyId,
        amount: draft.amount,
        currency: draft.currency,
        date: todayIso(),
        description: `برگشت تراکنش ${original.number}${original.description ? ` — ${original.description}` : ""}`,
        reference: original.number,
        category: original.category,
        sourceAccountId: draft.sourceAccountId ?? null,
        destAccountId: draft.destAccountId ?? null,
        affectsBalance: draft.affectsBalance,
        status: "final",
        reversalOf: original.id,
        reversedBy: null,
        reason: cleanReason,
        exchangeRate: draft.exchangeRate ?? null,
        destAmount: draft.destAmount ?? null,
        destCurrency: draft.destCurrency ?? null,
        settlementOf: null,
        createdAt: now,
        updatedAt: now,
      };
      // Sanity: counter must cancel the original exactly (guarded by tests).
      if (!reversalCancelsExactly(original, counter)) {
        throw new TxValidationError(["خطای داخلی: تراکنش برگشتی اثر تراکنش اصلی را دقیقاً خنثی نمی‌کند."]);
      }
      await db.accTransactions.add(counter);
      await db.accTransactions.put({
        ...original,
        status: "reversed",
        reversedBy: counter.id,
        reason: cleanReason,
        updatedAt: now,
      });

      // Remove any settlement part the original had created.
      if (original.settlementOf) {
        const item = await db.accOutstanding.get(original.settlementOf);
        if (item) {
          const settlements = item.settlements.filter((s) => s.transactionId !== original.id);
          await db.accOutstanding.put({
            ...item,
            settlements,
            status: deriveOutstandingStatus(item.amount, settlements, item.currency),
            updatedAt: now,
          });
        }
      }

      await logActivity({
        type: "acc-reverse",
        entity: "accTx",
        entityId: original.id,
        title: `تراکنش ${original.number} برگشت خورد`,
        detail: `تراکنش خنثی‌ساز: ${counter.number} — دلیل: ${cleanReason}`,
      });
      return counter;
    },
  );
}

/** Cancel an informational (non-balance-affecting) record with a reason. */
export async function cancelInformationalTx(id: string, reason: string): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new TxValidationError(["دلیل ابطال الزامی است."]);
  const tx = await db.accTransactions.get(id);
  if (!tx) throw new TxValidationError(["تراکنش یافت نشد."]);
  if (tx.affectsBalance) {
    throw new TxValidationError([
      "تراکنش‌های مؤثر بر مانده با «برگشت» خنثی می‌شوند، نه ابطال.",
    ]);
  }
  if (tx.status !== "final") throw new TxValidationError(["این تراکنش قبلاً ابطال یا برگشت شده است."]);
  await db.transaction("rw", db.accTransactions, db.activities, async () => {
    await db.accTransactions.put({ ...tx, status: "cancelled", reason: cleanReason, updatedAt: Date.now() });
    await logActivity({
      type: "acc-cancel",
      entity: "accTx",
      entityId: id,
      title: `رکورد اطلاعاتی ${tx.number} ابطال شد`,
      detail: `دلیل: ${cleanReason}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  Parties                                                                   */
/* -------------------------------------------------------------------------- */

export interface PartyInput {
  type: PartyType;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  idNumber?: string;
  regNumber?: string;
  notes?: string;
  tags: string[];
  active: boolean;
}

/** Duplicate warning (non-blocking): same name, or same phone among actives. */
export async function findPartyDuplicates(input: PartyInput, ignoreId?: string): Promise<string[]> {
  const all = await db.accParties.toArray();
  const warnings: string[] = [];
  const sameName = all.find(
    (p) => p.id !== ignoreId && p.name.trim() === input.name.trim(),
  );
  if (sameName) warnings.push(`طرف حسابی با نام «${input.name.trim()}» از قبل وجود دارد.`);
  if (input.phone && input.phone.trim()) {
    const samePhone = all.find(
      (p) => p.id !== ignoreId && p.phone?.trim() === input.phone?.trim(),
    );
    if (samePhone) warnings.push(`شماره تلفن قبلاً برای «${samePhone.name}» ثبت شده است.`);
  }
  return warnings;
}

export async function createParty(input: PartyInput): Promise<AccParty> {
  if (!input.name.trim()) throw new Error("نام طرف حساب الزامی است.");
  return db.transaction("rw", db.accParties, db.accMeta, db.activities, async () => {
    const settings = (await db.accMeta.get("acc")) ?? DEFAULT_ACC_SETTINGS;
    const counter = (settings.partyCounter ?? 0) + 1;
    await db.accMeta.put({ ...settings, id: "acc", partyCounter: counter, updatedAt: Date.now() });
    const now = Date.now();
    const party: AccParty = {
      id: uid(),
      code: `${input.type === "individual" ? "P" : "C"}-${String(counter).padStart(4, "0")}`,
      type: input.type,
      name: input.name.trim(),
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      address: input.address?.trim() || undefined,
      idNumber: input.idNumber?.trim() || undefined,
      regNumber: input.regNumber?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      tags: input.tags,
      active: input.active,
      createdAt: now,
      updatedAt: now,
    };
    await db.accParties.add(party);
    await logActivity({
      type: "create",
      entity: "accParty",
      entityId: party.id,
      title: `حساب ${party.code} (${party.name}) ایجاد شد`,
      detail: input.type === "company" ? "شرکت" : "شخص حقیقی",
    });
    return party;
  });
}

export async function updateParty(id: string, input: PartyInput): Promise<void> {
  const existing = await db.accParties.get(id);
  if (!existing) throw new Error("طرف حساب یافت نشد.");
  await db.transaction("rw", db.accParties, db.activities, async () => {
    await db.accParties.put({
      ...existing,
      type: input.type,
      name: input.name.trim(),
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      address: input.address?.trim() || undefined,
      idNumber: input.idNumber?.trim() || undefined,
      regNumber: input.regNumber?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      tags: input.tags,
      active: input.active,
      updatedAt: Date.now(),
    });
    await logActivity({
      type: "update",
      entity: "accParty",
      entityId: id,
      title: `حساب ${existing.code} ویرایش شد`,
    });
  });
}

/**
 * Parties with financial history are deactivated, never deleted — passivation
 * keeps statements auditable. True delete is only allowed for empty accounts.
 */
export async function deleteOrDeactivateParty(id: string): Promise<"deleted" | "deactivated"> {
  const party = await db.accParties.get(id);
  if (!party) return "deleted";
  const txCount = await db.accTransactions.where("partyId").equals(id).count();
  const outCount = await db.accOutstanding.where("partyId").equals(id).count();
  if (txCount === 0 && outCount === 0) {
    await db.transaction("rw", db.accParties, db.accDocs, db.activities, async () => {
      const docs = await db.accDocs.where("partyId").equals(id).toArray();
      await Promise.all(docs.map((d) => db.accDocs.delete(d.id)));
      await db.accParties.delete(id);
    });
    await logActivity({
      type: "delete",
      entity: "accParty",
      entityId: id,
      title: `حساب ${party.code} (${party.name}) حذف شد`,
    });
    return "deleted";
  }
  await db.accParties.put({ ...party, active: false, updatedAt: Date.now() });
  await logActivity({
    type: "archive",
    entity: "accParty",
    entityId: id,
    title: `حساب ${party.code} (${party.name}) غیرفعال شد`,
    detail: "به دلیل وجود سابقه مالی، حساب حذف نشد و فقط غیرفعال شد.",
  });
  return "deactivated";
}

/* -------------------------------------------------------------------------- */
/*  Managed accounts                                                          */
/* -------------------------------------------------------------------------- */

export interface AccountInput {
  name: string;
  type: FinAccount["type"];
  currency: Currency;
  description?: string;
  active: boolean;
  /** Opening balance — recorded as an auditable "opening" transaction. */
  openingBalance?: number;
  openingDate?: string;
}

export async function createAccount(input: AccountInput): Promise<FinAccount> {
  if (!input.name.trim()) throw new Error("نام حساب الزامی است.");
  return db.transaction(
    "rw",
    db.accAccounts,
    db.accTransactions,
    db.accMeta,
    db.activities,
    async () => {
      const now = Date.now();
      const account: FinAccount = {
        id: uid(),
        name: input.name.trim(),
        type: input.type,
        currency: input.currency,
        description: input.description?.trim() || undefined,
        active: input.active,
        createdAt: now,
        updatedAt: now,
      };
      await db.accAccounts.add(account);

      if (input.openingBalance && input.openingBalance > 0) {
        const number = await reserveTxNumber(input.openingDate || todayIso());
        await db.accTransactions.add({
          id: uid(),
          number,
          type: "opening",
          partyId: null,
          amount: input.openingBalance,
          currency: account.currency,
          date: input.openingDate || todayIso(),
          description: `مانده اولیه حساب «${account.name}»`,
          sourceAccountId: null,
          destAccountId: account.id,
          affectsBalance: true,
          status: "final",
          reversalOf: null,
          reversedBy: null,
          settlementOf: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await logActivity({
        type: "create",
        entity: "accAccount",
        entityId: account.id,
        title: `حساب «${account.name}» ایجاد شد`,
        detail: input.openingBalance
          ? `مانده اولیه: ${formatMoney(input.openingBalance, account.currency)}`
          : undefined,
      });
      return account;
    },
  );
}

export async function updateAccount(
  id: string,
  input: Omit<AccountInput, "openingBalance" | "openingDate">,
): Promise<void> {
  const existing = await db.accAccounts.get(id);
  if (!existing) throw new Error("حساب یافت نشد.");
  if (input.currency !== existing.currency) {
    const hasTx =
      (await db.accTransactions.where("sourceAccountId").equals(id).count()) > 0 ||
      (await db.accTransactions.where("destAccountId").equals(id).count()) > 0;
    if (hasTx) {
      throw new Error(
        "ارز حسابی که تراکنش دارد قابل تغییر نیست — تغییر ارز سابقه مالی را بی‌معنا می‌کند.",
      );
    }
  }
  await db.transaction("rw", db.accAccounts, db.activities, async () => {
    await db.accAccounts.put({
      ...existing,
      name: input.name.trim(),
      type: input.type,
      currency: input.currency,
      description: input.description?.trim() || undefined,
      active: input.active,
      updatedAt: Date.now(),
    });
    await logActivity({
      type: "update",
      entity: "accAccount",
      entityId: id,
      title: `حساب «${existing.name}» ویرایش شد`,
    });
  });
}

/** Accounts with transactions can only be deactivated, never deleted. */
export async function deleteOrDeactivateAccount(id: string): Promise<"deleted" | "deactivated"> {
  const account = await db.accAccounts.get(id);
  if (!account) return "deleted";
  const txCount =
    (await db.accTransactions.where("sourceAccountId").equals(id).count()) +
    (await db.accTransactions.where("destAccountId").equals(id).count());
  if (txCount === 0) {
    await db.transaction("rw", db.accAccounts, db.accDocs, db.activities, async () => {
      const docs = await db.accDocs.where("accountId").equals(id).toArray();
      await Promise.all(docs.map((d) => db.accDocs.delete(d.id)));
      await db.accAccounts.delete(id);
    });
    await logActivity({
      type: "delete",
      entity: "accAccount",
      entityId: id,
      title: `حساب «${account.name}» حذف شد`,
    });
    return "deleted";
  }
  await db.accAccounts.put({ ...account, active: false, updatedAt: Date.now() });
  await logActivity({
    type: "archive",
    entity: "accAccount",
    entityId: id,
    title: `حساب «${account.name}» غیرفعال شد`,
    detail: "به دلیل وجود تراکنش، حساب حذف نشد و فقط غیرفعال شد.",
  });
  return "deactivated";
}

/* -------------------------------------------------------------------------- */
/*  Outstanding items & settlements                                           */
/* -------------------------------------------------------------------------- */

export interface OutstandingInput {
  kind: OutstandingKind;
  partyId: string;
  amount: number;
  currency: Currency;
  dueDate?: string | null;
  description?: string;
  reference?: string;
}

export async function createOutstanding(input: OutstandingInput): Promise<OutstandingItem> {
  if (!input.partyId) throw new Error("طرف حساب الزامی است.");
  if (!(input.amount > 0)) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد.");
  return db.transaction("rw", db.accOutstanding, db.accParties, db.activities, async () => {
    const now = Date.now();
    const item: OutstandingItem = {
      id: uid(),
      kind: input.kind,
      partyId: input.partyId,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate || null,
      description: input.description?.trim() || undefined,
      reference: input.reference?.trim() || undefined,
      status: "open",
      settlements: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.accOutstanding.add(item);
    const party = await db.accParties.get(input.partyId);
    await logActivity({
      type: "create",
      entity: "accOutstanding",
      entityId: item.id,
      title: `${input.kind === "receivable" ? "مطالبه" : "بدهی"} ${formatMoney(input.amount, input.currency)} ثبت شد`,
      detail: `طرف حساب: ${party?.name ?? "—"}`,
    });
    return item;
  });
}

export async function settleOutstanding(
  itemId: string,
  input: { amount: number; date: string; note?: string; transactionId?: string | null },
): Promise<void> {
  const item = await db.accOutstanding.get(itemId);
  if (!item) throw new Error("مانده یافت نشد.");
  if (item.status === "cancelled" || item.status === "settled") {
    throw new Error("این مانده تسویه یا ابطال شده است.");
  }
  const error = validateSettlement(item, input.amount);
  if (error) throw new Error(error);
  await db.transaction("rw", db.accOutstanding, db.activities, async () => {
    const settlement: OutstandingSettlement = {
      id: uid(),
      transactionId: input.transactionId ?? null,
      amount: input.amount,
      date: input.date,
      note: input.note?.trim() || undefined,
    };
    const settlements = [...item.settlements, settlement];
    await db.accOutstanding.put({
      ...item,
      settlements,
      status: deriveOutstandingStatus(item.amount, settlements, item.currency),
      updatedAt: Date.now(),
    });
    await logActivity({
      type: "update",
      entity: "accOutstanding",
      entityId: itemId,
      title: `تسویه ${formatMoney(input.amount, item.currency)} ثبت شد`,
      detail: `مانده باقی‌مانده: ${formatMoney(outstandingRemaining({ ...item, settlements }), item.currency)}`,
    });
  });
}

export async function removeSettlement(itemId: string, settlementId: string): Promise<void> {
  const item = await db.accOutstanding.get(itemId);
  if (!item) return;
  await db.transaction("rw", db.accOutstanding, db.activities, async () => {
    const settlements = item.settlements.filter((s) => s.id !== settlementId);
    await db.accOutstanding.put({
      ...item,
      settlements,
      status: deriveOutstandingStatus(item.amount, settlements, item.currency),
      updatedAt: Date.now(),
    });
    await logActivity({
      type: "update",
      entity: "accOutstanding",
      entityId: itemId,
      title: "یک تسویه حذف شد",
    });
  });
}

export async function cancelOutstanding(itemId: string, reason: string): Promise<void> {
  const item = await db.accOutstanding.get(itemId);
  if (!item) return;
  if (!reason.trim()) throw new Error("دلیل ابطال الزامی است.");
  await db.transaction("rw", db.accOutstanding, db.activities, async () => {
    await db.accOutstanding.put({ ...item, status: "cancelled", updatedAt: Date.now() });
    await logActivity({
      type: "acc-cancel",
      entity: "accOutstanding",
      entityId: itemId,
      title: "مانده ابطال شد",
      detail: `دلیل: ${reason.trim()}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  Documents                                                                 */
/* -------------------------------------------------------------------------- */

export interface AccDocInput {
  file: File;
  partyId?: string | null;
  transactionId?: string | null;
  accountId?: string | null;
  category?: string;
  notes?: string;
}

const ALLOWED_DOC_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_DOC_SIZE = 15 * 1024 * 1024;

/** Validate by sniffed content, not just the filename (magic bytes). */
async function sniffMime(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0x52, 0x49, 0x46, 0x46)) return "image/webp";
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  return file.type || "application/octet-stream";
}

export async function addAccDoc(input: AccDocInput): Promise<AccDoc> {
  const mime = await sniffMime(input.file);
  if (!ALLOWED_DOC_MIME.includes(mime)) {
    throw new Error("فقط تصاویر (JPG/PNG/WebP) و PDF پشتیبانی می‌شود.");
  }
  if (input.file.size > MAX_DOC_SIZE) {
    throw new Error("حجم فایل نباید بیشتر از ۱۵ مگابایت باشد.");
  }
  const doc: AccDoc = {
    id: uid(),
    partyId: input.partyId ?? null,
    transactionId: input.transactionId ?? null,
    accountId: input.accountId ?? null,
    name: input.file.name,
    mime,
    size: input.file.size,
    blob: input.file,
    category: input.category,
    notes: input.notes?.trim() || undefined,
    createdAt: Date.now(),
  };
  await db.accDocs.add(doc);
  await logActivity({
    type: "create",
    entity: "accDoc",
    entityId: doc.id,
    title: `سند «${doc.name}» بارگذاری شد`,
  });
  return doc;
}

export async function deleteAccDoc(id: string): Promise<void> {
  const doc = await db.accDocs.get(id);
  if (!doc) return;
  await db.transaction("rw", db.accDocs, db.accParties, db.activities, async () => {
    // Clear party photo references pointing at this doc.
    const parties = await db.accParties.where("photoDocId").equals(id).toArray();
    for (const p of parties) {
      await db.accParties.put({ ...p, photoDocId: null, updatedAt: Date.now() });
    }
    await db.accDocs.delete(id);
  });
  await logActivity({
    type: "delete",
    entity: "accDoc",
    entityId: id,
    title: `سند «${doc.name}» حذف شد`,
  });
}

export async function getAccDocBlob(id: string): Promise<Blob | undefined> {
  const doc = await db.accDocs.get(id);
  return doc?.blob;
}

export async function setPartyPhoto(partyId: string, docId: string | null): Promise<void> {
  const party = await db.accParties.get(partyId);
  if (!party) return;
  await db.accParties.put({ ...party, photoDocId: docId, updatedAt: Date.now() });
}

/* -------------------------------------------------------------------------- */
/*  Reconciliation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Manual balance verification: compare the derived balance with a counted
 * amount. Any difference is recorded through an explicit, audited adjustment
 * transaction — never by silently editing history.
 */
export async function reconcileAccount(
  accountId: string,
  countedBalance: number,
  note: string,
): Promise<{ difference: number; tx: FinTransaction | null }> {
  const account = await db.accAccounts.get(accountId);
  if (!account) throw new Error("حساب یافت نشد.");
  const allTx = await db.accTransactions.toArray();
  const balances = computeAllAccountBalances([account], allTx);
  const derived = balances.get(accountId)?.balance ?? 0;
  const diffMinor = Math.round((countedBalance - derived) * (account.currency === "USD" ? 100 : 1));
  const difference =
    account.currency === "USD" ? Math.round(diffMinor) / 100 : diffMinor;
  if (difference === 0) {
    await logActivity({
      type: "acc-adjust",
      entity: "accAccount",
      entityId: accountId,
      title: `تطبیق حساب «${account.name}» تأیید شد`,
      detail: "مانده شمارش‌شده با مانده سیستمی برابر بود.",
    });
    return { difference: 0, tx: null };
  }
  const tx = await postTransaction({
    type: "adjustment",
    amount: Math.abs(difference),
    currency: account.currency,
    date: todayIso(),
    description: `تعدیل تطبیق حساب «${account.name}»${note.trim() ? ` — ${note.trim()}` : ""}`,
    sourceAccountId: difference < 0 ? accountId : null,
    destAccountId: difference > 0 ? accountId : null,
    affectsBalance: true,
  });
  return { difference, tx };
}

export type { AccountBalance };

/**
 * Wipe the ENTIRE accounting module back to a clean slate: parties, accounts,
 * transactions, outstanding items, documents (with their files) and module
 * settings/counters. The caller is expected to download a safety backup
 * first (the UI always does). Main-app visa data is NOT touched.
 */
export async function resetAccounting(): Promise<void> {
  await db.transaction(
    "rw",
    [db.accParties, db.accAccounts, db.accTransactions, db.accOutstanding, db.accDocs, db.accMeta, db.activities],
    async () => {
      const counts = {
        parties: await db.accParties.count(),
        accounts: await db.accAccounts.count(),
        transactions: await db.accTransactions.count(),
        outstanding: await db.accOutstanding.count(),
        docs: await db.accDocs.count(),
      };
      await db.accParties.clear();
      await db.accAccounts.clear();
      await db.accTransactions.clear();
      await db.accOutstanding.clear();
      await db.accDocs.clear();
      await db.accMeta.clear();
      await logActivity({
        type: "acc-reset",
        entity: "accSettings",
        entityId: "acc",
        title: "بخش حسابداری ریست شد",
        detail: `پاک‌سازی کامل: ${counts.parties.toLocaleString("fa-IR")} طرف حساب، ${counts.accounts.toLocaleString("fa-IR")} حساب، ${counts.transactions.toLocaleString("fa-IR")} تراکنش، ${counts.outstanding.toLocaleString("fa-IR")} مانده، ${counts.docs.toLocaleString("fa-IR")} سند. داده‌های اصلی برنامه دست‌نخورده ماند.`,
      });
    },
  );
}
