import { describe, expect, it } from "vitest";
import { filterNameTokens, isGarbageNameToken, isIdentitySource, scorePageText } from "../score";

describe("scorePageText — page relevance tiers", () => {
  it("an MRZ page is a tier-1 identity source by definition", () => {
    const rel = scorePageText(
      "P<IRANAHMADI<<NOOR<MOHAMMAD<<<<<<<<<<<<<<<<<<<<<<\nC123456785IRN7503104M3005315<<<<<<<<<<<<<<02",
      true,
    );
    expect(rel.tier).toBe(1);
    expect(isIdentitySource(rel)).toBe(true);
  });

  it("a real English bio page (label-dense) is tier 2", () => {
    const page = [
      "REPUBLIC OF TEST",
      "PASSPORT",
      "Type P  Code TEST",
      "Surname: DOE",
      "Given names: JANE MARY",
      "Date of birth: 10 MAR 1997",
      "Date of issue: 15 JAN 2022",
      "Date of expiry: 15 JAN 2027",
    ].join("\n");
    const rel = scorePageText(page, false);
    expect(rel.tier).toBe(2);
    expect(isIdentitySource(rel)).toBe(true);
  });

  it("a cover page that only SAYS passport is tier 3 (never a source)", () => {
    const rel = scorePageText("REPUBLIC OF TEST\nPASSPORT", false);
    expect(rel.tier).toBe(3);
    expect(isIdentitySource(rel)).toBe(false);
  });

  it("a Persian tazkira data page is tier 2", () => {
    const page = [
      "جمهوری اسلامی افغانستان",
      "نام: نور محمد",
      "نام پدر: غلام",
      "تخلص: احمدی",
      "تاریخ تولد: ۱۳۷۵/۰۴/۱۲",
      "ولایت: کابل",
    ].join("\n");
    const rel = scorePageText(page, false);
    expect(rel.tier).toBe(2);
    expect(isIdentitySource(rel)).toBe(true);
  });

  it("a support letter mentioning passport details stays tier 3", () => {
    // The exact pollution the operators reported: a random page in the PDF
    // whose text used to end up in the form. One or two passing mentions
    // are NOT enough to become a data source.
    const letter = [
      "To whom it may concern,",
      "This is to certify that the bearer's passport number is mentioned below.",
      "Applicant name: SEE ATTACHED COPY",
      "Sincerely, Travel Agency",
    ].join("\n");
    const rel = scorePageText(letter, false);
    expect(rel.tier).toBe(3);
    expect(isIdentitySource(rel)).toBe(false);
  });

  it("a cover/letter page with TWO short label lines (date of issue + passport no) is still tier 3", () => {
    // nastier than a plain cover: it carries real label:value lines, but
    // only two of them — a data page always has many more.
    const page = [
      "REPUBLIC OF TESTLAND",
      "PASSPORT",
      "TYPE P",
      "This is to certify that the applicant name: JUNK COVER GUY",
      "Date of issue: 01 JAN 1999",
      "Passport no: X9999999",
    ].join("\n");
    const rel = scorePageText(page, false);
    expect(rel.strongHits).toBe(2);
    expect(rel.tier).toBe(3);
    expect(isIdentitySource(rel)).toBe(false);
  });

  it("a sponsorship letter with three label mentions buried in prose is tier 3", () => {
    const letter = [
      "SPONSORSHIP LETTER",
      "We hereby confirm that the applicant's surname is KHAN, that the applicant's",
      "date of birth is 12 March 1990 as recorded in our registry, and that the",
      "passport number of the traveller has been verified with the issuing authority",
      "of the destination country for the purpose of this visa application.",
    ].join("\n");
    const rel = scorePageText(letter, false);
    expect(rel.strongHits).toBeGreaterThanOrEqual(3);
    expect(rel.shortLineHits).toBeLessThan(2);
    expect(rel.tier).toBe(3);
  });

  it("a joined two-column bio page (long label rows, 5+ labels) is tier 2", () => {
    const page = [
      "REPUBLIC OF TESTLAND PASSPORT",
      "Type P Code TST Passport No: T1234567 Surname: AHMADI Given names: NOOR MOHAMMAD",
      "Nationality: TESTLAND Date of birth: 12 APR 1995 Place of birth: KABUL Sex: M",
      "Date of issue: 10 JAN 2024 Date of expiry: 09 JAN 2029",
    ].join("\n");
    const rel = scorePageText(page, false);
    expect(rel.strongHits).toBeGreaterThanOrEqual(5);
    expect(rel.tier).toBe(2);
  });

  it("a random invoice/itinerary page stays tier 3", () => {
    const rel = scorePageText(
      "BOOKING CONFIRMATION TKTX92\nFlight QR351 DOH-KBL 05:20\nTotal paid: 480 USD\nBaggage: 2 x 23kg",
      false,
    );
    expect(rel.tier).toBe(3);
  });

  it("OCR-confused labels still count (DATE OF LSSUE, PASSP0RT N0)", () => {
    const page = [
      "PASSP0RT N0: C12345678",
      "SURNAME: D0E",
      "DATE OF BIRTH: 10 MAR 1997",
      "DATE OF LSSUE: 15 JAN 2022",
    ].join("\n");
    const rel = scorePageText(page, false);
    expect(rel.tier).toBe(2);
  });

  it("a visa application form is a legitimate tier-2 source", () => {
    const form = [
      "VISA APPLICATION FORM",
      "Family name: DOE",
      "First name: JANE",
      "Date of birth: 10 MAR 1997",
      "Nationality: TEST",
      "Passport no: C12345678",
    ].join("\n");
    const rel = scorePageText(form, false);
    expect(rel.tier).toBe(2);
    expect(rel.isForm).toBe(true);
  });
});

describe("structural garbage-name rejection (no dictionaries)", () => {
  it("rejects repeated-letter OCR noise", () => {
    expect(isGarbageNameToken("کلکللل")).toBe(true);
    expect(isGarbageNameToken("AAAA")).toBe(true);
    expect(isGarbageNameToken("ABAB")).toBe(true);
    expect(isGarbageNameToken("MM")).toBe(true);
  });

  it("keeps real names", () => {
    expect(isGarbageNameToken("احمدی")).toBe(false);
    expect(isGarbageNameToken("نور")).toBe(false);
    expect(isGarbageNameToken("MOHAMMADI")).toBe(false);
    expect(isGarbageNameToken("XU")).toBe(false);
  });

  it("filterNameTokens drops only the garbage words", () => {
    expect(filterNameTokens("کلکللل احمدی")).toBe("احمدی");
    expect(filterNameTokens("نور محمد احمدی")).toBe("نور محمد احمدی");
    expect(filterNameTokens("AAAA")).toBeNull();
    expect(filterNameTokens("")).toBeNull();
  });
});
