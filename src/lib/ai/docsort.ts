/**
 * AI document sorting — the «افزودن با هوش مصنوعی» flow on a customer page.
 *
 * The user picks any mix of photos and PDFs. Pages are rendered locally
 * (and combined scans are split by ./split.ts), then every image is sent to
 * the user's Cloudflare AI worker with the CURRENT document slots. The model
 * must answer with a fixed JSON array saying where each image belongs:
 * one of the slots, the profile photo, a NEW custom slot, or «سایر».
 *
 * Pieces that were cut from ONE page all land in the same destination are
 * re-joined: the original whole page is filed instead of the pieces
 * (see resolveActions) — a single تذکره back page is never filed in halves.
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
}

export function buildDocSortSystemPrompt(slots: DocSlotOption[]): string {
  const slotLines = slots
    .filter((s) => s.id && s.label)
    .map((s) => `  "${s.id}" — ${s.label}`);
  return `You are a document-sorting engine inside a Persian visa-agency app.
The user sends several images, numbered 1..N in the order they appear. Each image shows ONE thing: a document page/side, or a personal photo. Decide for EVERY image where it belongs.

AVAILABLE SLOTS — choose the slot id exactly:
${slotLines.length > 0 ? slotLines.join("\n") : "  (none defined)"}

SLOT MEANINGS (labels are the agency's own names):
- Passport slot = the passport DATA page: holder photo, personal data, and the two MRZ lines at the bottom. Passport covers/stamps/other pages are NOT this slot.
- Front-of-tazkira slot = the side of the Afghan تذکره that carries the holder's PHOTO and personal details — the electronic card OR the old paper booklet, printed or handwritten.
- Back-of-tazkira slot = the OTHER side of the same تذکره. A paper تذکره back often contains several boxes and sections (numbers, records, stamps, renewal notes) — ALL of it together is ONE back-of-tazkira page.

TAZKIRA RULES (strict):
- The تذکره IS the Afghan identity document. The app has NO «کد ملی» slot and never needs one — NEVER choose or invent a slot for کد ملی.
- Any part, crop or section of a تذکره (a number box, a records box, a stamp area, half a page) still belongs to the front-of-tazkira or back-of-tazkira slot — NEVER to "new".
- Some images may be PARTS of one page that the app cut apart automatically (the app tells you which). If consecutive parts show the SAME document side, give them ALL the same slot — the app re-joins them.

SPECIAL TARGETS:
- "photo" — a personal portrait of the person him/herself (passport-style headshot or a normal personal photo) that should become the customer's profile picture. A document page is NEVER "photo".
- "new" — a clearly DIFFERENT document type that matches NONE of the slots above (examples: visa page or visa stamp inside a passport, driving license, شناسنامه, work permit, residence permit slip, vaccination card…). Then also return "label": a SHORT Persian title for the new slot, like "عکس ویزه" or "گواهی‌نامه".
- "other" — anything else: unreadable/blurred images, screenshots, random pictures, empty backgrounds, or document pages that are too ambiguous.

OUTPUT RULES (strict):
- Reply with ONLY one JSON array — no markdown fences, no commentary.
- Exactly one object per image, in order:
  [{"index":1,"slot":"passport"},{"index":2,"slot":"photo"},{"index":3,"slot":"new","label":"عکس ویزه"},{"index":4,"slot":"other"}]
- "slot" is the exact slot id from the list above, or "photo", "new", or "other".
- Every index from 1 to N must appear exactly once. Never invent or skip indexes.
- A single image never fills two slots. When unsure between two slots, pick the closer one.`;
}

/**
 * Build the chat messages. `groups` lists sets of 1-based image indexes that
 * were cut apart from ONE original page — the model is told so it can answer
 * consistently when the parts belong to the same document side.
 */
