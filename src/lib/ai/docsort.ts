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
- Front-of-tazkira slot = the side of the Afghan تذکره that identifies the PERSON: the electronic card with the holder's photo, OR the paper booklet page whose printed/handwritten fields are personal identity data (شماره تذکره، نام، تخلص، نام پدر، نام پدربزرگ، مذهب، زادگاه/ولایت، سال تولد…) usually under the state header (جمهوری اسلامی افغانستان / وزارت داخله).
- Back-of-tazkira slot = the OTHER side of the same تذکره. The paper back carries ISSUE and RECORD content: تاریخ صدور / محل صدور، نشانی، family & household record boxes, numbers, renewal notes, stamps, signatures and seal boxes — often one or several boxed tables.
- DECIDING RULE for paper تذکره pages: a page with record boxes / numbers / stamps / issue data and NO personal-identity fields is the BACK. A page whose content identifies the holder (name, father, birth…) is the FRONT. A whole back page — boxes, numbers, records and all — is ONE back-of-tazkira image.

TAZKIRA RULES (strict):
- The تذکره IS the Afghan identity document. The app has NO «کد ملی» slot and never needs one — NEVER choose or invent a slot for کد ملی.
- Any part, crop or section of a تذکره (a number box, a records box, a stamp area, half a page) still belongs to the front-of-tazkira or back-of-tazkira slot — NEVER to "new".
- Some images may be PARTS of one page that the app cut apart automatically (the app tells you which). If the parts show the SAME document side — e.g. the top and bottom of one page, one sliced box/table — give them ALL the SAME slot so the app re-joins them. Only give DIFFERENT slots when one part is clearly another side/document (e.g. one part has the holder's personal data, the other has record boxes).

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
    .map((g) =>
        `Images ${g.join(" and ")} were cut from ONE page — either two different sides/documents (then give different slots), or two parts of the SAME page, e.g. the top and bottom of one document (then give them ALL the SAME slot so the app re-joins them).`,
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

/** Normalize a Persian label for comparisons (space & ZWNJ insensitive). */
function normalizeLabel(s: string): string {
  return s.replace(/[\s\u200c]+/g, "").trim();
}

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
  const slotByNormLabel = new Map(slots.map((s) => [normalizeLabel(s.label), s]));
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
      // The model sometimes re-invents a slot that already exists (e.g.
      // «عکس روی تذکره») — map it back onto the real slot so the re-join
      // logic recognizes the same destination and no duplicate slot appears.
      const twin = label ? slotByNormLabel.get(normalizeLabel(label)) : undefined;
      if (twin) {
        out.set(idx, {
          index: idx,
          target: { kind: "slot", slotId: twin.id, label: twin.label },
        });
      } else {
        out.set(
          idx,
          label
            ? { index: idx, target: { kind: "new", label } }
            : { index: idx, target: { kind: "other" } },
        );
      }
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

/** Images per AI request (context/cost safety — extra images go in a 2nd batch). */
export const DOC_SORT_CHUNK = 6;

/**
 * Split the piece list into AI request chunks. Pieces cut from ONE page
 * (same groupId) always stay together in the same chunk, so the model sees
 * the whole group and the re-join hint makes sense.
 */
export function buildChunks(expanded: SortPiece[], chunkSize = DOC_SORT_CHUNK): number[][] {
  const chunks: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const start = i;
    while (i + 1 < expanded.length && expanded[i + 1].groupId === expanded[start].groupId) i++;
    const groupRun = Array.from({ length: i - start + 1 }, (_, k) => start + k);
    if (cur.length > 0 && cur.length + groupRun.length > chunkSize) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(...groupRun);
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Local 1-based image-index groups inside one chunk (for the model hint). */
export function chunkLocalGroups(expanded: SortPiece[], chunk: number[]): number[][] {
  const groups: number[][] = [];
  for (let k = 0; k < chunk.length; k++) {
    const gid = expanded[chunk[k]].groupId;
    const run: number[] = [k + 1];
    while (k + 1 < chunk.length && expanded[chunk[k + 1]].groupId === gid) {
      k++;
      run.push(k + 1);
    }
    if (run.length >= 2) groups.push(run);
  }
  return groups;
}

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
