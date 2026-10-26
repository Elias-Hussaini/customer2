/**
 * Tests for the AI document-sorting flow:
 *  - prompt building with the user's custom slots
 *  - reply parsing (valid / fenced / wrapper / unknown ids / new labels /
 *    missing indexes)
 *  - gutter-band detection for combined scans (pure math part)
 */

import { describe, expect, it } from "vitest";
import {
  buildDocSortMessages,
  buildDocSortSystemPrompt,
  extractJsonArray,
  parseDocSortReply,
  resolveActions,
  sanitizeNewSlotLabel,
  type DocSlotOption,
  type DocSortResult,
  type SortOriginal,
  type SortPiece,
} from "../docsort";
import {
  DEFAULT_GUTTER_OPTIONS,
  findGutterBands,
  type LineProfile,
} from "../split";

const SLOTS: DocSlotOption[] = [
  { id: "passport", label: "عکس پاسپورت" },
  { id: "nidFront", label: "عکس روی تذکره" },
  { id: "nidBack", label: "عکس پشت تذکره" },
  { id: "visaPage", label: "عکس ویزه" },
];

describe("buildDocSortSystemPrompt", () => {
  it("embeds every slot id + Persian label", () => {
    const prompt = buildDocSortSystemPrompt(SLOTS);
    for (const s of SLOTS) {
      expect(prompt).toContain(`"${s.id}" — ${s.label}`);
    }
  });

  it("mentions handwritten tazkira, the photo target and the new-slot target", () => {
    const prompt = buildDocSortSystemPrompt(SLOTS);
    expect(prompt).toContain("handwritten");
    expect(prompt).toContain('"photo"');
    expect(prompt).toContain('"new"');
    expect(prompt).toContain('"other"');
  });

  it("forbids a کد ملی slot and never calls the تذکره a national ID document type", () => {
    const prompt = buildDocSortSystemPrompt(SLOTS);
    expect(prompt).toContain("کد ملی");
    expect(prompt).toContain("NEVER");
    expect(prompt).not.toContain("national ID");
  });

  it("handles an empty slot list without crashing", () => {
    const prompt = buildDocSortSystemPrompt([]);
    expect(prompt).toContain("(none defined)");
  });
});

describe("buildDocSortMessages", () => {
  it("numbers multi-image batches and attaches every image", () => {
    const msgs = buildDocSortMessages(["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"], SLOTS);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    const user = msgs[1];
    expect(user.role).toBe("user");
    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0].text).toContain("numbered 1..2");
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
  });

  it("tells the model which images were cut from one page", () => {
    const msgs = buildDocSortMessages(["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"], SLOTS, [
      [2, 3],
    ]);
    const parts = msgs[1].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).toContain("Images 2 and 3 were cut from ONE page");
  });

  it("no group note without groups", () => {
    const msgs = buildDocSortMessages(["data:image/jpeg;base64,AAA"], SLOTS);
    const parts = msgs[1].content as Array<{ type: string; text?: string }>;
    expect(parts[0].text).not.toContain("cut from ONE page");
  });
});

describe("extractJsonArray", () => {
  it("extracts a fenced array", () => {
    expect(extractJsonArray('```json\n[{"index":1,"slot":"photo"}]\n```')).toBe(
      '[{"index":1,"slot":"photo"}]',
    );
  });

  it("tolerates trailing commas", () => {
    expect(extractJsonArray('[{"index":1,"slot":"other"},]')).toBe('[{"index":1,"slot":"other"}]');
  });

  it("throws when no array is present", () => {
    expect(() => extractJsonArray("no json here")).toThrow();
  });
});

describe("sanitizeNewSlotLabel", () => {
  it("keeps a clean Persian label", () => {
    expect(sanitizeNewSlotLabel("عکس ویزه")).toBe("عکس ویزه");
  });

  it("collapses whitespace and strips path characters", () => {
    expect(sanitizeNewSlotLabel("  گواهی   نامه  ")).toBe("گواهی نامه");
    expect(sanitizeNewSlotLabel('عکس/ویزه:شنگل')).toBe("عکسویزهشنگل");
  });

  it("rejects Latin-only, empty, too-long, non-string and کد ملی labels", () => {
    expect(sanitizeNewSlotLabel("Driving License")).toBeNull();
    expect(sanitizeNewSlotLabel("")).toBeNull();
    expect(sanitizeNewSlotLabel("ع")).toBeNull();
    expect(sanitizeNewSlotLabel("ع".repeat(40))).toBeNull();
    expect(sanitizeNewSlotLabel(42)).toBeNull();
    expect(sanitizeNewSlotLabel("کد ملی")).toBeNull();
    expect(sanitizeNewSlotLabel("عکس کدملی")).toBeNull();
  });
});

