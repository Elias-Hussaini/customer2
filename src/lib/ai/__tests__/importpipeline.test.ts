/**
 * Imaging import pipeline — the PURE planning part (blank-page filter) plus
 * the canvas helper math used by the editor (clamp/rect/ratio/size labels).
 * Rendering itself needs a browser; QA covers it live.
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { planImportPages } from "../imaging";
import {
  clampSel,
  fitRatio,
  humanBytes,
  retargetExt,
  savingsPct,
  selToRect,
} from "../../../lib/studio/canvas";

describe("planImportPages (deterministic PDF import)", () => {
  it("drops blank pages and keeps the rest in order", () => {
    const pages = [
      { index: 1, blank: false },
      { index: 2, blank: true },
      { index: 3, blank: true },
      { index: 4, blank: false },
    ];
    expect(planImportPages(pages).map((p) => p.index)).toEqual([1, 4]);
    expect(planImportPages([])).toEqual([]);
    expect(planImportPages([{ index: 9, blank: true }])).toEqual([]);
  });
});

describe("studio canvas math", () => {
  it("clamps selections inside [0,1] with a minimum size", () => {
    expect(clampSel({ x: -0.2, y: -0.1, w: 1.5, h: 0.2 })).toEqual({ x: 0, y: 0, w: 1, h: 0.2 });
    expect(clampSel({ x: 0.9, y: 0.9, w: 0.05, h: 0.05 })).toEqual({ x: 0.9, y: 0.9, w: 0.05, h: 0.05 });
    // a big selection near the edge shrinks to whatever fits (1 - x)
    const edge = clampSel({ x: 0.99, y: 0.99, w: 0.2, h: 0.2 });
    expect(edge.x + edge.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("maps a selection to pixel rects", () => {
    expect(selToRect({ x: 0.5, y: 0.25, w: 0.5, h: 0.75 }, 1000, 800)).toEqual({
      x: 500,
      y: 200,
      w: 500,
      h: 600,
    });
  });

  it("fits one dimension from the ratio", () => {
    expect(fitRatio(800, null, 4 / 3)).toEqual({ w: 800, h: 600 });
    expect(fitRatio(null, 600, 4 / 3)).toEqual({ w: 800, h: 600 });
    expect(fitRatio(null, null, 2)).toEqual({ w: 0, h: 0 });
  });

  it("labels sizes in Persian and computes savings", () => {
    expect(humanBytes(500)).toContain("بایت");
    expect(humanBytes(2048)).toContain("کیلوبایت");
    expect(humanBytes(3 * 1024 * 1024)).toContain("مگابایت");
    expect(savingsPct(1000, 250)).toBe(75);
    expect(savingsPct(250, 1000)).toBe(-300);
    expect(savingsPct(0, 10)).toBeNull();
  });

  it("retargets filename extensions per format", () => {
    expect(retargetExt("عکس من.png", "image/webp")).toBe("عکس من.webp");
    expect(retargetExt("photo.jpeg", "image/png")).toBe("photo.png");
    expect(retargetExt("بدون-پسوند", "image/jpeg")).toBe("بدون-پسوند.jpg");
  });
});
