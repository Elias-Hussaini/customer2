/**
 * Regression suite for real-scan OCR pathologies (from an actual Afghan
 * passport + e-Tazkira scan): MRZ name-field garble, stacked label/value
 * layouts, compound Persian labels, multi-token doc numbers and fuzzy
 * month names. All fixtures are synthetic reconstructions of real misreads.
 */
import { describe, expect, it } from "vitest";
import { parseMrzFromText, repairNameField } from "../mrz";
import { extractByLabels, findDateCandidates, inferIssueDateFromYears, PASSPORT_PROFILE, TAZKIRA_PROFILE } from "../text";
import { parsePrintedDate } from "../dates";
import { latinNameToFa } from "../translit";

describe("repairNameField — MRZ structural repair", () => {
  it("repairs a misread separator (AHMADI<K<NOOR → AHMADI<<NOOR)", () => {
    const { field, dropped } = repairNameField("AHMADI<K<NOOR<MOHAMMAD<<<KLKL<<<<<<<<<<");
    expect(field.startsWith("AHMADI<<")).toBe(true); // separator reconstructed
    expect(field.includes("KLKL")).toBe(false); // garble cluster dropped
    expect(field.includes("NOOR")).toBe(true);
    expect(field.includes("MOHAMMAD")).toBe(true);
    expect(dropped).toBe(true);
  });
  it("keeps vowel initials between fillers (<A< is a real initial)", () => {
    const { field } = repairNameField("SMITH<<A<MICHAEL<<<<");
    expect(field).toBe("SMITH<<A<MICHAEL<<<<");
  });
  it("keeps digit tokens (optional data is never garble)", () => {
    const { field } = repairNameField("240315<<<<<<<<<<KK<<<<");
    expect(field.startsWith("240315")).toBe(true);
    expect(field.includes("KK")).toBe(false);
  });
  it("a garble-only name field collapses to pure filler (no name)", () => {
    expect(repairNameField("<<<KLKLKLL<<<<").field.includes("KLKLKLL")).toBe(false);
  });
});

describe("parseMrzFromText — the real misread passport MRZ", () => {
  // Exact reconstruction of the OCR output from the user's 5-page scan:
  // separators misread as K, filler runs misread as KLKL.
  const L1 = "P<AFGAHMADI<K<NOOR<MOHAMMAD <<< KLKL";
  const L2 = "P094078430AFG9703108M3005316<<<<<<<<<<KK<<<06";
  it("recovers NOOR MOHAMMAD / AHMADI — no کلکل, no swap", () => {
    const res = parseMrzFromText([L1, L2].join("\n"));
    expect(res).not.toBeNull();
    expect(res!.fields.surname?.value).toBe("AHMADI");
    expect(res!.fields.givenNames?.value).toBe("NOOR MOHAMMAD");
    expect(res!.fields.dateOfBirth?.value).toBe("1997-03-10");
    expect(res!.fields.dateOfExpiry?.value).toBe("2030-05-31");
    // garble was dropped → flagged for review, never silently confirmed
    expect(res!.fields.surname?.status).toBe("needs_review");
  });
  it("never emits a vowel-less garble token as a name", () => {
    const res = parseMrzFromText(["P<UTOKLKL<<KLKL<<<<", "AB12345671UTO9001011M3001019<<<<<<<<<<<<<<04"].join("\n"));
    expect(res?.fields.givenNames?.value ?? "").not.toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ]+$/);
  });
  it("Persian rendering of the recovered name is exactly نور محمد / احمدی", () => {
    const res = parseMrzFromText([L1, L2].join("\n"));
    expect(latinNameToFa(String(res!.fields.givenNames!.value))).toBe("نور محمد");
    expect(latinNameToFa(String(res!.fields.surname!.value))).toBe("احمدی");
  });
});

