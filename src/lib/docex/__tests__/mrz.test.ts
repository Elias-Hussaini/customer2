/**
 * MRZ parsing & check-digit tests (ICAO Doc 9303).
 * All fixtures are synthetic — fabricated identity data only.
 */
import { describe, expect, it } from "vitest";
import { checkDigit, cleanMrzLine, parseMrzFromText, parseMrzName } from "../mrz";

// Synthetic TD3 (passport) — check digits computed with the 7-3-1 algorithm.
// doc AB1234567→1, dob 900101→1, exp 300101→9, optional(all <)→0,
// composite (pos 44, over 1–10/14–20/22–43) → 4
const TD3_L1 = ("P<UTO" + "SPECIMEN<<FAKE<TEST" + "<".repeat(20)).slice(0, 44);
const TD3_L2 = "AB12345671UTO9001011M3001019<<<<<<<<<<<<<<04";

describe("checkDigit (7-3-1)", () => {
  it("computes the ICAO example", () => {
    expect(checkDigit("520727")).toBe(3);
  });
  it("computes doc-number digit for the fixture", () => {
    expect(checkDigit("AB1234567")).toBe(1);
    expect(checkDigit("900101")).toBe(1);
    expect(checkDigit("300101")).toBe(9);
  });
  it("returns 0 for all-fillers", () => {
    expect(checkDigit("<<<<")).toBe(0);
  });
  it("rejects invalid chars", () => {
    expect(checkDigit("AB12-456")).toBeNull();
  });
});

describe("cleanMrzLine", () => {
  it("strips spaces and maps stray letters in filler runs", () => {
    expect(cleanMrzLine("P<UTO SPECIMEN<<FAKE<<K<<<")).toBe("P<UTOSPECIMEN<<FAKE<<<<<<");
  });
  it("uppercases and drops punctuation", () => {
    expect(cleanMrzLine("ab12<cd")).toBe("AB12<CD");
  });
});

describe("parseMrzName", () => {
  it("splits surname and given names", () => {
    expect(parseMrzName("AHMADI<<NOOR<MOHAMMAD<<<<<<")).toEqual({
      surname: "AHMADI",
      givenNames: "NOOR MOHAMMAD",
    });
  });
  it("handles surname-only", () => {
    expect(parseMrzName("SINGLENAME<<<<<<<<<<<<")).toEqual({
      surname: "SINGLENAME",
      givenNames: "",
    });
  });
  it("drops OCR filler garbage (vowel-less K/L/C clusters)", () => {
    expect(parseMrzName("AHMADI<<NOOR<MOHAMMAD<LLLCLLLLLKLKL")).toEqual({
      surname: "AHMADI",
      givenNames: "NOOR MOHAMMAD",
    });
    expect(parseMrzName("AHMADI<<NOOR<MOHAMMAD<<<<K")!.surname).toBe("AHMADI");
  });
});

describe("parseMrzFromText — TD3 passport", () => {
  it("parses a clean synthetic passport (all check digits incl. composite)", () => {
    const res = parseMrzFromText(["PASSPORT", TD3_L1, TD3_L2].join("\n"));
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("passport");
    expect(res!.mrz.format).toBe("TD3");
    expect(res!.fields.surname?.value).toBe("SPECIMEN");
    expect(res!.fields.givenNames?.value).toBe("FAKE TEST");
    expect(res!.fields.documentNumber?.value).toBe("AB1234567");
    expect(res!.fields.issuingCountry?.value).toBe("UTO");
    expect(res!.fields.nationality?.value).toBe("UTO");
    expect(res!.fields.sex?.value).toBe("M");
    expect(res!.fields.dateOfBirth?.value).toBe("1990-01-01");
    expect(res!.fields.dateOfExpiry?.value).toBe("2030-01-01");
    expect(res!.mrz.allValid).toBe(true);
  });

  it("repairs OCR noise in filler runs", () => {
    const noisy = TD3_L1.replace(/<{5}/, "K<<K<") + "\n" + TD3_L2;
    const res = parseMrzFromText(noisy);
    expect(res).not.toBeNull();
    expect(res!.fields.surname?.value).toBe("SPECIMEN");
  });

  it("survives a merged/overlong OCR line set (trims to 44)", () => {
    const overlong = TD3_L2 + "06"; // OCR appended junk
    const res = parseMrzFromText(TD3_L1 + "\n" + overlong);
    expect(res).not.toBeNull();
    expect(res!.fields.documentNumber?.value).toBe("AB1234567");
  });

  it("flags a bad composite check digit (position 44)", () => {
    const bad = TD3_L2.slice(0, 43) + (TD3_L2[43] === "4" ? "7" : "4");
    const res = parseMrzFromText(TD3_L1 + "\n" + bad);
    expect(res).not.toBeNull();
    expect(res!.mrz.allValid).toBe(false);
    expect(res!.mrz.checks.composite).toBe(false);
    // Individual field checks still pass — per-field statuses stay honest.
    expect(res!.fields.documentNumber?.status).toBe("confirmed");
  });
});

describe("parseMrzFromText — TD1 card", () => {
  // Synthetic TD1: 3 lines × 30, all check digits valid (composite = 8).
  const L1 = "I<UTOAB1234567101234567890123<";
  const L2 = "9001011M3001019UTO<<<<<<<<<<<8";
  const L3 = "SPECIMEN<<FAKE<TEST<<<<<<<<<<<";
  it("parses a clean synthetic TD1", () => {
    const res = parseMrzFromText([L1, L2, L3].join("\n"));
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("id_card");
    expect(res!.mrz.format).toBe("TD1");
    expect(res!.fields.surname?.value).toBe("SPECIMEN");
    expect(res!.fields.dateOfBirth?.value).toBe("1990-01-01");
    expect(res!.mrz.allValid).toBe(true);
  });
});

describe("parseMrzFromText — negative cases", () => {
  it("returns null on plain prose", () => {
    expect(parseMrzFromText("This is just normal text with no machine zone at all.")).toBeNull();
  });
  it("returns null when lines are too short", () => {
    expect(parseMrzFromText("P<UTO<AB1234")).toBeNull();
  });
});
