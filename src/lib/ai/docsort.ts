/**
 * AI document sorting — the «افزودن با هوش مصنوعی» flow on a customer page.
 *
 * The user picks any mix of photos and PDFs. Pages are rendered locally
 * (and combined scans are split by ./split.ts), then every image is sent to
 * the user's Cloudflare AI worker with the CURRENT document slots. The model
 * must answer with a fixed JSON array saying where each image belongs:
 * one of the slots, the profile photo, a NEW custom slot, or «سایر».
 */

import type { ChatMessage, ContentPart } from "./client";

/** A document slot the AI may choose (id + the user's Persian label). */
export interface DocSlotOption {
  id: string;
  label: string;
}

export type DocSortTarget =
  | { kind: "slot"; slotId: string; label: string }
  | { kind: "photo" }
  | { kind: "other" }
  | { kind: "new"; label: string };

export interface DocSortResult {
  /** 1-based position of the image inside the request batch. */
  index: number;
  target: DocSortTarget;
  /** Optional short Persian explanation from the model. */
  note?: string;
}

export function buildDocSortSystemPrompt(slots: DocSlotOption[]): string {
  const slotLines = slots
    .filter((s) => s.id && s.label)
    .map((s) => `  "${s.id}" — ${s.label}`);
  return `You are a document-sorting engine inside a Persian visa-agency app.
The user sends several images, numbered 1..N in the order they appear. Each image shows ONE thing: a document page/side, or a personal photo. Decide for EVERY image where it belongs.

AVAILABLE SLOTS — choose the slot id exactly:
${slotLines.length > 0 ? slotLines.join("\n") : "  (none defined)"}

Slot meaning guide (labels are the agency's own names):
- Passport slot = the passport DATA page: holder photo, personal data, and the two MRZ lines at the bottom. Passport covers/stamps/other pages are NOT this slot.
- Front-of-tazkira slot = the side of the Afghan national ID (تذکره) that carries the holder's PHOTO and personal details. This includes BOTH the electronic card AND the old paper booklet تذکره — handwritten entries count just like printed ones.
- Back-of-tazkira slot = the other side of the تذکره (no holder photo).

SPECIAL TARGETS:
- "photo" — a personal portrait of the person him/herself (passport-style headshot or a normal personal photo) that should become the customer's profile picture. A document page is NEVER "photo".
- "new" — a clearly distinct, useful document type that matches NONE of the slots above (examples: visa page or visa stamp inside a passport, driving license, شناسنامه, work permit, residence permit slip, vaccination card…). Then also return "label": a SHORT Persian title for the new slot, like "عکس ویزه" or "گواهی‌نامه".
- "other" — anything else: unreadable/blurred images, screenshots, random pictures, or document pages that are too ambiguous.

OUTPUT RULES (strict):
- Reply with ONLY one JSON array — no markdown fences, no commentary.
- Exactly one object per image, in order:
  [{"index":1,"slot":"passport"},{"index":2,"slot":"photo"},{"index":3,"slot":"new","label":"عکس ویزه"},{"index":4,"slot":"other"}]
- "slot" is the exact slot id from the list above, or "photo", "new", or "other".
- Every index from 1 to N must appear exactly once. Never invent or skip indexes.
- Optional: add "note" — up to 6 Persian words explaining the choice.
- A single image never fills two slots. When unsure between two slots, pick the closer one and mention it in "note".`;
}

export function buildDocSortMessages(images: string[], slots: DocSlotOption[]): ChatMessage[] {
  const parts: ContentPart[] = [
    {
      type: "text",
      text:
        images.length > 1
          ? `These ${images.length} images are numbered 1..${images.length} in order. Sort every one of them.`
          : "Sort this single image.",
    },
  ];
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return [
    { role: "system", content: buildDocSortSystemPrompt(slots) },
    { role: "user", content: parts },
  ];
}

/* --------------------------------- parsing -------------------------------- */

/** Pull the JSON array out of a reply that may contain fences or prose. */
export function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("پاسخ هوش مصنوعی یک لیست JSON نبود.");
  }
  let body = candidate.slice(start, end + 1);
  body = body.replace(/,\s*([}\]])/g, "$1");
  return body;
}

const PERSIAN_LETTER = /[\u0621-\u064A\u0671-\u06D3]/;
const LABEL_TRIM = /^[\s\-–—:،]+|[\s\-–—:،]+$/g;

/** Keep only sane, short Persian-ish labels for AI-created slots. */
export function sanitizeNewSlotLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  s = s.replace(LABEL_TRIM, "");
  if (s.length < 2 || s.length > 28) return null;
  if (!PERSIAN_LETTER.test(s)) return null;
  // Strip characters that make no sense in a slot title.
  s = s.replace(/[\\/:*?"<>|{}[\]]/g, "").trim();
  if (s.length < 2) return null;
  return s;
}

function asNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, 60);
  return s || undefined;
}

/**
 * Parse the model reply into one result per image (1..count). Unknown slot
 * ids, broken entries and missing indexes fall back to «سایر» so an image is
 * never silently dropped. Throws a Persian error when the reply is unusable.
 */
export function parseDocSortReply(
  text: string,
  slots: DocSlotOption[],
  count: number,
): DocSortResult[] {
  if (count <= 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(text));
  } catch {
    throw new Error("پاسخ هوش مصنوعی قابل خواندن نبود (JSON نامعتبر).");
  }
  // Tolerate an object wrapper like {"sorts": [...]} or {"results": [...]}.
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const arr = (Object.values(obj).find((v) => Array.isArray(v)) ?? []) as unknown[];
    parsed = arr;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("پاسخ هوش مصنوعی یک لیست JSON نبود.");
  }

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const out = new Map<number, DocSortResult>();

  for (const entry of parsed) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const idx = Number(e.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > count) continue;
    if (out.has(idx)) continue; // first answer per index wins
    const slotRaw = typeof e.slot === "string" ? e.slot.trim() : "";
    const note = asNote(e.note);
    if (slotById.has(slotRaw)) {
      const slot = slotById.get(slotRaw)!;
      out.set(idx, { index: idx, target: { kind: "slot", slotId: slot.id, label: slot.label }, note });
    } else if (slotRaw === "photo") {
      out.set(idx, { index: idx, target: { kind: "photo" }, note });
    } else if (slotRaw === "new") {
      const label = sanitizeNewSlotLabel(e.label);
      out.set(
        idx,
        label
          ? { index: idx, target: { kind: "new", label }, note }
          : { index: idx, target: { kind: "other" }, note },
      );
    } else {
      out.set(idx, { index: idx, target: { kind: "other" }, note });
    }
  }

  // Every image must end up somewhere — missing/invalid → other.
  const results: DocSortResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push(out.get(i) ?? { index: i, target: { kind: "other" } });
  }
  return results;
}