export function buildDocSortMessages(
  images: string[],
  slots: DocSlotOption[],
  groups?: number[][],
): ChatMessage[] {
  const groupNotes = (groups ?? []).filter((g) => g.length >= 2);
  const intro =
    images.length > 1
      ? `These ${images.length} images are numbered 1..${images.length} in order. Sort every one of them.`
      : "Sort this single image.";
  const groupText = groupNotes
    .map(
      (g) =>
        `Images ${g.join(" and ")} were cut from ONE page — either two sides of a combined scan (different slots), or two parts of ONE document (then give them the SAME slot).`,
    )
    .join(" ");
  const parts: ContentPart[] = [
    { type: "text", text: groupText ? `${intro} ${groupText}` : intro },
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
  // A «کد ملی» slot must never be created — parts of a تذکره are not a new type.
  if (s.replace(/[\s\u200c]+/g, "").includes("کدملی")) return null;
  if (s.length < 2) return null;
  return s;
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
    if (slotById.has(slotRaw)) {
      const slot = slotById.get(slotRaw)!;
      out.set(idx, { index: idx, target: { kind: "slot", slotId: slot.id, label: slot.label } });
    } else if (slotRaw === "photo") {
      out.set(idx, { index: idx, target: { kind: "photo" } });
    } else if (slotRaw === "new") {
      const label = sanitizeNewSlotLabel(e.label);
      out.set(
        idx,
        label
          ? { index: idx, target: { kind: "new", label } }
          : { index: idx, target: { kind: "other" } },
      );
    } else {
      out.set(idx, { index: idx, target: { kind: "other" } });
    }
  }

  // Every image must end up somewhere — missing/invalid → other.
  const results: DocSortResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push(out.get(i) ?? { index: i, target: { kind: "other" } });
  }
  return results;
}

/* ----------------------------- applying results ---------------------------- */

/** One image on its way to a destination (post split/collapse). */
export interface SortPiece {
  dataUrl: string;
  /** Name shown when the piece lands in «سایر». */
  origin: string;
  /** Index into `originals` — pieces sharing a groupId were cut from one page. */
  groupId: number;
}

/** The un-cut page each groupId refers to. */
export interface SortOriginal {
  dataUrl: string;
  origin: string;
}

/** A final filing action: one image → one destination. */
export interface SortAction {
  image: string;
  origin: string;
  target: DocSortTarget;
}

function targetKey(t: DocSortTarget): string {
  if (t.kind === "slot") return `slot:${t.slotId}`;
  if (t.kind === "new") return `new:${t.label}`;
  return t.kind; // "photo" | "other"
}

/**
 * Turn per-piece AI results into final filing actions.
 *
 * When every piece cut from ONE page received the same destination (or a mix
 * of one destination + "other"), the split was wrong — e.g. a single تذکره
 * back page whose internal white band fooled the cutter. In that case the
 * ORIGINAL whole page is filed once to that destination instead of the
 * pieces. Only genuinely different destinations keep the cut pieces apart.
 */
export function resolveActions(
  pieces: SortPiece[],
  originals: SortOriginal[],
  results: DocSortResult[],
): SortAction[] {
  const byGroup = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    const list = byGroup.get(p.groupId);
    if (list) list.push(i);
    else byGroup.set(p.groupId, [i]);
  });

  const actions: SortAction[] = [];
  for (const idxs of byGroup.values()) {
    if (idxs.length <= 1) {
      const i = idxs[0];
      const r = results[i];
      if (r) actions.push({ image: pieces[i].dataUrl, origin: pieces[i].origin, target: r.target });
      continue;
    }
    // A multi-piece group: pieces cut from one page.
    const distinct = new Map<string, DocSortTarget>();
    for (const i of idxs) {
      const t = results[i]?.target;
      if (!t || t.kind === "other") continue;
      const key = targetKey(t);
      if (!distinct.has(key)) distinct.set(key, t);
    }
    if (distinct.size >= 2) {
      // Two different real destinations → a true combined scan, keep pieces.
      for (const i of idxs) {
        const r = results[i];
        if (r) {
          actions.push({ image: pieces[i].dataUrl, origin: pieces[i].origin, target: r.target });
        }
      }
    } else {
      // One destination (or only "other") → file the ORIGINAL whole page once.
      const original = originals[pieces[idxs[0]].groupId] ?? pieces[idxs[0]];
      const target: DocSortTarget =
        distinct.size === 1 ? distinct.values().next().value! : { kind: "other" };
      actions.push({ image: original.dataUrl, origin: original.origin, target });
    }
  }
  return actions;
}
