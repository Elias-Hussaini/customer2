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
import { parseJsonLoose, salvageSortEntries } from "./jsonrepair";

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
  /** Position of the image inside the request batch. */
  index: number;
  target: DocSortTarget;
  /** How this verdict was reached — "ai" or a local basis (mrz/pdftext/filename). */
  basis?: string;
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

/** Words that carry no meaning when comparing slot labels. */
const STOP_WORDS = /^(?:عکس|اسکن|سند|مدارک|برگه|تصویر|کپی|به|از|و)$/;

/** Dari/Iranian spelling bridges — ویزا and ویزه are the same word. */
const SYNONYMS: [RegExp, string][] = [[/ویزا/g, "ویزه"]];

function applySynonyms(s: string): string {
  let out = s;
  for (const [re, to] of SYNONYMS) out = out.replace(re, to);
  return out;
}

/** Distinctive tokens of a label («عکس روی تذکره» → [روی، تذکره]). */
function labelKeywords(s: string): Set<string> {
  return new Set(
    applySynonyms(s)
      .replace(/[\u200c\u200f\u200e]/g, " ")
      .split(/[\s\-–—:،«»().]+/)
      .map((w) => normalizeLabel(w))
      .filter((w) => w.length >= 2 && !STOP_WORDS.test(w)),
  );
}

/** Strip the stop-words off a label so «عکس پاسپورت» ≈ «پاسپورت». */
function stripStopWords(s: string): string {
  return applySynonyms(normalizeLabel(s)).replace(/(?:عکس|اسکن|سند|مدارک|تصویر|کپی)/g, "");
}

/**
 * Fuzzy label→slot matching. Weak models answer with free Persian text
 * («پاسپورت»، «عکس پاسپورت»، «روی تذکره») or English words instead of the
 * exact slot id. Every such answer used to fall through to «سایر مدارک» —
 * the exact failure the users reported. This maps ANY recognizable mention
 * onto the real slot: containment either way, or ≥2 shared keywords.
 */
export function fuzzyMatchSlot(
  raw: string,
  slots: DocSlotOption[],
): DocSlotOption | null {
  const n = normalizeLabel(raw);
  if (!n) return null;
  // Direct containment either way («عکس پاسپورت» ⊂/⊃ «پاسپورت»).
  for (const s of slots) {
    const sn = stripStopWords(s.label);
    const rn = stripStopWords(raw);
    if (!sn || !rn) continue;
    if (sn === rn || sn.includes(rn) || rn.includes(sn)) return s;
  }
  // Keyword overlap («تذکره از پشت» vs «عکس پشت تذکره» → پشت + تذکره).
  const rk = labelKeywords(raw);
  if (rk.size === 0) return null;
  let best: { slot: DocSlotOption; shared: number } | null = null;
  for (const s of slots) {
    const sk = labelKeywords(s.label);
    let shared = 0;
    for (const k of rk) if (sk.has(k)) shared++;
    if (shared >= 2 || (shared === 1 && rk.size === 1 && sk.size <= 2)) {
      if (!best || shared > best.shared) best = { slot: s, shared };
    }
  }
  return best?.slot ?? null;
}

/** English words a model may use for the built-in kinds. */
const EN_KINDS: { re: RegExp; fa: string[] }[] = [
  { re: /passport|\bppt\b|\bpsp\b/i, fa: ["پاسپورت", "پاسپورط"] },
  { re: /tazkira|tazkere|e-?id|national\s*id|idcard|id\s*card/i, fa: ["تذکره", "تذکاری"] },
];

