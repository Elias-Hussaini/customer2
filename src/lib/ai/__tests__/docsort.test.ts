/**
 * Tests for the AI document-sorting flow:
 *  - prompt building with the user's custom slots
 *  - reply parsing (valid / fenced / wrapper / unknown ids / new labels /
 *    new-labels-that-match-existing-slots / missing indexes)
 *  - resolveActions re-joining (incl. the halved-تذکره-back cases)
 *  - gutter-band detection + the cut-through-content guard
 *  - resumable chunk building
 */

import { describe, expect, it } from "vitest";
import {
  buildChunks,
  buildDocSortMessages,
  buildDocSortSystemPrompt,
  chunkLocalGroups,
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
  bandSlicesContent,
  findGutterBands,
  findGutterRuns,
  stripInkStats,
  type GrayImage,
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

  it("maps a 'new' label that matches an EXISTING slot onto that slot (no duplicate slot, re-join works)", () => {
    const reply = JSON.stringify([
      { index: 1, slot: "new", label: "عکس روی تذکره" },
      { index: 2, slot: "new", label: "عکس‌روی تذکره" }, // ZWNJ/space differences too
      { index: 3, slot: "new", label: "عکس شناسنامه" }, // genuinely new → stays "new"
    ]);
    const out = parseDocSortReply(reply, SLOTS, 3);
    expect(out[0].target).toEqual({ kind: "slot", slotId: "nidFront", label: "عکس روی تذکره" });
    expect(out[1].target).toEqual({ kind: "slot", slotId: "nidFront", label: "عکس روی تذکره" });
    expect(out[2].target).toEqual({ kind: "new", label: "عکس شناسنامه" });
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

  it("end-to-end: halves labeled 'slot-front' + 'new with the front label' still re-join into one whole page", () => {
    // The exact bug the user hit: the tazkira back was halved and the model
    // filed one half as the front slot, the other as a "new" slot whose label
    // is just the front slot's own name → two photos landed in روی تذکره.
    const { originals, pieces } = piecesAndOriginals();
    const reply = JSON.stringify([
      { index: 1, slot: "nidFront" },
      { index: 2, slot: "new", label: "عکس روی تذکره" },
      { index: 3, slot: "photo" },
    ]);
    const results = parseDocSortReply(reply, SLOTS, 3);
    const actions = resolveActions(pieces, originals, results);
    expect(actions).toHaveLength(2);
    expect(actions[0].image).toBe("data:,whole-tazkira-back"); // re-joined, filed ONCE
    expect(actions[0].target).toEqual(NID_FRONT);
    expect(actions[1].target).toEqual({ kind: "photo" });
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

/* --------------------------- gutter run boundaries -------------------------- */

describe("findGutterRuns", () => {
  it("returns start/end/center fractions for the blank band", () => {
    const runs = findGutterRuns(profiles(100, [48, 49, 50, 51, 52]));
    expect(runs).toHaveLength(1);
    expect(runs[0].center).toBeGreaterThan(0.4);
    expect(runs[0].center).toBeLessThan(0.6);
    expect(runs[0].start).toBeLessThan(runs[0].center);
    expect(runs[0].end).toBeGreaterThan(runs[0].center);
    expect(runs[0].end - runs[0].start).toBeGreaterThan(0.02);
  });
});

/* ----------------------- cut-through-content guard -------------------------- */

/** Synthetic grayscale image builder. */
function grayImg(w: number, h: number, fill: (x: number, y: number) => number): GrayImage {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y);
  }
  return { data, w, h };
}

describe("stripInkStats", () => {
  it("reports no ink on a blank strip", () => {
    const img = grayImg(100, 200, () => 240);
    const s = stripInkStats(img, 47, 49, true);
    expect(s.ink).toBe(0);
    expect(s.rule).toBe(false);
  });

  it("detects dense sliced text (ink fraction)", () => {
    const img = grayImg(100, 200, (x) => (47 <= x && x < 49 ? (x % 2 === 0 ? 60 : 200) : 240));
    const s = stripInkStats(img, 47, 49, true);
    expect(s.ink).toBeGreaterThan(0.015);
    expect(s.rule).toBe(false); // scattered ink — not a solid line
  });

  it("detects a sliced box border (solid rule line) even with low overall ink", () => {
    // One dark horizontal line inside the strip, rest blank paper.
    const img = grayImg(100, 200, (x, y) => (y === 100 && 47 <= x && x < 49 ? 30 : 240));
    const s = stripInkStats(img, 47, 49, true);
    expect(s.ink).toBeLessThan(0.015); // overall ink is tiny…
    expect(s.rule).toBe(true); // …but the rule line proves content was sliced
  });
});

describe("bandSlicesContent", () => {
  it("allows a real gutter — clean blank margins on both sides of the band", () => {
    // White bed/gutter band at 0.49–0.51 of the width, documents left & right
    // start further away — the strips beside the band are blank.
    const img = grayImg(100, 200, (x) => (x < 45 || x > 55 ? 120 : 245));
    expect(bandSlicesContent(img, { start: 0.49, end: 0.51 }, true)).toBe(false);
  });

  it("rejects the band when a box border runs along its edge (halved tazkira back)", () => {
    // Document content everywhere except the white band 0.49–0.51; the box
    // border lines sit immediately left/right of the band.
    const img = grayImg(100, 200, (x, y) => {
      if (x >= 49 && x < 51) return 245; // the white band
      if (x === 48 || x === 51) return y % 3 === 0 ? 40 : 230; // sliced border/ink
      return 140; // document body
    });
    expect(bandSlicesContent(img, { start: 0.49, end: 0.51 }, true)).toBe(true);
  });

  it("rejects the band when text touches the edge on only ONE side", () => {
    const img = grayImg(100, 200, (x, y) => {
      if (x >= 49 && x < 51) return 245;
      if (x >= 51 && x < 53) return y % 4 < 2 ? 60 : 235; // dense text right of band
      return 235;
    });
    expect(bandSlicesContent(img, { start: 0.49, end: 0.51 }, true)).toBe(true);
  });

  it("works for horizontal cuts too (stacked front+back vs one sliced page)", () => {
    // Clean horizontal gutter between two documents → allowed.
    const clean = grayImg(200, 100, (_x, y) => (y < 45 || y > 55 ? 120 : 245));
    expect(bandSlicesContent(clean, { start: 0.49, end: 0.51 }, false)).toBe(false);
    // One document with an internal white band → border lines touch → rejected.
    const sliced = grayImg(200, 100, (_x, y) => {
      if (y >= 49 && y < 51) return 245;
      if (y === 48 || y === 51) return 40; // sliced horizontal box border
      return 140;
    });
    expect(bandSlicesContent(sliced, { start: 0.49, end: 0.51 }, false)).toBe(true);
  });
});

/* ------------------------------ chunk building ------------------------------ */

function piecesWithGroups(groupIds: number[]): SortPiece[] {
  return groupIds.map((g, i) => ({ dataUrl: `data:,p${i}`, origin: `p${i}.jpg`, groupId: g }));
}

describe("buildChunks", () => {
  it("keeps a small batch in one chunk", () => {
    expect(buildChunks(piecesWithGroups([0, 1, 2, 3]))).toEqual([[0, 1, 2, 3]]);
  });

  it("splits a long batch at the chunk size", () => {
    const ids = Array.from({ length: 8 }, (_, i) => i);
    expect(buildChunks(piecesWithGroups(ids))).toEqual([[0, 1, 2, 3, 4, 5], [6, 7]]);
  });

  it("never lets a cut group straddle two chunks", () => {
    // 5 single pages + a 2-piece group → group starts a fresh chunk.
    const chunks = buildChunks(piecesWithGroups([0, 1, 2, 3, 4, 5, 5]));
    expect(chunks).toEqual([[0, 1, 2, 3, 4], [5, 6]]);
    for (const chunk of chunks) {
      const groups = chunk.map((i) => piecesWithGroups([0, 1, 2, 3, 4, 5, 5])[i].groupId);
      const first = groups[0];
      // a group is either fully inside or fully outside this chunk
      expect(groups.filter((g) => g === 5).length).not.toBe(1);
      expect(first).toBeDefined();
    }
  });
});

describe("chunkLocalGroups", () => {
  it("returns local 1-based index groups for the model hint", () => {
    const pieces = piecesWithGroups([7, 7, 8, 9, 9]);
    expect(chunkLocalGroups(pieces, [0, 1, 2, 3, 4])).toEqual([[1, 2], [4, 5]]);
  });

  it("returns nothing when the chunk has no cut groups", () => {
    const pieces = piecesWithGroups([0, 1, 2]);
    expect(chunkLocalGroups(pieces, [0, 1, 2])).toEqual([]);
  });
});

/* ------------------------- sheet-edge rescue tests ------------------------- */

import { findSheetEdgeCut } from "../split";

describe("findSheetEdgeCut", () => {
  it("finds the gutter between two covered sheet blocks (true combined scan)", () => {
    // 100×200 analysis image, horizontal cut axis (rows). Rows 20-40 = sheet1
    // margin+edge (paper 235 run across 80% of the width), rows 41-79 = pure
    // bed 255, rows 80-100 = sheet2. → cut at the middle of the 41..79 gap.
    const img = grayImg(100, 200, (x, y) => {
      if ((y >= 20 && y <= 40) || (y >= 80 && y <= 100)) return x < 80 ? 235 : 255;
      return 255;
    });
    const cut = findSheetEdgeCut(img, { start: 0.1, end: 0.5 }, false);
    expect(cut).not.toBeNull();
    expect(cut!).toBeGreaterThan(0.19);
    expect(cut!).toBeLessThan(0.41);
  });

  it("returns null when the paper is visible through the whole band (ONE document)", () => {
    // An internal white gap of a single page: paper tone spans every row.
    const img = grayImg(100, 200, (x, y) => {
      if (y >= 60 && y <= 140) return 250; // the white gap — still paper
      return 140; // document content above/below
    });
    expect(findSheetEdgeCut(img, { start: 0.28, end: 0.72 }, false)).toBeNull();
  });

  it("returns null when the band shows nothing at all (pure gutter, nothing to rescue)", () => {
    const img = grayImg(100, 200, () => 255);
    expect(findSheetEdgeCut(img, { start: 0.3, end: 0.7 }, false)).toBeNull();
  });

  it("returns null when the uncovered gap is too small to be a real gutter", () => {
    // Two blocks separated by a single uncovered row — not a physical gutter.
    const img = grayImg(100, 200, (x, y) => {
      if (y === 50) return 255;
      if (y >= 30 && y <= 70) return x < 80 ? 235 : 255;
      return 255;
    });
    expect(findSheetEdgeCut(img, { start: 0.12, end: 0.38 }, false)).toBeNull();
  });

  it("works transposed as well (side-by-side scan, vertical cut)", () => {
    const img = grayImg(200, 100, (x, y) => {
      if ((x >= 20 && x <= 40) || (x >= 80 && x <= 100)) return y < 80 ? 235 : 255;
      return 255;
    });
    const cut = findSheetEdgeCut(img, { start: 0.1, end: 0.5 }, true);
    expect(cut).not.toBeNull();
    expect(cut!).toBeGreaterThan(0.19);
    expect(cut!).toBeLessThan(0.41);
  });
});
