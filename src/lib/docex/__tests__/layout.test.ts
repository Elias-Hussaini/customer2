/**
 * Two-column layout extraction, multi-date handling, smart issue-date
 * fallback and TD3 optional-data issue dates. All fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  extractByLabels,
  extractByLayout,
  findDateCandidates,
  disambiguateIssueDate,
  PASSPORT_PROFILE,
} from "../text";
import { parseMrzFromText, checkDigit } from "../mrz";

const LAYOUT_ROWS = (
  rows: [number, ...string[]][],
) =>
  rows.map(([y, ...parts]) => ({
    y,
    parts: parts.map((s, i) => ({ x: 40 + i * 130, s })),
  }));

describe("extractByLabels — two-column data pages (plain text)", () => {
  it("does not mistake the neighboring label for a value", () => {
    const page = [
      "REPUBLIC OF AFGHANISTAN — PASSPORT",
      "Surname KARIMI",
      "Given Names NOOR MOHAMMAD",
      "Date of issue Date of expiry",
      "15 MAR 2022 15 MAR 2027",
    ].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "pdf_text");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
    // Value came from the following line → conservatively flagged for review.
    expect(f.dateOfIssue?.status).toBe("needs_review");
    expect(f.dateOfExpiry?.value).toBe("2027-03-15");
  });

  it("pairs two same-row dates with their labels by column order", () => {
    const page = "Date of issue 15 MAR 2022 Date of expiry 15 MAR 2027";
    const f = extractByLabels(page, PASSPORT_PROFILE, "pdf_text");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
    expect(f.dateOfExpiry?.value).toBe("2027-03-15");
  });

  it("keeps the classic single-label lines working", () => {
    const page = ["Surname KARIMI", "Date of birth 10 MAR 1997"].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "pdf_text");
    expect(f.surname?.value).toBe("KARIMI");
    expect(f.dateOfBirth?.value).toBe("1997-03-10");
    expect(f.dateOfBirth?.status).toBe("confirmed");
  });
});

describe("extractByLayout — x-position column pairing", () => {
  it("pairs label/value columns on one row", () => {
    const rows = LAYOUT_ROWS([
      [300, "Date of issue", "15 MAR 2022", "Date of expiry", "15 MAR 2027"],
    ]);
    const f = extractByLayout(rows, PASSPORT_PROFILE, "pdf_text");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
    expect(f.dateOfIssue?.status).toBe("confirmed");
    expect(f.dateOfExpiry?.value).toBe("2027-03-15");
  });

  it("pairs a stacked labels-row with the values-row below", () => {
    const rows = [
      { y: 300, parts: [
        { x: 40, s: "Date of issue" },
        { x: 300, s: "Date of expiry" },
      ] },
      { y: 280, parts: [
        { x: 45, s: "15 MAR 2022" },
        { x: 305, s: "15 MAR 2027" },
      ] },
    ];
    const f = extractByLayout(rows, PASSPORT_PROFILE, "pdf_text");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
    expect(f.dateOfExpiry?.value).toBe("2027-03-15");
  });

  it("extracts a two-column mixed grid (birth + place, sex + issue)", () => {
    const rows = [
      { y: 300, parts: [
        { x: 40, s: "Date of birth" },
        { x: 60, s: "01 JAN 1990" },
        { x: 300, s: "Place of birth" },
        { x: 330, s: "KABUL" },
      ] },
      { y: 270, parts: [
        { x: 40, s: "Sex" },
        { x: 60, s: "M" },
        { x: 300, s: "Date of issue" },
        { x: 330, s: "15 MAR 2022" },
      ] },
    ];
    const f = extractByLayout(rows, PASSPORT_PROFILE, "pdf_text");
    expect(f.dateOfBirth?.value).toBe("1990-01-01");
    expect(f.placeOfBirth?.value).toBe("KABUL");
    expect(f.sex?.value).toBe("M");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
  });

  it("skips rows without labels (MRZ lines etc.)", () => {
    const rows = [
      { y: 300, parts: [{ x: 40, s: "P<AFGKARIMI<<NOOR<MOHAMMAD<<<<<<<<<<<<<<<<<<<<" }] },
      { y: 285, parts: [{ x: 40, s: "PA1990345<8AFG9001012M2703159<<<<<<<<<<<<<<06" }] },
    ];
    const f = extractByLayout(rows, PASSPORT_PROFILE, "pdf_text");
    expect(Object.keys(f).length).toBe(0);
  });
});

describe("findDateCandidates", () => {
  it("finds multiple date tokens in free text", () => {
    const cands = findDateCandidates("Issued 15 MAR 2022 and expires 15/03/2027, born 1990-01-01");
    const isos = cands.map((c) => c.iso);
    expect(isos).toContain("2022-03-15");
    expect(isos).toContain("2027-03-15");
    expect(isos).toContain("1990-01-01");
  });

  it("finds Persian-digit Dari dates", () => {
    const cands = findDateCandidates("تاریخ صدور ۱۵ مارچ ۲۰۲۲");
    expect(cands.some((c) => c.iso === "2022-03-15")).toBe(true);
  });
});

describe("disambiguateIssueDate", () => {
  const birth = "1990-01-01";
  const expiry = "2027-03-15";

  it("returns the only candidate between birth and expiry (strong)", () => {
    const cands = [
      { iso: "1990-01-01", raw: "1990-01-01" }, // birth itself — excluded
      { iso: "2022-03-15", raw: "15 MAR 2022" },
      { iso: "2027-03-15", raw: "2027-03-15" }, // expiry itself — excluded
    ];
    expect(disambiguateIssueDate(cands, birth, expiry)).toEqual({ iso: "2022-03-15", strong: true });
  });

  it("prefers the 5/10-year validity match among several candidates", () => {
    const cands = [
      { iso: "2015-06-01", raw: "" },
      { iso: "2019-03-15", raw: "" }, // expiry − ~8y
      { iso: "2022-03-15", raw: "" }, // expiry − 5y ✓
    ];
    expect(disambiguateIssueDate(cands, birth, expiry)).toEqual({ iso: "2022-03-15", strong: true });
  });

  it("flags a shaky guess (several plausible candidates) as weak", () => {
    // None of these sits exactly 5/10 years before the expiry date.
    const cands = [
      { iso: "2021-06-01", raw: "" },
      { iso: "2022-11-20", raw: "" },
      { iso: "2023-01-05", raw: "" },
    ];
    const pick = disambiguateIssueDate(cands, birth, expiry);
    expect(pick?.strong).toBe(false);
    expect(pick?.iso).toBe("2023-01-05"); // latest before expiry
  });

  it("returns null when nothing fits", () => {
    const cands = [{ iso: "1980-01-01", raw: "" }];
    expect(disambiguateIssueDate(cands, birth, expiry)).toBeNull();
  });
});

describe("TD3 optional-data issue date", () => {
  /** Build a spec-correct TD3 MRZ line 2 with real check digits. */
  const mrzText = (optField: string) => {
    const doc = "PA1990345";
    const dob = "900101";
    const exp = "270315";
    const opt = optField + "<".repeat(Math.max(0, 14 - optField.length));
    const s =
      doc +
      checkDigit(doc) +
      "AFG" +
      dob +
      checkDigit(dob) +
      "M" +
      exp +
      checkDigit(exp) +
      opt +
      checkDigit(opt);
    const composite = checkDigit(
      doc + checkDigit(doc) + dob + checkDigit(dob) + exp + checkDigit(exp) + opt + checkDigit(opt),
    )!;
    return ["P<AFGKARIMI<<NOOR<MOHAMMAD<<<<<<<<<<<<<<<<<<<<<<", (s + composite).slice(0, 44)].join("\n");
  };

  it("reads the issue date when the optional field is a validated YYMMDD", () => {
    // Optional data = issue date 220315, birth 900101, expiry 270315.
    const hit = parseMrzFromText(mrzText("220315"));
    expect(hit).not.toBeNull();
    expect(hit!.fields.dateOfIssue?.value).toBe("2022-03-15");
    expect(hit!.fields.dateOfIssue?.status).toBe("needs_review");
  });

  it("does NOT read a personal number as an issue date", () => {
    // 8-digit personal number (not 6) → not an issue date.
    const hit = parseMrzFromText(mrzText("14010101"));
    expect(hit).not.toBeNull();
    expect(hit!.fields.dateOfIssue).toBeUndefined();
  });

  it("ignores an out-of-range date in the optional field", () => {
    // yy=28 infers to 1928 (issue dates are within the last ~15 years) →
    // before birth 1990-01-01 → rejected.
    const hit = parseMrzFromText(mrzText("280115"));
    expect(hit).not.toBeNull();
    expect(hit!.fields.dateOfIssue).toBeUndefined();
  });
});
