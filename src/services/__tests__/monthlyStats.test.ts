/**
 * Monthly statistics engine — Jalali month bucketing, aggregation, deltas.
 * Dates chosen to straddle the Jalali year boundary (اسفند ۱۴۰۴ → فروردین ۱۴۰۵).
 */

import { describe, expect, it } from "vitest";
import {
  aggregateMonthly,
  buildRecentMonths,
  compactMoney,
  isoToMonthKey,
  pctDelta,
  topIssuedMonths,
} from "../monthlyStats";

describe("isoToMonthKey", () => {
  it("buckets ISO dates into Jalali months", () => {
    expect(isoToMonthKey("2026-03-21")).toBe("1405-01"); // نوروز ۱۴۰۵
    expect(isoToMonthKey("2026-03-10")).toBe("1404-12"); // اسفند ۱۴۰۴
    expect(isoToMonthKey("2026-02-10")).toBe("1404-11"); // بهمن
    expect(isoToMonthKey("2025-10-23")).toBe("1404-08"); // آبان
  });

  it("rejects garbage", () => {
    expect(isoToMonthKey("")).toBeNull();
    expect(isoToMonthKey("not-a-date")).toBeNull();
    expect(isoToMonthKey(undefined)).toBeNull();
  });
});

describe("buildRecentMonths", () => {
  it("wraps the Jalali year correctly, oldest first", () => {
    // today = 1405-01-10 (2026-04-01) → 3 months: بهمن، اسفند ۱۴۰۴، فروردین ۱۴۰۵
    const months = buildRecentMonths(3, "2026-04-01");
    expect(months.map((m) => m.key)).toEqual(["1404-11", "1404-12", "1405-01"]);
    expect(months.map((m) => m.label)).toEqual(["بهمن", "اسفند", "فروردین"]);
  });

  it("starts a 12-month window on the right month", () => {
    const months = buildRecentMonths(12, "2025-10-23"); // آبان ۱۴۰۴
    expect(months).toHaveLength(12);
    expect(months[0].key).toBe("1403-09"); // آذر ۱۴۰۳
    expect(months[11].key).toBe("1404-08"); // آبان ۱۴۰۴ (current)
  });

  it("handles long spans across multiple years", () => {
    const months = buildRecentMonths(26, "2026-04-01");
    expect(months[0].key).toBe("1402-12"); // اسفند ۱۴۰۲
    expect(months[25].key).toBe("1405-01");
  });
});