describe("parseDocSortReply", () => {
  it("maps every index to its slot target", () => {
    const reply = JSON.stringify([
      { index: 1, slot: "passport" },
      { index: 2, slot: "nidFront" },
      { index: 3, slot: "nidBack" },
    ]);
    const out = parseDocSortReply(reply, SLOTS, 3);
    expect(out).toHaveLength(3);
    expect(out[0].target).toEqual({ kind: "slot", slotId: "passport", label: "عکس پاسپورت" });
    expect(out[1].target).toEqual({ kind: "slot", slotId: "nidFront", label: "عکس روی تذکره" });
    expect(out[2].target).toEqual({ kind: "slot", slotId: "nidBack", label: "عکس پشت تذکره" });
  });

  it("understands photo / new / other targets", () => {
    const reply = JSON.stringify([
      { index: 1, slot: "photo" },
      { index: 2, slot: "new", label: "عکس شناسنامه" },
      { index: 3, slot: "other" },
    ]);
    const out = parseDocSortReply(reply, SLOTS, 3);
    expect(out[0].target).toEqual({ kind: "photo" });
    expect(out[1].target).toEqual({ kind: "new", label: "عکس شناسنامه" });
    expect(out[2].target).toEqual({ kind: "other" });
  });

  it("falls back to other for unknown slot ids, invalid new labels and junk entries", () => {
    const reply = JSON.stringify([
      { index: 1, slot: "does-not-exist" },
      { index: 2, slot: "new", label: "not persian" },
      { index: 3, slot: "new" },
      { index: 4 },
    ]);
    const out = parseDocSortReply(reply, SLOTS, 4);
    for (const r of out) expect(r.target).toEqual({ kind: "other" });
  });

  it("fills missing indexes with other so no image is dropped", () => {
    const reply = JSON.stringify([{ index: 2, slot: "passport" }]);
    const out = parseDocSortReply(reply, SLOTS, 3);
    expect(out[0].target).toEqual({ kind: "other" });
    expect(out[1].target.kind).toBe("slot");
    expect(out[2].target).toEqual({ kind: "other" });
  });

  it("ignores out-of-range and duplicate indexes", () => {
    const reply = JSON.stringify([
      { index: 0, slot: "passport" },
      { index: 7, slot: "passport" },
      { index: 1, slot: "nidBack" },
      { index: 1, slot: "passport" },
    ]);
    const out = parseDocSortReply(reply, SLOTS, 1);
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ kind: "slot", slotId: "nidBack", label: "عکس پشت تذکره" });
  });

  it("reads fenced replies and object wrappers", () => {
    const fenced = "```json\n[{\"index\":1,\"slot\":\"photo\"}]\n```";
    expect(parseDocSortReply(fenced, SLOTS, 1)[0].target).toEqual({ kind: "photo" });
    const wrapped = JSON.stringify({ sorts: [{ index: 1, slot: "photo" }] });
    expect(parseDocSortReply(wrapped, SLOTS, 1)[0].target).toEqual({ kind: "photo" });
  });

  it("throws a Persian error for unusable replies", () => {
    expect(() => parseDocSortReply("total garbage", SLOTS, 2)).toThrow(/JSON/);
  });
});

/* ------------------------------ resolveActions ----------------------------- */

const NID_BACK = { kind: "slot", slotId: "nidBack", label: "عکس پشت تذکره" } as const;
const NID_FRONT = { kind: "slot", slotId: "nidFront", label: "عکس روی تذکره" } as const;

function piecesAndOriginals() {
  const originals: SortOriginal[] = [
    { dataUrl: "data:,whole-tazkira-back", origin: "page-1.jpg" },
    { dataUrl: "data:,standalone", origin: "photo.jpg" },
  ];
  const pieces: SortPiece[] = [
    { dataUrl: "data:,top-half", origin: "page-1-بخش1.jpg", groupId: 0 },
    { dataUrl: "data:,bottom-half", origin: "page-1-بخش2.jpg", groupId: 0 },
    { dataUrl: "data:,standalone", origin: "photo.jpg", groupId: 1 },
  ];
  return { originals, pieces };
}

