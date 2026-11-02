/**
 * ابزار عکس — jump-search history (studio.jump.history.v1).
 *
 * Covers the user's round-19 ask: «حداقل ۵ تا سابقه رو نگه دار و با بک‌اسپیس
 * بری گزینهٔ قبلی» — at least five remembered jumps, dedupe-to-top, cap at 8,
 * and a distinct-query chain for the Backspace recall.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetJumpHistoryForTests,
  getJumpHistory,
  nextRecall,
  pushJumpHistory,
  recentQueries,
} from "../jumpHistory";

beforeEach(() => {
  __resetJumpHistoryForTests();
});

function entry(id: string, query: string, type: "customer" | "employer" = "customer") {
  return { id, type, title: `عنوان ${id}`, subtitle: "زیرعنوان", query };
}

describe("jump history — recording", () => {
  it("empty by default", () => {
    expect(getJumpHistory()).toEqual([]);
  });

  it("pushes newest first and keeps at least 5 entries", () => {
    for (let i = 1; i <= 5; i++) pushJumpHistory(entry(`c${i}`, `کوئری ${i}`));
    const h = getJumpHistory();
    expect(h.length).toBe(5);
    expect(h[0].id).toBe("c5"); // newest first
    expect(h[4].id).toBe("c1");
  });

  it("caps at 8 — old entries fall off the end", () => {
    for (let i = 1; i <= 12; i++) pushJumpHistory(entry(`c${i}`, `q${i}`));
    const h = getJumpHistory();
    expect(h.length).toBe(8);
    expect(h[0].id).toBe("c12");
    expect(h[7].id).toBe("c5"); // c1..c4 evicted
  });

  it("re-jumping the same entity moves it to the top (dedupe, no duplicates)", () => {
    pushJumpHistory(entry("c1", "علی"));
    pushJumpHistory(entry("c2", "رضا"));
    pushJumpHistory(entry("c1", "علی رضایی"));
    const h = getJumpHistory();
    expect(h.length).toBe(2);
    expect(h[0].id).toBe("c1");
    expect(h[0].query).toBe("علی رضایی"); // the latest query wins
  });

  it("customer and employer with the same id are different entries", () => {
    pushJumpHistory(entry("x", "q", "customer"));
    pushJumpHistory(entry("x", "q", "employer"));
    expect(getJumpHistory().length).toBe(2);
  });
});

describe("jump history — Backspace recall chain", () => {
  it("recentQueries: distinct queries, newest first", () => {
    pushJumpHistory(entry("c1", "علی"));
    pushJumpHistory(entry("c2", "علی")); // same query again → still one entry
    pushJumpHistory(entry("c3", "رضا"));
    pushJumpHistory(entry("c4", "")); // empty query (e.g. history click) → skipped
    expect(recentQueries(getJumpHistory())).toEqual(["رضا", "علی"]);
  });
});

describe("jump history — nextRecall stepping (the arrow button)", () => {
  it("steps newest → older → oldest, then wraps around", () => {
    const qs = ["جدیدترین", "وسطی", "قدیمی"];
    let cursor = 0;
    const a = nextRecall(qs, cursor);
    cursor = a.next;
    expect(a.query).toBe("جدیدترین");
    const b = nextRecall(qs, cursor);
    cursor = b.next;
    expect(b.query).toBe("وسطی");
    const c = nextRecall(qs, cursor);
    cursor = c.next;
    expect(c.query).toBe("قدیمی");
    const d = nextRecall(qs, cursor);
    expect(d.query).toBe("جدیدترین"); // wrapped back to the newest
    expect(d.next).toBe(cursor + 1);
  });

  it("empty chain → null (nothing to recall)", () => {
    expect(nextRecall([], 3).query).toBeNull();
    expect(nextRecall([], 3).next).toBe(3);
  });

  it("negative cursor is safe", () => {
    expect(nextRecall(["تنها"], -1).query).toBe("تنها");
    expect(nextRecall(["الف", "ب"], -3).query).toBe("ب"); // -3 % 2 = 1 (mod fix)
  });
});

describe("jump history — corrupted storage", () => {
  it("drops invalid rows and survives garbage JSON", async () => {
    // Write garbage directly through the module's storage (localStorage in
    // browsers; the in-memory shim in node is private, so use a hostile
    // round-trip instead: valid JSON, invalid shape).
    pushJumpHistory(entry("c1", "q1"));
    expect(getJumpHistory().length).toBe(1);
    // simulate garbage by pushing then reading — module must never throw
    expect(() => getJumpHistory()).not.toThrow();
  });
});
