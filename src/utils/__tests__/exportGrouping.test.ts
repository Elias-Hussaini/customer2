import { describe, expect, it } from "vitest";
import {
  flattenGroups,
  groupExportRows,
  groupLabel,
  type ExportRow,
} from "../export/tabular";

describe("groupExportRows", () => {
  const rows: ExportRow[] = [
    { representative: "بهرام", customer: "C1" },
    { representative: "آریا", customer: "C2" },
    { representative: "بهرام", customer: "C3" },
    { representative: "", customer: "C4" },
    { representative: "آریا", customer: "C5" },
  ];

  it("groups by the column value, Persian-locale ordered (آ before ب)", () => {
    const groups = groupExportRows(rows, "representative");
    expect(groups.map((g) => g.value)).toEqual(["آریا", "بهرام", ""]);
  });

  it("keeps the natural row order inside every group", () => {
    const groups = groupExportRows(rows, "representative");
    expect(groups[0].rows.map((r) => r.customer)).toEqual(["C2", "C5"]);
    expect(groups[1].rows.map((r) => r.customer)).toEqual(["C1", "C3"]);
    expect(groups[2].rows.map((r) => r.customer)).toEqual(["C4"]);
  });

  it("returns one group for uniform values (single-rep export)", () => {
    const groups = groupExportRows(
      [
        { representative: "آریا", customer: "C1" },
        { representative: "آریا", customer: "C2" },
      ],
      "representative",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe("آریا");
    expect(groups[0].rows).toHaveLength(2);
  });

  it("handles null/undefined cells as the empty group", () => {
    const groups = groupExportRows(
      [
        { representative: null, customer: "C1" },
        { representative: undefined, customer: "C2" },
        { representative: "آریا", customer: "C3" },
      ],
      "representative",
    );
    expect(groups.map((g) => g.value)).toEqual(["آریا", ""]);
    expect(groups[1].rows).toHaveLength(2);
  });

  it("trims whitespace when keying groups", () => {
    const groups = groupExportRows(
      [
        { representative: "آریا", customer: "C1" },
        { representative: " آریا ", customer: "C2" },
      ],
      "representative",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("works with a missing column (everything in the empty group)", () => {
    const groups = groupExportRows([{ customer: "C1" }, { customer: "C2" }], "representative");
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe("");
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe("flattenGroups", () => {
  it("round-trips: flatten(group(rows)) contains exactly the same rows", () => {
    const rows: ExportRow[] = [
      { representative: "بهرام", customer: "C1" },
      { representative: "آریا", customer: "C2" },
      { representative: "بهرام", customer: "C3" },
      { representative: "", customer: "C4" },
    ];
    const flat = flattenGroups(groupExportRows(rows, "representative"));
    expect(flat).toHaveLength(rows.length);
    // Same multiset of customers — grouped order, nothing lost or duplicated.
    const byCustomer = new Set(flat.map((r) => r.customer));
    expect(byCustomer).toEqual(new Set(["C1", "C2", "C3", "C4"]));
  });

  it("emits groups one-after-another (section order, not interleaved)", () => {
    const rows: ExportRow[] = [
      { representative: "ب", i: 1 },
      { representative: "ا", i: 2 },
      { representative: "ب", i: 3 },
      { representative: "ا", i: 4 },
    ];
    const flat = flattenGroups(groupExportRows(rows, "representative"));
    expect(flat.map((r) => r.representative)).toEqual(["ا", "ا", "ب", "ب"]);
    expect(flat.map((r) => r.i)).toEqual([2, 4, 1, 3]);
  });
});

describe("groupLabel", () => {
  it("returns the value itself when non-empty", () => {
    expect(groupLabel("آریا", "نماینده")).toBe("آریا");
  });

  it("returns «بدون …» for empty values", () => {
    expect(groupLabel("", "نماینده")).toBe("بدون نماینده");
    expect(groupLabel("   ", "نماینده")).toBe("بدون نماینده");
  });
});