describe("resolveActions", () => {
  it("re-joins pieces of one page that all got the same slot (the halved tazkira back)", () => {
    const { originals, pieces } = piecesAndOriginals();
    const results: DocSortResult[] = [
      { index: 1, target: { ...NID_BACK } },
      { index: 2, target: { ...NID_BACK } },
      { index: 3, target: { kind: "photo" } },
    ];
    const actions = resolveActions(pieces, originals, results);
    expect(actions).toHaveLength(2);
    // The whole un-cut page goes to پشت تذکره once — never two halves.
    expect(actions[0]).toEqual({ image: "data:,whole-tazkira-back", origin: "page-1.jpg", target: NID_BACK });
    expect(actions[1].target).toEqual({ kind: "photo" });
  });

  it("keeps the cut pieces when they are truly different sides (front + back)", () => {
    const { originals, pieces } = piecesAndOriginals();
    const results: DocSortResult[] = [
      { index: 1, target: { ...NID_FRONT } },
      { index: 2, target: { ...NID_BACK } },
      { index: 3, target: { kind: "other" } },
    ];
    const actions = resolveActions(pieces, originals, results);
    expect(actions).toHaveLength(3);
    expect(actions[0].image).toBe("data:,top-half");
    expect(actions[0].target).toEqual(NID_FRONT);
    expect(actions[1].image).toBe("data:,bottom-half");
    expect(actions[1].target).toEqual(NID_BACK);
  });

  it("absorbs an unreadable piece into the whole page (slot + other collapses)", () => {
    const { originals, pieces } = piecesAndOriginals();
    const results: DocSortResult[] = [
      { index: 1, target: { ...NID_BACK } },
      { index: 2, target: { kind: "other" } },
      { index: 3, target: { kind: "other" } },
    ];
    const actions = resolveActions(pieces, originals, results);
    expect(actions).toHaveLength(2);
    expect(actions[0].image).toBe("data:,whole-tazkira-back");
    expect(actions[0].target).toEqual(NID_BACK);
    expect(actions[1].target).toEqual({ kind: "other" });
  });

  it("files the whole page to سایر once when every piece is other", () => {
    const { originals, pieces } = piecesAndOriginals();
    const results: DocSortResult[] = [
      { index: 1, target: { kind: "other" } },
      { index: 2, target: { kind: "other" } },
      { index: 3, target: { ...NID_FRONT } },
    ];
    const actions = resolveActions(pieces, originals, results);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ image: "data:,whole-tazkira-back", origin: "page-1.jpg", target: { kind: "other" } });
  });

  it("passes uncut pieces straight through", () => {
    const originals: SortOriginal[] = [{ dataUrl: "data:,solo", origin: "s.jpg" }];
    const pieces: SortPiece[] = [{ dataUrl: "data:,solo", origin: "s.jpg", groupId: 0 }];
    const actions = resolveActions(pieces, originals, [{ index: 1, target: { ...NID_FRONT } }]);
    expect(actions).toEqual([{ image: "data:,solo", origin: "s.jpg", target: NID_FRONT }]);
  });
});

/* ------------------------------ gutter bands ------------------------------ */

/** Build a profile list: content lines (noisy, mid-gray) vs blank lines. */
function profiles(n: number, blank: number[]): LineProfile[] {
  return Array.from({ length: n }, (_, i) =>
    blank.includes(i)
      ? { mean: 245, stddev: 2 }
      : { mean: 120 + (i % 7) * 3, stddev: 48 },
  );
}

describe("findGutterBands", () => {
  it("finds a centered blank band (side-by-side scan)", () => {
    const n = 100;
    const band = profiles(n, [48, 49, 50, 51, 52]);
    const out = findGutterBands(band);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeGreaterThan(0.4);
    expect(out[0]).toBeLessThan(0.6);
  });

  it("returns nothing when the image is all content (single document)", () => {
    expect(findGutterBands(profiles(100, []))).toEqual([]);
  });

  it("rejects a blank strip hugging the edge (scan margin)", () => {
    const n = 100;
    const margin = profiles(n, [0, 1, 2, 3, 4, 5]);
    expect(findGutterBands(margin)).toEqual([]);
  });

  it("rejects an oversized blank band (a single page, not a combined scan)", () => {
    const n = 100;
    const wide = profiles(n, Array.from({ length: 40 }, (_, i) => 30 + i));
    expect(findGutterBands(wide)).toEqual([]);
  });

  it("supports two bands (three documents in a row)", () => {
    const n = 120;
    const three = profiles(n, [38, 39, 40, 78, 79, 80]);
    const out = findGutterBands(three);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[0]).toBeLessThan(0.4);
    expect(out[1]).toBeGreaterThan(0.6);
    expect(out[1]).toBeLessThan(0.7);
  });

  it("collapses two nearly-touching bands into one", () => {
    const n = 120;
    const close = profiles(n, [38, 39, 40, 41, 44, 45]);
    expect(findGutterBands(close)).toHaveLength(1);
  });

  it("needs a minimum image size", () => {
    expect(findGutterBands(profiles(5, [2]))).toEqual([]);
  });

  it("honors custom options (darker paper)", () => {
    const n = 100;
    const grayPaper = Array.from({ length: n }, (_, i) =>
      i >= 48 && i <= 52 ? { mean: 150, stddev: 3 } : { mean: 110, stddev: 52 },
    );
    expect(findGutterBands(grayPaper)).toEqual([]); // below default whiteness
    expect(
      findGutterBands(grayPaper, { ...DEFAULT_GUTTER_OPTIONS, minMean: 140 }),
    ).toHaveLength(1);
  });
});
