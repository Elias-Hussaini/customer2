/**
 * Cloudflare AI worker accounts + document extraction types.
 *
 * The app talks to the user's own Cloudflare Workers (chat-completion style
 * API — base URL + Bearer key). Several accounts can be registered; when one
 * hits a rate limit or fails, the next account is tried automatically.
 */

/** A registered AI worker account (Cloudflare Worker). */
export interface AiWorker {
  id: string;
  /** Display name, e.g. «اکانت ۱». */
  label: string;
  /** Worker base endpoint — requests go straight to this URL. */
  url: string;
  /** Bearer API key. */
  key: string;
  /** Model id, e.g. `@cf/meta/llama-4-scout-17b-16e-instruct`. */
  model: string;
  /** Disabled workers are skipped by the failover chain. */
  enabled: boolean;
  /** Failover order — smaller values are tried first. */
  priority: number;
  createdAt: number;
  updatedAt: number;
}

/** Singleton settings record for the AI section (id: "ai"). */
export interface AiSettings {
  id: "ai";
  /**
   * Which extraction keys the AI is allowed to auto-fill.
   * Missing key = enabled; `false` = the AI must skip that field.
   */
  fieldToggles?: Record<string, boolean>;
  updatedAt: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  id: "ai",
  fieldToggles: {},
  updatedAt: 0,
};

/** A key is enabled unless it is explicitly switched off. */
export function fieldEnabled(
  toggles: Record<string, boolean> | undefined,
  key: string,
): boolean {
  return toggles?.[key] !== false;
}

/**
 * Core extraction keys in settings-UI order, with Persian labels.
 * The first six fill the form directly; the rest land in the notes line.
 */
export const CORE_FIELD_LABELS: Record<string, string> = {
  first_name: "نام",
  last_name: "نام خانوادگی",
  passport_number: "شماره پاسپورت",
  date_of_birth: "تاریخ تولد",
  issue_date: "تاریخ صدور پاسپورت",
  expiry_date: "تاریخ انقضای پاسپورت",
  nationality: "ملیت (در یادداشت)",
  national_id: "شماره ملی/تذکره (در یادداشت)",
  sex: "جنسیت (در یادداشت)",
  place_of_birth: "محل تولد (در یادداشت)",
  document_type: "نوع مدرک (در یادداشت)",
};

/** Quick-pick model ids known to work on Cloudflare-style workers. */
export const KNOWN_MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/openai/gpt-oss-20b",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
] as const;

/** Default model when a worker is created (vision-capable). */
export const DEFAULT_MODEL = KNOWN_MODELS[0];

/* -------------------------------------------------------------------------- */
/*  Extraction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Fixed extraction payload — the AI always returns exactly these keys
 * (plus any dynamically requested custom-field keys). Unknown/unreadable
 * values are null, never invented.
 */
export interface ExtractionPayload {
  first_name: string | null;
  last_name: string | null;
  passport_number: string | null;
  /** Gregorian YYYY-MM-DD. */
  date_of_birth: string | null;
  /** Gregorian YYYY-MM-DD. */
  issue_date: string | null;
  /** Gregorian YYYY-MM-DD. */
  expiry_date: string | null;
  nationality: string | null;
  national_id: string | null;
  /** "M" | "F" | null. */
  sex: string | null;
  place_of_birth: string | null;
  document_type: string | null;
  /** Keys the model is not fully sure about. */
  uncertain: string[];
  /** Dynamically requested custom fields land here. */
  [key: string]: unknown;
}

/** The core schema keys every extraction response must contain. */
export const CORE_FIELD_KEYS = [
  "first_name",
  "last_name",
  "passport_number",
  "date_of_birth",
  "issue_date",
  "expiry_date",
  "nationality",
  "national_id",
  "sex",
  "place_of_birth",
  "document_type",
  "uncertain",
] as const;

/** Core payload keys that map straight into the customer form. */
export const FORM_FIELD_KEYS = [
  "first_name",
  "last_name",
  "passport_number",
  "date_of_birth",
  "issue_date",
  "expiry_date",
] as const;
