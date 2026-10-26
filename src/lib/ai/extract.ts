/**
 * Document extraction via the user's Cloudflare AI workers.
 *
 * Images (PDF pages converted locally, or photos) are sent to a vision
 * model which must answer with ONE fixed-schema JSON object — same keys
 * every time, null for anything unreadable. The result is auto-filled
 * into the customer form. Custom fields are injected into the schema
 * dynamically, so fields added later are understood automatically.
 */

import type { ChatMessage, ContentPart } from "./client";
import { CORE_FIELD_KEYS, type ExtractionPayload } from "./types";

const CORE_SCHEMA_JSON = `{
  "first_name": null,
  "last_name": null,
  "passport_number": null,
  "date_of_birth": null,
  "issue_date": null,
  "expiry_date": null,
  "nationality": null,
  "national_id": null,
  "sex": null,
  "place_of_birth": null,
  "document_type": null,
  "uncertain": []
}`;

export interface ExtractionContext {
  /** Custom customer fields (key + Persian label) to try to fill too. */
  customFields?: { key: string; label: string }[];
  /** User-supplied system prompt from settings — replaces the built-in one. */
  systemPromptOverride?: string | null;
}

export function buildSystemPrompt(ctx: ExtractionContext = {}): string {
  if (ctx.systemPromptOverride && ctx.systemPromptOverride.trim()) {
    return ctx.systemPromptOverride.trim();
  }
  const custom = (ctx.customFields ?? []).filter((f) => f.key && f.label);
  const customBlock =
    custom.length > 0
      ? `\n\nADDITIONAL KEYS — extend the JSON with these extra keys (same null-if-missing rule). Look for their values on the document (labels are Persian):\n${custom
          .map((f) => `  "${f.key}" — ${f.label}`)
          .join("\n")}`
      : "";
  return `You are a document-data extraction engine inside a visa agency app.
The user sends one or more photos or scanned pages of a travel/identity document (passport, national ID / tazkira, visa, residence permit, ...).

Read every image carefully and return the person's data as JSON.

OUTPUT RULES (strict):
- Reply with ONLY one JSON object. No markdown fences, no commentary, no extra keys.
- Every schema key below must always be present. Use null when the value is missing or unreadable.
- Never invent, guess or complete data. If two pages disagree, prefer the machine-readable zone (MRZ).

DATE RULES:
- All dates are Gregorian, formatted YYYY-MM-DD.
- Two-digit years (MRZ, e.g. 970512): birth dates use 19xx, issue/expiry use 20xx.
- Dates written in the Solar Hijri (Jalali/Shamsi) calendar must be converted to Gregorian.

NAME RULES:
- first_name = given names, last_name = surname, exactly as printed in the document (Latin letters when the document is Latin). Do not translate, transliterate or reorder.
- passport_number and national_id: copy letters/digits exactly, without spaces.

SCHEMA — always exactly these keys:
${CORE_SCHEMA_JSON}

- "sex": "M" or "F" or null.
- "document_type": short English type: "passport", "national_id", "visa", "residence_permit", ...
- "uncertain": array of schema keys you are NOT fully sure about (e.g. ["date_of_birth"]). Empty array when everything is clear.${customBlock}`;
}

/** Build the chat messages for one extraction request. */
export function buildExtractionMessages(images: string[], ctx: ExtractionContext = {}): ChatMessage[] {
  const parts: ContentPart[] = [
    {
      type: "text",
      text:
        images.length > 1
          ? `These ${images.length} images are pages of the applicant's document(s). Extract the data.`
          : "This is the applicant's document. Extract the data.",
    },
  ];
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return [
    { role: "system", content: buildSystemPrompt(ctx) },
    { role: "user", content: parts },
  ];
}

/** Slice the JSON object out of a reply that may contain fences/prose. */
export function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("پاسخ هوش مصنوعی JSON نبود.");
  }
  let body = candidate.slice(start, end + 1);
  // Tolerate trailing commas before } or ]
  body = body.replace(/,\s*([}\]])/g, "$1");
  return body;
}

/** Safe JSON value coercion for the fixed schema. */
function asStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

/** Normalize/uppercase a 2-digit sex value. */
function normalizeSex(v: unknown): string | null {
  const s = asStringOrNull(v);
  if (!s) return null;
  const up = s.toUpperCase();
  if (up.startsWith("M")) return "M";
  if (up.startsWith("F") || up.startsWith("ز") || up.startsWith("م")) return "F";
  if (up.startsWith("م") || up.startsWith("ذ")) return "M";
  return s;
}

/**
 * Parse the model reply into a fixed-schema payload. Throws with a Persian
 * message when the reply is unusable.
 */
export function parseExtractionReply(text: string): ExtractionPayload {
  const body = extractJsonBlock(text);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("پاسخ هوش مصنوعی قابل خواندن نبود (JSON نامعتبر).");
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("پاسخ هوش مصنوعی قابل خواندن نبود.");
  }

  const out: ExtractionPayload = {
    first_name: asStringOrNull(raw.first_name),
    last_name: asStringOrNull(raw.last_name),
    passport_number: asStringOrNull(raw.passport_number),
    date_of_birth: asStringOrNull(raw.date_of_birth),
    issue_date: asStringOrNull(raw.issue_date),
    expiry_date: asStringOrNull(raw.expiry_date),
    nationality: asStringOrNull(raw.nationality),
    national_id: asStringOrNull(raw.national_id),
    sex: normalizeSex(raw.sex),
    place_of_birth: asStringOrNull(raw.place_of_birth),
    document_type: asStringOrNull(raw.document_type),
    uncertain: Array.isArray(raw.uncertain)
      ? raw.uncertain.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)
      : [],
  };

  // Keep any extra (custom-field) keys as trimmed strings.
  for (const [k, v] of Object.entries(raw)) {
    if ((CORE_FIELD_KEYS as readonly string[]).includes(k)) continue;
    if (typeof v === "string" || typeof v === "number") {
      out[k] = asStringOrNull(v);
    }
  }
  return out;
}

/** ISO date check — the form stores YYYY-MM-DD Gregorian strings. */
export function isIsoDate(v: string | null): v is string {
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}
