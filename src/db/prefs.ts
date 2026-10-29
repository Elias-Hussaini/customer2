import { db } from "./schema";
import type { AppPreferences, Currency } from "../types";

export const DEFAULT_PREFS: AppPreferences = {
  id: "app",
  defaultCurrency: "IRT",
  passportDateCalendar: "gregorian",
  rememberLastSelections: true,
  lastRepresentativeId: null,
  lastListId: null,
  lastEmployerId: null,
  employerFieldEnabled: true,
  updatedAt: 0,
};

export async function getPrefs(): Promise<AppPreferences> {
  const stored = await db.preferences.get("app");
  return { ...DEFAULT_PREFS, ...stored, id: "app" };
}

export async function updatePrefs(patch: Partial<AppPreferences>): Promise<void> {
  const current = await getPrefs();
  await db.preferences.put({ ...current, ...patch, id: "app", updatedAt: Date.now() });
}

export async function setDefaultCurrency(currency: Currency): Promise<void> {
  await updatePrefs({ defaultCurrency: currency });
}