describe("stacked label/value layouts (the real passport data page)", () => {
  it("reads the issue date from the line BELOW its label", () => {
    const page = [
      "3 : 3 J] ) Date of Issue 5 5 r 29he pss",
      "we x 31 MAY 2025 1404 l> 10",
    ].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBe("2025-05-31");
    expect(f.dateOfIssue?.status).toBe("needs_review"); // stacked → honest review flag
  });
  it("parses a fuzzy month name (BAY → MAY) on the expiry line", () => {
    const page = ["hi Date of Expiry bo 0 Eble sl", "A 31 BAY-2030 ghia 1409 l3> 10"].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfExpiry?.value).toBe("2030-05-31");
  });
  it("prefers the strong name on the next line over same-line OCR noise", () => {
    const page = ["Given Names hE X % pL pg", "NOOR MOHAMMAD CL dame"].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.givenNames?.value).toBe("NOOR MOHAMMAD DAME");
  });
  it("falls through to the next line for the ID number when the same line is junk", () => {
    const page = ["1D No. SF lad | 45 (5505 5 LN", "| 1403-0302-55358 x aa"].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.nationalId?.value).toBe("1403-0302-55358");
  });
  it("salvages the clean place-of-birth token from a noisy stacked value", () => {
    const page = ["REN Place of Birth", "J C270 Daykundi 10/03/1997 pW"].join("\n");
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.placeOfBirth?.value).toBe("DAYKUNDI");
  });
});

describe("compound Persian labels never steal each other's value", () => {
  it("نام does not eat نام خانوادگی's value (the swap bug)", () => {
    const page = ["نام خانوادگی: احمدی", "نام: نور محمد", "نام پدر: محمد"].join("\n");
    const f = extractByLabels(page, TAZKIRA_PROFILE, "ocr_printed");
    expect(f.surname?.value).toBe("احمدی");
    expect(f.givenNames?.value).toBe("نور محمد");
    expect(f.fatherName?.value).toBe("محمد");
  });
  it("a name value containing a label word is rejected outright", () => {
    const f = extractByLabels("نام خانوادگی: احمدی\nتاریخ تولد ۱۳۷۵/۱۲/۱۹", TAZKIRA_PROFILE, "ocr_printed");
    expect(String(f.givenNames?.value ?? "")).not.toContain("خانوادگی");
  });
});

describe("fuzzy month lookup + loose date scanning", () => {
  it("parses BAY as MAY (unique edit-distance-1 month)", () => {
    expect(parsePrintedDate("31 BAY 2030")).toBe("2030-05-31");
  });
  it("rejects ambiguous month noise", () => {
    expect(parsePrintedDate("10 KABUL 2025")).toBeNull();
  });
  it("finds dashed month-year tokens in free text", () => {
    const cands = findDateCandidates("A 31 BAY-2030 ghia 1409 l3> 10");
    expect(cands.map((c) => c.iso)).toContain("2030-05-31");
  });
});

describe("year-anchored issue-date recovery (mangled date print)", () => {
  // The exact shape the browser rasterizer produced from the real passport:
  // the date itself is OCR-destroyed, but the printed YEARS survive.
  it("rebuilds the issue date from the printed year + validated expiry", () => {
    const page = [
      "FA Date of Issue I - 290 61 6 jue 0",
      'Lana I\\" 37°WAv. 2025 1404 ljg> 10',
      "» Date of Expiry oe A wb] Ga Shs",
      "Ww. STONY 2030 oe 1409 Lg> 10",
    ].join("\n");
    const inf = inferIssueDateFromYears(page, "2030-05-31");
    expect(inf).toEqual({ iso: "2025-05-31", strong: true });
  });
  it("uses the Jalali year printed beside the Gregorian one", () => {
    const page = ["تاریخ صدور", "۱۰ جوزا ۱۴۰۴"].join("\n");
    expect(inferIssueDateFromYears(page, "2030-05-31")?.iso).toBe("2025-05-31");
  });
  it("ignores the expiry/birth years (validity must be 1..10 years)", () => {
    const page = ["Date of issue 2030", "Date of birth 1997"].join("\n");
    expect(inferIssueDateFromYears(page, "2030-05-31")).toBeNull();
  });
  it("returns null when no issue label exists", () => {
    expect(inferIssueDateFromYears("nothing here at all 2025", "2030-05-31")).toBeNull();
  });
});
