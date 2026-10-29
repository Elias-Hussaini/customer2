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
  it("clamps into the safe viewport margins", () => {
    expect(clampFree(-3, 0.5).fx).toBeCloseTo(0.07);
    expect(clampFree(9, 0.5).fx).toBeCloseTo(0.9);
    expect(clampFree(0.5, -1).fy).toBeCloseTo(0.14);
    expect(clampFree(0.5, 99).fy).toBeCloseTo(0.78);
    expect(clampFree(NaN, 0.5).fx).toBeCloseTo(0.07);
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

  it("clamps an off-screen drop back into the safe area", () => {
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
    expect(dragged?.fx).toBeCloseTo(0.07);
    expect(dragged?.fy).toBeCloseTo(0.78);
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
