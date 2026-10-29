/**
 * Reaction engine tests — the anti-repetition contract.
 *
 * The user's complaint: "کارهاش تکراری باشه" (its reactions are repetitive).
 * These tests pin the guarantees:
 *  1. A pool cycles through ALL its lines before any line repeats.
 *  2. The same line never appears twice in a row (even across refills).
 *  3. Probability gates are respected (with a controlled rng).
 *  4. Page-specific and query-aware pools are used where they should be.
 *  5. A direct tap always answers.
 */

import { describe, expect, it } from "vitest";
import { createReactionEngine } from "../reactions";
import type { RobotAppEvent } from "../types";

/** Deterministic LCG rng (seeded) — same sequence on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** rng that always lands in the "speak" range for probability < 1 (and < p). */
const always = () => 0.0;
/** rng that never speaks (p < 1) but draws index 0. */
const never = () => 0.999;

describe("createReactionEngine — anti-repetition", () => {
  it("a tap always returns a line", () => {
    const e = createReactionEngine(always);
    for (let i = 0; i < 10; i++) {
      const r = e.tap();
      expect(r.line).toBeTruthy();
      expect(r.ms).toBeGreaterThan(0);
    }
  });

  it("cycles the whole pool before repeating (saveDone, 60% gate → forced)", () => {
    // always() < 0.6 → every save event speaks
    const e = createReactionEngine(always);
    const seen: string[] = [];
    const event: RobotAppEvent = { type: "app:save_success" };
    for (let i = 0; i < 60; i++) seen.push(e.react(event).line ?? "");
    // every one of the 5 pool lines must appear in the first 5 draws
    const first5 = new Set(seen.slice(0, 5));
    expect(first5.size).toBe(5);
    // and no line repeats back-to-back across the whole run
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
    // the pool really cycles: with 5 lines over 60 draws every line comes
    // back many times (the alternating no-repeat refill skips one line per
    // cycle → worst-case item still appears ~7×).
    const counts = new Map<string, number>();
    seen.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
    expect([...counts.values()].every((c) => c >= 6)).toBe(true); // 60 draws / 5 lines
  });

  it("respects probability gates (silent robot)", () => {
    const e = createReactionEngine(never);
    // 0.999 ≥ every gate except tap (1.0) → app events stay silent
    expect(e.react({ type: "app:save_success" }).line).toBeUndefined();
    expect(e.react({ type: "app:save_error" }).line).toBeUndefined();
    expect(e.react({ type: "nav:change", to: "/" }).line).toBeUndefined();
    expect(e.react({ type: "app:theme_toggle", dark: true }).line).toBeUndefined();
  });

  it("uses the page-specific pool for the dashboard", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "nav:change", to: "/" });
    expect(r.line).toBeTruthy();
    expect(
      ["بریم ببینیم امروز چی‌پاشته!", "نمای کلی — من این صفحه را دوست دارم!"].some((l) => r.line === l),
    ).toBe(true);
  });

  it("uses the accounting pool inside /accounting", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "nav:change", to: "/accounting/parties" });
    expect(
      ["حسابداری! پول‌ها حواسشون جمع باشه…", "درآمد و خرج — من سبک‌تان می‌کنم!"].some(
        (l) => r.line === l,
      ),
    ).toBe(true);
  });

  it("echoes the search query sometimes", () => {
    const e = createReactionEngine(always); // always() < 0.45 too → query branch
    const r = e.react({ type: "app:search", query: "احمد" });
    expect(r.line).toContain("احمد");
  });

  it("falls back to the generic nav pool for other routes", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "nav:change", to: "/customers" });
    expect(r.line).toBeTruthy();
    // must NOT be one of the page-specific lines
    expect(r.line).not.toContain("داشبورد");
  });

  it("layout events label the dragged button", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "app:layout_change", what: "pin_out", label: "حسابداری" });
    expect(r.line).toContain("حسابداری");
  });

  it("random engine (Math.random) never repeats back-to-back over 300 draws", () => {
    const e = createReactionEngine();
    let prev = "";
    for (let i = 0; i < 300; i++) {
      const line = e.react({ type: "app:save_success", message: "x" }).line ?? "";
      if (line && prev) expect(line).not.toBe(prev);
      prev = line;
    }
  });

  it("seeded engine is deterministic", () => {
    const a = createReactionEngine(lcg(42));
    const b = createReactionEngine(lcg(42));
    for (let i = 0; i < 20; i++) {
      expect(a.tap().line).toBe(b.tap().line);
    }
  });

  it("long queries are truncated in the echo", () => {
    const e = createReactionEngine(always);
    const long = "علی محمد حسین رضا کریم جواد بهنام مهدی".repeat(5);
    const r = e.react({ type: "app:search", query: long });
    expect((r.line ?? "").length).toBeLessThan(60);
  });
});

describe("reaction engine — dedicated outcome pools", () => {
  it("export_done draws from the export pool, not the save pool", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "app:export_done" });
    const exportLines = new Set([
      "فایل رفت پی Downloads — دلم می‌خواست خودم بردم!",
      "خروجی گرفتم؛ مثل آب از صافی!",
      "دانلود شد؛ مرتب و خوشگل!",
      "یک فایل دیگر آماده — آرشیوت داره قشنگ میشه!",
    ]);
    expect(exportLines.has(r.line ?? "")).toBe(true);
    expect(r.line).not.toContain("دیتابیس"); // never a save line
  });

  it("import_done draws from the import pool", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "app:import_done" });
    const importLines = new Set([
      "همه‌چی برگشت سر جاش — نفس راحت!",
      "بازیابی شد؛ دیتاها خوشحالن!",
      "پشتیبان باز شد؛ مثل قدیمها شد!",
    ]);
    expect(importLines.has(r.line ?? "")).toBe(true);
  });

  it("report_generated draws from the report pool", () => {
    const e = createReactionEngine(always);
    const r = e.react({ type: "app:report_generated" });
    expect(r.line).toContain("گزارش");
  });

  it("export/import/report stay silent with the never-rng", () => {
    const e = createReactionEngine(never);
    expect(e.react({ type: "app:export_done" }).line).toBeUndefined();
    expect(e.react({ type: "app:import_done" }).line).toBeUndefined();
    expect(e.react({ type: "app:report_generated" }).line).toBeUndefined();
  });
});

describe("stateForEvent — new fun events", () => {
  it("theme_toggle → attentive, layout_change → success", async () => {
    const { RobotStateController, stateForEvent } = await import("../stateController");
    const c1 = new RobotStateController();
    stateForEvent({ type: "app:theme_toggle", dark: true }, c1);
    expect(c1.current).toBe("attentive");

    const c2 = new RobotStateController();
    stateForEvent({ type: "app:layout_change", what: "pin_out" }, c2);
    expect(c2.current).toBe("success");
  });
});
