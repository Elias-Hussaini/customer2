/**
 * Date-basis filtering tests — the from/to range must respect the chosen basis
 * (registration / issuance / rejection date). Covers the user-reported case:
 * "export visas issued today" — a range on the issuance date must match
 * requests whose registrationDate is far outside the range.
 */
import { describe, expect, it } from "vitest";
import {
  REQUEST_DATE_BASIS_OPTIONS,
  basisRangePlaceholders,
  isRequestDateBasis,
  quickDateRanges,
  requestBasisDate,
  requestBasisLabel,
  requestWithinRange,
} from "../requestDateFilter";
import type { VisaRequest } from "../../types";

const mk = (over: Partial<VisaRequest>): VisaRequest =>
  ({
    id: "r1",
    customerId: "c1",
    representativeId: null,
    listId: null,
    tags: [],
    registrationDate: "2026-01-01",
    issued: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as VisaRequest;

describe("requestBasisDate", () => {
  const r = mk({ registrationDate: "2026-01-01", issuedAt: "2026-02-10", rejectedAt: null });

  it("returns the matching date per basis", () => {
    expect(requestBasisDate(r, "registration")).toBe("2026-01-01");
    expect(requestBasisDate(r, "issued")).toBe("2026-02-10");
    expect(requestBasisDate(r, "rejected")).toBeNull();
  });

  it("treats missing optional dates as null", () => {
    const bare = mk({ issuedAt: null, rejectedAt: undefined });
    expect(requestBasisDate(bare, "issued")).toBeNull();
    expect(requestBasisDate(bare, "rejected")).toBeNull();
  });
});

describe("requestWithinRange", () => {
  const issuedToday = mk({ registrationDate: "2026-01-01", issued: true, issuedAt: "2026-10-28" });
  const issuedLastMonth = mk({ registrationDate: "2026-01-01", issued: true, issuedAt: "2026-09-15" });
  const pending = mk({ registrationDate: "2026-10-01", issued: false, issuedAt: null });
  const rejectedYesterday = mk({ registrationDate: "2026-01-01", rejected: true, rejectedAt: "2026-10-27" });

  it("matches only requests issued inside the range (user's core case)", () => {
    const f = (r: VisaRequest) => requestWithinRange(r, "issued", "2026-10-28", "2026-10-28");
    expect(f(issuedToday)).toBe(true);
    expect(f(issuedLastMonth)).toBe(false); // issued, but not today
    expect(f(pending)).toBe(false); // never issued → no basis date
  });

  it("ignores the range entirely when both bounds are empty", () => {
    expect(requestWithinRange(pending, "issued", null, null)).toBe(true);
    expect(requestWithinRange(issuedLastMonth, "issued", undefined, undefined)).toBe(true);
  });

  it("keeps the legacy registration-date behaviour as the default basis", () => {
    const f = (r: VisaRequest) => requestWithinRange(r, "registration", "2026-09-01", "2026-10-31");
    expect(f(pending)).toBe(true); // registered 2026-10-01, inside
    expect(f(issuedToday)).toBe(false); // registered 2026-01-01, outside
  });

  it("filters by rejection date on the rejected basis", () => {
    const f = (r: VisaRequest) => requestWithinRange(r, "rejected", "2026-10-27", "2026-10-27");
    expect(f(rejectedYesterday)).toBe(true);
    expect(f(issuedToday)).toBe(false); // not rejected → no basis date
    expect(f(pending)).toBe(false);
  });

  it("handles one-sided ranges", () => {
    expect(requestWithinRange(issuedLastMonth, "issued", "2026-10-01", null)).toBe(false);
    expect(requestWithinRange(issuedLastMonth, "issued", null, "2026-09-30")).toBe(true);
    expect(requestWithinRange(issuedLastMonth, "issued", null, "2026-09-01")).toBe(false);
  });
});

describe("basis metadata", () => {
  it("exposes exactly the three Persian options", () => {
    expect(REQUEST_DATE_BASIS_OPTIONS).toEqual([
      { value: "registration", label: "تاریخ ثبت" },
      { value: "issued", label: "تاریخ صدور" },
      { value: "rejected", label: "تاریخ رد" },
    ]);
  });

  it("validates persisted values", () => {
    expect(isRequestDateBasis("issued")).toBe(true);
    expect(isRequestDateBasis("bogus")).toBe(false);
    expect(isRequestDateBasis("")).toBe(false);
  });

  it("labels and placeholders reflect the basis", () => {
    expect(requestBasisLabel("issued")).toBe("تاریخ صدور");
    expect(basisRangePlaceholders("issued")).toEqual({ from: "از تاریخ صدور", to: "تا تاریخ صدور" });
    expect(basisRangePlaceholders("rejected")).toEqual({ from: "از تاریخ رد", to: "تا تاریخ رد" });
    expect(basisRangePlaceholders("registration")).toEqual({ from: "از تاریخ", to: "تا تاریخ" });
  });
});

describe("quickDateRanges", () => {
  it("builds ordered, non-empty ranges around today", () => {
    const ranges = quickDateRanges();
    expect(ranges.map((r) => r.key)).toEqual(["today", "yesterday", "d7", "d30"]);
    const [today, yesterday, d7, d30] = ranges;
    expect(today.from).toBe(today.to); // single day
    expect(yesterday.from).toBe(yesterday.to);
    expect(yesterday.to).not.toBe(today.to);
    expect(d7.from < d7.to).toBe(true);
    expect(d30.from < d30.to).toBe(true);
    expect(d30.from < d7.from).toBe(true); // wider window starts earlier
  });
});
