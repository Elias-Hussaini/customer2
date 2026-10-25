import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { DEFAULT_PREFS, updatePrefs } from "../db/prefs";
import type {
  Activity,
  AppPreferences,
  Attachment,
  CustomFieldDef,
  Customer,
  DocType,
  ListFolder,
  Payment,
  Representative,
  Tag,
  VisaRequest,
  VisaType,
} from "../types";

/** Live subscriptions over IndexedDB — components update automatically. */

export function useRepresentatives(activeOnly = true): Representative[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.representatives.toArray();
    return activeOnly ? all.filter((r) => !r.archivedAt) : all;
  }, [activeOnly]);
}

export function useRepresentativeOrDefault(id: string | undefined): Representative | undefined {
  return useLiveQuery(() => (id ? db.representatives.get(id) : undefined), [id]);
}

export function useArchivedRepresentatives(): Representative[] | undefined {
  return useLiveQuery(
    async () => (await db.representatives.toArray()).filter((r) => r.archivedAt),
    [],
  );
}

export function useCustomers(activeOnly = true): Customer[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.customers.toArray();
    return activeOnly ? all.filter((c) => !c.archivedAt) : all;
  }, [activeOnly]);
}

export function useArchivedCustomers(): Customer[] | undefined {
  return useLiveQuery(async () => (await db.customers.toArray()).filter((c) => c.archivedAt), []);
}

export function useCustomer(id: string | undefined): Customer | undefined {
  return useLiveQuery(() => (id ? db.customers.get(id) : undefined), [id]);
}

export function useRequests(activeOnly = true): VisaRequest[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.requests.toArray();
    return activeOnly ? all.filter((r) => !r.archivedAt) : all;
  }, [activeOnly]);
}

export function useArchivedRequests(): VisaRequest[] | undefined {
  return useLiveQuery(async () => (await db.requests.toArray()).filter((r) => r.archivedAt), []);
}

export function useRequest(id: string | undefined): VisaRequest | undefined {
  return useLiveQuery(() => (id ? db.requests.get(id) : undefined), [id]);
}

export function useLists(activeOnly = true): ListFolder[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.lists.toArray();
    return activeOnly ? all.filter((l) => !l.archivedAt) : all;
  }, [activeOnly]);
}

export function useArchivedLists(): ListFolder[] | undefined {
  return useLiveQuery(async () => (await db.lists.toArray()).filter((l) => l.archivedAt), []);
}

export function useList(id: string | undefined): ListFolder | undefined {
  return useLiveQuery(() => (id ? db.lists.get(id) : undefined), [id]);
}

export function usePayments(): Payment[] | undefined {
  return useLiveQuery(() => db.payments.toArray(), []);
}

export function useTags(activeOnly = true): Tag[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.tags.toArray();
    return activeOnly ? all.filter((t) => !t.archivedAt) : all;
  }, [activeOnly]);
}

export function useArchivedTags(): Tag[] | undefined {
  return useLiveQuery(async () => (await db.tags.toArray()).filter((t) => t.archivedAt), []);
}

export function useVisaTypes(activeOnly = true): VisaType[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.visaTypes.toArray();
    return activeOnly ? all.filter((v) => !v.archivedAt) : all;
  }, [activeOnly]);
}

export function useCustomFields(): CustomFieldDef[] | undefined {
  return useLiveQuery(() => db.customFields.toArray(), []);
}

/** Active document slots (مدارک و تصاویر) in display order. */
export function useDocTypes(): DocType[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.docTypes.toArray())
        .filter((d) => !d.archivedAt)
        .sort((a, b) => a.order - b.order),
    [],
  );
}

/** All payment receipt photos, keyed lookup at the call site. */
export function useReceipts(): Attachment[] | undefined {
  return useLiveQuery(() => db.attachments.where("paymentId").above("").toArray(), []);
}

export function useActivities(limit = 20, entityId?: string): Activity[] | undefined {
  return useLiveQuery(
    async () => {
      if (entityId) {
        const all = await db.activities.where("entityId").equals(entityId).toArray();
        return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
      }
      return db.activities.orderBy("ts").reverse().limit(limit).toArray();
    },
    [limit, entityId],
  );
}

export function usePrefs(): AppPreferences {
  const prefs = useLiveQuery(() => db.preferences.get("app"), []);
  return prefs ?? DEFAULT_PREFS;
}

export { updatePrefs };
