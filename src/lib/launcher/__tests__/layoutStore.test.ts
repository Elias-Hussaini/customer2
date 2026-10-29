/**
 * Launcher layout store tests — persistence, normalization, drag geometry.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { robotBus } from "../../robot/eventBus";
import {
  clampFree,
  commitDrag,
  defaultLayout,
  getLauncherLayout,
  nearestSlotIndex,
  previewDrop,
  resetLauncherLayout,
  saveLauncherLayout,
  subscribeLauncherLayout,
  type LauncherItem,
} from "../layoutStore";

beforeEach(() => {
  robotBus.reset();
  resetLauncherLayout();
});

describe("layoutStore — defaults & persistence", () => {
  it("defaults: 5 dock items (dashboard first) + accounting floating", () => {
    const items = getLauncherLayout();
    const dock = items.filter((i) => i.place === "dock");
    const free = items.filter((i) => i.place === "free");
    expect(dock.map((i) => i.id)).toEqual([
      "nav-dashboard",
      "nav-lists",
      "nav-customers",
      "nav-reps",
      "nav-archive",
    ]);
    expect(dock[0].end).toBe(true);
    expect(free.map((i) => i.id)).toEqual(["acc-accounting"]);
    expect(free[0].fx).toBeGreaterThan(0);
    expect(free[0].fy).toBeGreaterThan(0);
  });

  it("persists and reads back (survives a fresh module read)", () => {
    const items = getLauncherLayout();
    const moved: LauncherItem[] = items.map((i) =>
      i.id === "nav-lists" ? { ...i, place: "free" as const, fx: 0.5, fy: 0.4, order: 0 } : i,
    );
    saveLauncherLayout(moved);
    const again = getLauncherLayout();
    expect(again.find((i) => i.id === "nav-lists")?.place).toBe("free");
    expect(again.find((i) => i.id === "nav-lists")?.fx).toBeCloseTo(0.5);
    // dock got re-normalized without it
    expect(again.filter((i) => i.place === "dock").map((i) => i.id)).not.toContain("nav-lists");
  });

  it("notifies subscribers on save", () => {
    let hits = 0;
    const off = subscribeLauncherLayout(() => hits++);
    saveLauncherLayout(getLauncherLayout());
    off();
    saveLauncherLayout(getLauncherLayout());
    expect(hits).toBe(1);
  });

  it("reset restores the factory defaults", () => {
    const items = getLauncherLayout();
    saveLauncherLayout(items.map((i) => ({ ...i, place: "free", fx: 0.2, fy: 0.2 })));
    const restored = resetLauncherLayout();
    expect(restored.filter((i) => i.place === "dock").length).toBe(5);
    expect(restored.find((i) => i.id === "acc-accounting")?.place).toBe("free");
  });

  it("save normalizes dock orders to 0..n-1", () => {
    const items = getLauncherLayout().map((i) =>
      i.place === "dock" ? { ...i, order: i.order * 10 + 7 } : i,
    );
    const saved = saveLauncherLayout(items);
    expect(saved.filter((i) => i.place === "dock").map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("clampFree", () => {
  it("keeps in-range positions untouched", () => {
    expect(clampFree(0.5, 0.5)).toEqual({ fx: 0.5, fy: 0.5 });
  });
  it("reaches the WHOLE screen — corners included (desktop)", () => {
    // 1920×1080: a button may sit 34px from any edge — not the old fat
    // 7%–90% / 14%–78% bands that fenced off most of the screen.
    expect(clampFree(0.001, 0.001, 1920, 1080).fx).toBeCloseTo(34 / 1920, 4);
    expect(clampFree(0.001, 0.001, 1920, 1080).fy).toBeCloseTo(34 / 1080, 4);
    expect(clampFree(0.999, 0.999, 1920, 1080).fx).toBeCloseTo(1 - 34 / 1920, 4);
    expect(clampFree(0.999, 0.999, 1920, 1080).fy).toBeCloseTo(1 - 34 / 1080, 4);
  });
  it("clamps drops so the button always stays fully visible", () => {
    // defaults are a 390×844 phone: 34px padding on each side
    expect(clampFree(-3, 0.5).fx).toBeCloseTo(34 / 390, 4);
    expect(clampFree(9, 0.5).fx).toBeCloseTo(1 - 34 / 390, 4);
    expect(clampFree(0.5, -1).fy).toBeCloseTo(34 / 844, 4);
    expect(clampFree(0.5, 99).fy).toBeCloseTo(1 - 34 / 844, 4);
    expect(clampFree(NaN, 0.5).fx).toBeCloseTo(34 / 390, 4);
  });
  it("stays sane on ultra-tiny viewports (never inverts)", () => {
    const c = clampFree(0.5, 0.5, 60, 60);
    expect(c.fx).toBeGreaterThanOrEqual(0);
    expect(c.fx).toBeLessThanOrEqual(1);
    expect(c.fy).toBeGreaterThanOrEqual(0);
    expect(c.fy).toBeLessThanOrEqual(1);
  });
});

describe("nearestSlotIndex", () => {
  it("finds the nearest slot center", () => {
    expect(nearestSlotIndex([100, 300, 500], 90)).toBe(0);
    expect(nearestSlotIndex([100, 300, 500], 320)).toBe(1);
    expect(nearestSlotIndex([100, 300, 500], 460)).toBe(2);
  });
  it("returns -1 with no slots", () => {
    expect(nearestSlotIndex([], 50)).toBe(-1);
  });
});

describe("previewDrop", () => {
  it("over dock: inserts the dragged item at the slot index", () => {
    const items = getLauncherLayout(); // dock: 0..4, drag index 2 (customers)
    const preview = previewDrop(items, "nav-customers", {
      overDock: true,
      dockIndex: 0,
      px: 200,
      py: 800,
      vw: 390,
      vh: 844,
    });
    const dock = preview.filter((i) => i.place === "dock");
    expect(dock[0].id).toBe("nav-customers");
    expect(dock.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5].slice(0, dock.length));
    expect(dock.length).toBe(5);
  });

  it("outside the dock: the item becomes floating at the pointer", () => {
    const items = getLauncherLayout();
    const preview = previewDrop(items, "nav-reps", {
      overDock: false,
      dockIndex: 3,
      px: 300,
      py: 200,
      vw: 400,
      vh: 1000,
    });
    const dragged = preview.find((i) => i.id === "nav-reps");
    expect(dragged?.place).toBe("free");
    expect(dragged?.fx).toBeCloseTo(0.75);
    expect(dragged?.fy).toBeCloseTo(0.2);
    // the dock now has 4 items and accounting is untouched
    expect(preview.filter((i) => i.place === "dock").length).toBe(4);
    expect(preview.find((i) => i.id === "acc-accounting")?.place).toBe("free");
  });

  it("clamps an off-screen drop so the button stays fully visible", () => {
    const items = getLauncherLayout();
    const preview = previewDrop(items, "nav-dashboard", {
      overDock: false,
      dockIndex: 0,
      px: -500,
      py: 5000,
      vw: 400,
      vh: 1000,
    });
    const dragged = preview.find((i) => i.id === "nav-dashboard");
    expect(dragged?.fx).toBeCloseTo(34 / 400, 4);
    expect(dragged?.fy).toBeCloseTo(1 - 34 / 1000, 4);
  });
  it("a drop deep in a corner lands 34px from the edges (fully visible, not fenced off)", () => {
    const items = getLauncherLayout();
    const preview = previewDrop(items, "nav-dashboard", {
      overDock: false,
      dockIndex: 0,
      px: 1,
      py: 1,
      vw: 1920,
      vh: 1080,
    });
    const dragged = preview.find((i) => i.id === "nav-dashboard");
    expect(dragged?.fx).toBeCloseTo(34 / 1920, 4);
    expect(dragged?.fy).toBeCloseTo(34 / 1080, 4);
  });
});

describe("commitDrag", () => {
  it("persists and emits pin_out when a dock item goes floating", () => {
    robotBus.reset();
    const seen: string[] = [];
    const off = robotBus.subscribe((e) => seen.push(e.type));
    const items = getLauncherLayout();
    const preview = previewDrop(items, "nav-lists", {
      overDock: false,
      dockIndex: 1,
      px: 100,
      py: 100,
      vw: 400,
      vh: 1000,
    });
    commitDrag(preview, "nav-lists", "dock", false, "لیست‌ها");
    expect(getLauncherLayout().find((i) => i.id === "nav-lists")?.place).toBe("free");
    expect(seen).toContain("app:layout_change");
    off();
    robotBus.reset();
  });
});
