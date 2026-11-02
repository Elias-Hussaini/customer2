/**
 * fieldHistory — the per-field typed-value history behind the recall arrow
 * that now lives in EVERY search field («هر وقت وارد فیلدی میشی بیاد و
 * برگرده عقب»).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFieldHistoryForTests,
  getFieldHistory,
  pushFieldHistory,
} from "../fieldHistory";

beforeEach(() => {
  __resetFieldHistoryForTests();
});

describe("field history", () => {
  it("starts empty and records trimmed values newest-first", () => {
    expect(getFieldHistory("customers")).toEqual([]);
    pushFieldHistory("customers", "  احمدی  ");
    pushFieldHistory("customers", "کریمی");
    expect(getFieldHistory("customers")).toEqual(["کریمی", "احمدی"]);
  });

  it("ignores empty values", () => {
    pushFieldHistory("x", "یک");
    pushFieldHistory("x", "   ");
    pushFieldHistory("x", "");
    expect(getFieldHistory("x")).toEqual(["یک"]);
  });

  it("dedupes: the same value moves to the top instead of repeating", () => {
    pushFieldHistory("x", "الف");
    pushFieldHistory("x", "ب");
    pushFieldHistory("x", "ج");
    pushFieldHistory("x", "الف");
    expect(getFieldHistory("x")).toEqual(["الف", "ج", "ب"]);
  });

  it("caps each field at 8 entries", () => {
    for (let i = 1; i <= 12; i++) pushFieldHistory("x", `مقدار ${i}`);
    const h = getFieldHistory("x");
    expect(h.length).toBe(8);
    expect(h[0]).toBe("مقدار 12");
    expect(h[7]).toBe("مقدار 5");
  });

  it("keeps fields independent", () => {
    pushFieldHistory("customers", "احمدی");
    pushFieldHistory("employers", "شرکت الف");
    expect(getFieldHistory("customers")).toEqual(["احمدی"]);
    expect(getFieldHistory("employers")).toEqual(["شرکت الف"]);
  });

  it("prunes the least-recently-used fields beyond 16", () => {
    for (let i = 0; i < 18; i++) {
      pushFieldHistory(`field-${i}`, `v${i}`);
    }
    // fields 0 and 1 were pushed first and never touched again → pruned
    expect(getFieldHistory("field-0")).toEqual([]);
    expect(getFieldHistory("field-1")).toEqual([]);
    expect(getFieldHistory("field-17")).toEqual(["v17"]);
  });

  it("survives corrupted storage gracefully", () => {
    const mem = new Map<string, string>([["app.field.history.v1", "{not json"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    expect(getFieldHistory("x")).toEqual([]);
    pushFieldHistory("x", "سالم");
    expect(getFieldHistory("x")).toEqual(["سالم"]);
    vi.unstubAllGlobals();
    __resetFieldHistoryForTests();
  });

  it("drops corrupted entries inside an otherwise valid store", () => {
    const mem = new Map<string, string>([
      [
        "app.field.history.v1",
        JSON.stringify({
          good: { v: ["الف"], at: 1 },
          bad: { v: "not-an-array", at: 2 },
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    expect(getFieldHistory("good")).toEqual(["الف"]);
    expect(getFieldHistory("bad")).toEqual([]);
    vi.unstubAllGlobals();
    __resetFieldHistoryForTests();
  });
});