/** Translate an English slot word into Persian keywords and fuzzy-match. */
function matchEnglishSlotWord(raw: string, slots: DocSlotOption[]): DocSlotOption | null {
  for (const { re, fa } of EN_KINDS) {
    if (!re.test(raw)) continue;
    for (const word of fa) {
      const hit = fuzzyMatchSlot(word, slots);
      if (hit) return hit;
    }
  }
  return null;
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
 * Parse the model reply into one result per image (1..count). Tolerant:
 * repaired JSON first (fences/truncation/smart quotes), then per-image regex
 * salvage. Unknown slot ids, broken entries and missing indexes fall back to
 * «سایر» so an image is never silently dropped. Throws a Persian error when
 * the reply is unusable.
 */
export function parseDocSortReply(
  text: string,
  slots: DocSlotOption[],
  count: number,
): DocSortResult[] {
  if (count <= 0) return [];
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(text);
  } catch {
    parsed = undefined;
  }
  // Tolerate an object wrapper like {"sorts": [...]} or {"results": [...]}.
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const inner = Object.values(obj).find((v) => Array.isArray(v)) ?? null;
    parsed = inner; // null when the wrapper holds no array → salvage below
  }
  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else {
    // Regex salvage: {"index":1,"slot":"passport"} entries out of any reply.
    const salvaged = salvageSortEntries(text);
    if (salvaged.length === 0) {
      throw new Error("پاسخ هوش مصنوعی قابل خواندن نبود (JSON نامعتبر).");
    }
    list = salvaged;
  }

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const slotByNormLabel = new Map(slots.map((s) => [normalizeLabel(s.label), s]));
  const out = new Map<number, DocSortResult>();

  for (const entry of list) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const idx = Number(e.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > count) continue;
    if (out.has(idx)) continue; // first answer per index wins
    let slotRaw = typeof e.slot === "string" ? e.slot.trim() : "";
    // The model sometimes answers with the Persian LABEL instead of the id
    // («پشت تذکره» instead of "doc-back-tazkira") — map it onto the real slot
    // instead of dropping the image into «سایر».
    if (slotRaw && !slotById.has(slotRaw)) {
      const byLabel = slotByNormLabel.get(normalizeLabel(slotRaw));
      if (byLabel) slotRaw = byLabel.id;
    }
    // Persian equivalents the model may use for the special targets.
    if (slotRaw === "سایر" || slotRaw === "نامشخص" || slotRaw === "دیگر") slotRaw = "other";
    if (slotRaw === "عکس" || slotRaw === "عکس پروفایل" || slotRaw === "عکس شخصی") slotRaw = "photo";
    // LAST LINE OF DEFENSE before «سایر»: a free-text Persian answer
    // («عکس پاسپورت»، «تذکره از پشت»، "passport") or a near-miss label must
    // land on the real slot it so obviously means — never in سایر مدارک.
    if (slotRaw && !slotById.has(slotRaw) && slotRaw !== "photo" && slotRaw !== "other" && slotRaw !== "new") {
      const fuzzy = fuzzyMatchSlot(slotRaw, slots) ?? matchEnglishSlotWord(slotRaw, slots);
      if (fuzzy) slotRaw = fuzzy.id;
    }
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
      // Fuzzy: «عکس ویزه» ≈ «ویزه» — near-duplicate slots (the user's
      // «تکراری» complaint) are collapsed onto the existing one.
      const twin = label
        ? (slotByNormLabel.get(normalizeLabel(label)) ?? fuzzyMatchSlot(label, slots) ?? null)
        : null;
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

/**
 * Chunks over a SUBSET of piece indexes (the pieces still needing the
 * cloud AI — locally-resolved pieces never enter a request). Pieces cut
 * from ONE page stay together; GLOBAL indexes are returned so the caller
 * can map answers back onto the right pieces.
 */
export function buildFilteredChunks(
  expanded: SortPiece[],
  candidates: number[],
  chunkSize = DOC_SORT_CHUNK,
): number[][] {
  const chunks: number[][] = [];
  let cur: number[] = [];
  for (let k = 0; k < candidates.length; k++) {
    const pieceIdx = candidates[k];
    const gid = expanded[pieceIdx]?.groupId;
    // Extend the run while the next candidate belongs to the same page.
    const run: number[] = [pieceIdx];
    while (
      k + 1 < candidates.length &&
      expanded[candidates[k + 1]] &&
      expanded[candidates[k + 1]].groupId === gid
    ) {
      k++;
      run.push(candidates[k]);
    }
    if (cur.length > 0 && cur.length + run.length > chunkSize) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(...run);
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
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
  /** How the destination was decided (mrz / pdftext / filename / ai / unknown). */
  basis?: string;
}

function targetKey(t: DocSortTarget): string {
  if (t.kind === "slot") return `slot:${t.slotId}`;
  if (t.kind === "new") return `new:${t.label}`;
  return t.kind; // "photo" | "other"
}

/** Per-piece results: dense array (0-based) OR a sparse map keyed by piece index. */
export type ResultLookup = DocSortResult[] | Map<number, DocSortResult>;

function resultAt(results: ResultLookup, i: number): DocSortResult | undefined {
  return Array.isArray(results) ? results[i] : results.get(i);
}

/**
 * Turn per-piece results (cloud AI + local algorithm merged by the caller)
 * into final filing actions.
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
  results: ResultLookup,
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
      const r = resultAt(results, i);
      if (r) actions.push({ image: pieces[i].dataUrl, origin: pieces[i].origin, target: r.target, basis: r.basis });
      continue;
    }
    // A multi-piece group: pieces cut from one page.
    const distinct = new Map<string, DocSortTarget>();
    let groupBasis: string | undefined;
    for (const i of idxs) {
      const r = resultAt(results, i);
      const t = r?.target;
      if (!t || t.kind === "other") continue;
      const key = targetKey(t);
      if (!distinct.has(key)) {
        distinct.set(key, t);
        if (!groupBasis) groupBasis = r?.basis;
      }
    }
    if (distinct.size >= 2) {
      // Two different real destinations → a true combined scan, keep pieces.
      for (const i of idxs) {
        const r = resultAt(results, i);
        if (r) {
          actions.push({ image: pieces[i].dataUrl, origin: pieces[i].origin, target: r.target, basis: r.basis });
        }
      }
    } else {
      // One destination (or only "other") → file the ORIGINAL whole page once.
      const original = originals[pieces[idxs[0]].groupId] ?? pieces[idxs[0]];
      const target: DocSortTarget =
        distinct.size === 1 ? distinct.values().next().value! : { kind: "other" };
      actions.push({ image: original.dataUrl, origin: original.origin, target, basis: groupBasis });
    }
  }
  return actions;
}
