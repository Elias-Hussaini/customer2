/** Live IndexedDB subscriptions for the accounting section. */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import type {
  AccDoc,
  AccParty,
  AccSettings,
  FinAccount,
  FinTransaction,
  OutstandingItem,
} from "./types";
import { DEFAULT_ACC_SETTINGS } from "./types";

export function useAccParties(activeOnly = false): AccParty[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.accParties.toArray();
    return activeOnly ? all.filter((p) => p.active) : all;
  }, [activeOnly]);
}

export function useAccParty(id: string | undefined): AccParty | undefined {
  return useLiveQuery(() => (id ? db.accParties.get(id) : undefined), [id]);
}

export function useAccAccounts(activeOnly = false): FinAccount[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.accAccounts.toArray();
    return activeOnly ? all.filter((a) => a.active) : all;
  }, [activeOnly]);
}

export function useAccAccount(id: string | undefined): FinAccount | undefined {
  return useLiveQuery(() => (id ? db.accAccounts.get(id) : undefined), [id]);
}

export function useAccTransactions(): FinTransaction[] | undefined {
  return useLiveQuery(
    () => db.accTransactions.orderBy("date").reverse().toArray(),
    [],
  );
}

export function useAccOutstanding(): OutstandingItem[] | undefined {
  return useLiveQuery(() => db.accOutstanding.toArray(), []);
}

export function useAccSettings(): AccSettings {
  const stored = useLiveQuery(() => db.accMeta.get("acc"), []);
  return stored ?? DEFAULT_ACC_SETTINGS;
}

/** Document metadata without blobs (for lists). */
export function useAccDocsMeta(): Omit<AccDoc, "blob">[] | undefined {
  return useLiveQuery(
    async () => {
      const all = await db.accDocs.orderBy("createdAt").reverse().toArray();
      return all.map(({ blob: _blob, ...meta }) => meta);
    },
    [],
  );
}

export function useAccDocsFor(
  linkage: { partyId?: string; transactionId?: string; accountId?: string },
): AccDoc[] | undefined {
  const { partyId, transactionId, accountId } = linkage;
  return useLiveQuery(async () => {
    if (partyId) return db.accDocs.where("partyId").equals(partyId).toArray();
    if (transactionId) return db.accDocs.where("transactionId").equals(transactionId).toArray();
    if (accountId) return db.accDocs.where("accountId").equals(accountId).toArray();
    return [];
  }, [partyId, transactionId, accountId]);
}