describe("aggregateMonthly", () => {
  const months = buildRecentMonths(4, "2026-03-25"); // 1404-11 … 1405-01 (current)

  it("counts customers, requests, issued visas and documents per month", () => {
    const aggs = aggregateMonthly({
      months,
      customers: [
        { registrationDate: "2026-02-10" }, // بهمن ۱۴۰۴
        { registrationDate: "2026-02-11" }, // بهمن ۱۴۰۴
        { registrationDate: "2026-03-22" }, // فروردین ۱۴۰۵
        { registrationDate: "2024-01-01" }, // خارج از بازه
      ],
      requests: [
        { registrationDate: "2026-02-10", issued: true, issuedAt: "2026-03-23" },
        { registrationDate: "2026-02-12", issued: false, issuedAt: null },
        { registrationDate: "2026-02-14", issued: true, issuedAt: null }, // fallback: ماه ثبت (بهمن)
        { registrationDate: "2026-03-23", issued: true, issuedAt: null }, // fallback فروردین
      ],
      payments: [],
      attachmentDates: [new Date("2026-02-15T10:00:00").getTime()],
    });

    const byKey = Object.fromEntries(aggs.map((a) => [a.key, a]));
    expect(byKey["1404-11"].newCustomers).toBe(2);
    expect(byKey["1404-11"].newRequests).toBe(3);
    // issued: بهمن = صدور بدون تاریخ (fallback)، فروردین = issuedAt + fallback
    expect(byKey["1404-11"].issued).toBe(1);
    expect(byKey["1405-01"].issued).toBe(2);
    expect(byKey["1404-11"].newDocs).toBe(1);
    expect(byKey["1404-11"].rejected).toBe(0);
    expect(byKey["1404-12"].newCustomers).toBe(0);
  });

  it("buckets rejections by rejectedAt with registration-month fallback", () => {
    const aggs = aggregateMonthly({
      months,
      customers: [],
      requests: [
        // رد شده در اسفند، ثبت در بهمن → به اسفند می‌رود
        { registrationDate: "2026-02-10", issued: false, issuedAt: null, rejected: true, rejectedAt: "2026-03-10" },
        // رد شده بدون تاریخ رد → ماه ثبت (بهمن)
        { registrationDate: "2026-02-12", issued: false, issuedAt: null, rejected: true, rejectedAt: null },
        // ثبت در بهمن، رد در فروردین
        { registrationDate: "2026-02-14", issued: false, issuedAt: null, rejected: true, rejectedAt: "2026-03-24" },
        // قدیمی‌ها بدون فیلد rejected → هیچ سهمی ندارند
        { registrationDate: "2026-02-15", issued: false, issuedAt: null },
        // issued و rejected هردو روشن (حالت نامعتبر) → شمرده نمی‌شود
        { registrationDate: "2026-02-16", issued: true, issuedAt: "2026-03-25", rejected: true, rejectedAt: "2026-03-25" },
      ],
      payments: [],
      attachmentDates: [],
    });
    const byKey = Object.fromEntries(aggs.map((a) => [a.key, a]));
    expect(byKey["1404-11"].rejected).toBe(1); // فقط fallback بهمن
    expect(byKey["1404-12"].rejected).toBe(1); // rejectedAt اسفند
    expect(byKey["1405-01"].rejected).toBe(1); // rejectedAt فروردین
  });

  it("sums money per currency without mixing", () => {
    const aggs = aggregateMonthly({
      months,
      customers: [],
      requests: [],
      payments: [
        { date: "2026-02-10", amount: 100.5, currency: "USD" },
        { date: "2026-02-11", amount: 50.25, currency: "USD" },
        { date: "2026-02-12", amount: 5_000_000, currency: "IRT" },
        { date: "2026-03-22", amount: 2_000_000, currency: "IRT" },
        { date: "2025-01-01", amount: 999, currency: "USD" }, // خارج از بازه
      ],
      attachmentDates: [],
    });
    const byKey = Object.fromEntries(aggs.map((a) => [a.key, a]));
    expect(byKey["1404-11"].paidUSD).toBe(150.75);
    expect(byKey["1404-11"].paidIRT).toBe(5_000_000);
    expect(byKey["1405-01"].paidIRT).toBe(2_000_000);
    expect(byKey["1405-01"].paidUSD).toBe(0);
  });

  it("is safe with floating point dollar sums", () => {
    const aggs = aggregateMonthly({
      months,
      customers: [],
      requests: [],
      payments: Array.from({ length: 3 }, () => ({
        date: "2026-02-10",
        amount: 0.1,
        currency: "USD" as const,
      })),
      attachmentDates: [],
    });
    expect(aggs.find((a) => a.key === "1404-11")?.paidUSD).toBe(0.3);
  });
});

describe("pctDelta", () => {
  it("computes percentage change and null without a baseline", () => {
    expect(pctDelta(120, 100)).toBeCloseTo(20);
    expect(pctDelta(80, 100)).toBeCloseTo(-20);
    expect(pctDelta(5, 0)).toBeNull();
  });
});

describe("compactMoney", () => {
  it("formats compact Persian labels", () => {
    expect(compactMoney(2_500_000, "IRT")).toContain("۲");
    expect(compactMoney(2_500_000, "IRT")).toContain("M");
    expect(compactMoney(850_000, "USD")).toContain("$");
    expect(compactMoney(9_500, "IRT")).toContain("۹");
  });
});

describe("topIssuedMonths", () => {
  it("ranks months by issued count, ties broken by older first", () => {
    const mk = (key: string, issued: number) => ({
      key,
      label: key,
      fullLabel: key,
      newCustomers: 0,
      newRequests: 0,
      issued,
      rejected: 0,
      newDocs: 0,
      paidUSD: 0,
      paidIRT: 0,
    });
    const top = topIssuedMonths(
      [mk("1404-05", 3), mk("1404-08", 9), mk("1404-02", 9), mk("1404-09", 0), mk("1404-06", 1)],
      3,
    );
    expect(top.map((t) => t.key)).toEqual(["1404-02", "1404-08", "1404-05"]);
  });
});
