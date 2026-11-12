import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { DEFAULT_PREFS, updatePrefs } from "../db/prefs";
import { buildStageMap } from "../db/stages";
import type {
  Activity,
  AppPreferences,
  Attachment,
  CustomFieldDef,
  Customer,
  CustomerStage,
  DocType,
  Employer,
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

/** Active employers (کارفرما) — the optional customer attribute. */
export function useEmployers(activeOnly = true): Employer[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.employers.toArray();
    return activeOnly ? all.filter((e) => !e.archivedAt) : all;
  }, [activeOnly]);
}

export function useArchivedEmployers(): Employer[] | undefined {
  return useLiveQuery(
    async () => (await db.employers.toArray()).filter((e) => e.archivedAt),
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

/**
 * Effective visa-journey stage of every active customer (stored value wins,
 * else derived from requests + special code). Undefined until data loads.
 */
export function useStageMap(): Map<string, CustomerStage> | undefined {
  const customers = useCustomers();
  const requests = useRequests();
  return useMemo(() => {
    if (!customers || !requests) return undefined;
    return buildStageMap(customers, requests);
  }, [customers, requests]);
}

export { updatePrefs };

/** Documents of one employer profile (live). */
export function useEmployerAttachments(employerId: string | undefined): Attachment[] | undefined {
  return useLiveQuery(
    () => (employerId ? db.attachments.where("employerId").equals(employerId).sortBy("createdAt") : []),
    [employerId],
  );
}

/** Studio folders (ابزار عکس) — live. */
export function useStudioFolders() {
  return useLiveQuery(() => db.studioFolders.orderBy("createdAt").toArray(), []);
}

/** All studio images — live. */
export function useStudioImages() {
  return useLiveQuery(() => db.studioImages.orderBy("createdAt").reverse().toArray(), []);
}

/** One employer record (live). */
export function useEmployer(id: string | undefined): Employer | undefined {
  return useLiveQuery(() => (id ? db.employers.get(id) : undefined), [id]);
}
