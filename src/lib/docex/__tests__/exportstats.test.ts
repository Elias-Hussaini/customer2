import { describe, expect, it } from "vitest";
import { computeExportStats, exportStatsLine, type ExportColumn, type ExportRow } from "../../../utils/export/tabular";

const COLS: ExportColumn[] = [
  { key: "customer", header: "مشتری" },
  { key: "representative", header: "نماینده" },
  { key: "list", header: "لیست" },
  { key: "status", header: "وضعیت" },
];

function row(customer: string, rep: string, list: string, status: string): ExportRow {
  return { customer, representative: rep, list, status };
}

describe("computeExportStats — smart scope statistics", () => {
  it("all-representatives export: counts reps, lists, issued and in-progress", () => {
    const rows: ExportRow[] = [
      row("a", "علی رضایی", "لیست یک", "صادر شده"),
      row("b", "علی رضایی", "لیست یک", "در حال کار"),
      row("c", "مریم احمدی", "لیست دو", "صادر شده"),
      row("d", "مریم احمدی", "لیست دو", "صادر شده"),
      row("e", "مریم احمدی", "لیست سه", "در حال کار"),
    ];
    const s = computeExportStats(COLS, rows);
    expect(s.total).toBe(5);
    expect(s.representatives.length).toBe(2);
    expect(new Set(s.representatives)).toEqual(new Set(["مریم احمدی", "علی رضایی"]));
    expect(s.lists.length).toBe(3);
    expect(new Set(s.lists)).toEqual(new Set(["لیست یک", "لیست دو", "لیست سه"]));
    expect(s.issued).toBe(3);
    expect(s.inProgress).toBe(2);
    expect(s.hasStatus).toBe(true);
    expect(exportStatsLine(s)).toBe("۵ رکورد — ۲ نماینده — ۳ لیست — ۳ صادر شده — ۲ در حال کار");
  });

  it("single-representative export names the representative instead of counting", () => {
    const rows: ExportRow[] = [
      row("a", "علی رضایی", "لیست یک", "صادر شده"),
      row("b", "علی رضایی", "لیست یک", "در حال کار"),
    ];
    const s = computeExportStats(COLS, rows);
    expect(exportStatsLine(s)).toBe("۲ رکورد — نماینده: علی رضایی — ۱ صادر شده — ۱ در حال کار");
  });

  it("detects the status column by the header «وضعیت» even with a custom key", () => {
    const cols: ExportColumn[] = [
      { key: "customer", header: "مشتری" },
      { key: "zzz9", header: "وضعیت" },
    ];
    const s = computeExportStats(cols, [{ customer: "a", zzz9: "صادر شده" }]);
    expect(s.hasStatus).toBe(true);
    expect(s.issued).toBe(1);
  });

  it("a numeric «صادر شده» report column is NOT a status column", () => {
    const cols: ExportColumn[] = [
      { key: "representative", header: "نماینده" },
      { key: "issued", header: "صادر شده" },
    ];
    const s = computeExportStats(cols, [
      { representative: "علی رضایی", issued: 12 },
      { representative: "مریم احمدی", issued: 5 },
    ]);
    expect(s.hasStatus).toBe(false);
    expect(s.issued).toBe(0);
    expect(exportStatsLine(s)).toBe("۲ رکورد — ۲ نماینده");
  });

  it("counts rejected statuses and surfaces them in the line", () => {
    const rows: ExportRow[] = [
      row("a", "علی رضایی", "لیست", "صادر شده"),
      row("b", "علی رضایی", "لیست", "لغو شده"),
    ];
    const s = computeExportStats(COLS, rows);
    expect(s.rejected).toBe(1);
    expect(exportStatsLine(s)).toBe("۲ رکورد — نماینده: علی رضایی — ۱ صادر شده — ۰ در حال کار — ۱ لغو شده");
  });

  it("no representative column → scope line has no rep part", () => {
    const cols: ExportColumn[] = [{ key: "customer", header: "مشتری" }];
    const s = computeExportStats(cols, [{ customer: "a" }, { customer: "b" }]);
    expect(s.hasRepresentative).toBe(false);
    expect(exportStatsLine(s)).toBe("۲ رکورد");
  });
});
