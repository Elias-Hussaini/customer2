/**
 * Date parsing, transliteration, label extraction and matching tests.
 * All fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";
import { parsePrintedDate, parseMrzDate } from "../dates";
import { latinNameToFa, namesMatch, faNameToLatinKey } from "../translit";
import { extractByLabels, detectKind, PASSPORT_PROFILE } from "../text";
import { matchCustomers } from "../match";
import type { Customer } from "../../../types";
import type { ExtractedValue } from "../types";

describe("parsePrintedDate", () => {
  it("parses ISO", () => {
    expect(parsePrintedDate("1997-03-10")).toBe("1997-03-10");
  });
  it("parses dd/mm/yyyy (gregorian)", () => {
    expect(parsePrintedDate("10/03/1997")).toBe("1997-03-10");
    expect(parsePrintedDate("10.03.1997")).toBe("1997-03-10");
  });
  it("parses dd MMM yyyy", () => {
    expect(parsePrintedDate("10 MAR 1997")).toBe("1997-03-10");
    expect(parsePrintedDate("1 May 2030")).toBe("2030-05-01");
  });
  it("parses Persian digits and Dari month names", () => {
    expect(parsePrintedDate("۱۰ مارچ ۱۹۹۷")).toBe("1997-03-10");
  });
  it("parses Jalali dates (13xx/14xx year)", () => {
    // 1375-12-19 Jalali = 1997-03-09 Gregorian (verified via jalaali-js)
    expect(parsePrintedDate("1375/12/19")).toBe("1997-03-09");
    expect(parsePrintedDate("۱۴۰۳/۰۱/۰۲")).toBe("2024-03-21");
  });
  it("parses yyyymmdd", () => {
    expect(parsePrintedDate("19970310")).toBe("1997-03-10");
  });
  it("rejects invalid dates without guessing", () => {
    expect(parsePrintedDate("1997-13-45")).toBeNull();
    expect(parsePrintedDate("31 FEB 1997")).toBeNull();
    expect(parsePrintedDate("hello")).toBeNull();
    expect(parsePrintedDate("")).toBeNull();
  });
});

describe("parseMrzDate century inference", () => {
  it("future birth dates fall back to 1900s", () => {
    // A person born "70" can't be born in 2070 → 1970.
    expect(parseMrzDate("700101", "birth")).toBe("1970-01-01");
  });
  it("recent births are 2000s", () => {
    expect(parseMrzDate("200101", "birth")).toBe("2020-01-01");
  });
  it("expiry is always 2000s", () => {
    expect(parseMrzDate("300531", "expiry")).toBe("2030-05-31");
  });
});

describe("transliteration", () => {
  it("dictionary tokens transliterate exactly", () => {
    expect(latinNameToFa("NOOR MOHAMMAD")).toBe("نور محمد");
    expect(latinNameToFa("AHMADI")).toBe("احمدی");
    expect(latinNameToFa("HUSSEINI")).toBe("حسینی");
  });
  it("unknown tokens fall back to letter mapping", () => {
    expect(latinNameToFa("ZORBA")).toBe("زوربا");
  });
  it("namesMatch compares Persian against Latin forms", () => {
    expect(namesMatch("نور محمد احمدی", "NOOR MOHAMMAD AHMADI")).toBe(true);
    expect(namesMatch("احمدی", "AHMADI")).toBe(true);
    expect(namesMatch("زهرا موسوی", "AHMADI")).toBe(false);
  });
  it("faNameToLatinKey is stable across Arabic variants", () => {
    expect(faNameToLatinKey("یوسف")).toBe(faNameToLatinKey("يوسف"));
  });
});

describe("extractByLabels — passport profile", () => {
  const page = [
    "REPUBLIC OF UTOPIA",
    "PASSPORT",
    "Surname SPECIMEN",
    "Given Names FAKE TEST",
    "Nationality UTOPIAN",
    "Date of Birth 10 MAR 1997",
    "Place of Birth TESTVILLE",
    "Date of Expiry 31 MAY 2030",
    "Sex M",
    "ID No. 1234-5678-90123",
  ].join("\n");

  it("extracts labeled fields", () => {
    const f = extractByLabels(page, PASSPORT_PROFILE, "pdf_text");
    expect(f.surname?.value).toBe("SPECIMEN");
    expect(f.givenNames?.value).toBe("FAKE TEST");
    expect(f.nationality?.value).toBe("UTOPIAN");
    expect(f.dateOfBirth?.value).toBe("1997-03-10");
    expect(f.dateOfBirth?.status).toBe("confirmed");
    expect(f.placeOfBirth?.value).toBe("TESTVILLE");
    expect(f.dateOfExpiry?.value).toBe("2030-05-31");
    expect(f.sex?.value).toBe("M");
    expect(f.nationalId?.value).toBe("1234-5678-90123");
  });

  it("marks handwriting-extracted dates as needs_review", () => {
    const f = extractByLabels("Date of Birth 10 MAR 1997", PASSPORT_PROFILE, "ocr_handwriting");
    expect(f.dateOfBirth?.value).toBe("1997-03-10");
    expect(f.dateOfBirth?.status).toBe("needs_review");
  });
});

describe("detectKind", () => {
  it("classifies real data pages, covers, tazkira, forms and photos", () => {
    // A cover page only SAYS passport — it has no data-page labels and must
    // never be treated as a passport source (its text must not fill the form).
    expect(detectKind("PASSPORT REPUBLIC OF TEST", false, null)).toBe("photo");
    // A real bio page carries label evidence.
    expect(
      detectKind(
        "REPUBLIC OF TEST PASSPORT\nType P\nSurname: DOE\nGiven names: JANE\nDate of birth: 10 MAR 1997",
        false,
        null,
      ),
    ).toBe("passport");
    expect(
      detectKind("تذکره جمهوری اسلامی افغانستان\nنام پدر: محمد\nولایت: کابل\nتاریخ تولد ۱۳۷۶", false, null),
    ).toBe("tazkira_paper");
    expect(detectKind("VISA APPLICATION FORM", false, null)).toBe("visa_form");
    expect(detectKind("", false, null)).toBe("photo");
    expect(detectKind("hello world foo bar baz", false, null)).toBe("unknown");
  });
});

/* ------------------------------- matching ------------------------------- */

function fakeCustomer(over: Partial<Customer>): Customer {
  return {
    id: "c1",
    firstName: "نور محمد",
    lastName: "احمدی",
    passportNo: "AB1234567",
    birthDate: "1990-01-01",
    registrationDate: "2026-01-01",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function ev(value: string | null, method: ExtractedValue["method"] = "mrz"): ExtractedValue {
  return { value, raw: value, status: value ? "confirmed" : "not_found", method };
}

describe("matchCustomers", () => {
  const customers = [
    fakeCustomer({ id: "a" }),
    fakeCustomer({ id: "b", passportNo: "ZZ9999999", birthDate: "1980-05-05", firstName: "دیگری" }),
  ];

  it("ranks passport-number match as exact", () => {
    const m = matchCustomers(
      { documentNumber: ev("AB1234567"), dateOfBirth: ev("1990-01-01") },
      customers,
    );
    expect(m[0].level).toBe("exact");
    expect(m[0].customer.id).toBe("a");
  });

  it("name + dob → high even without passport", () => {
    const m = matchCustomers(
      {
        givenNames: ev("NOOR MOHAMMAD"),
        surname: ev("AHMADI"),
        dateOfBirth: ev("1990-01-01"),
      },
      customers,
    );
    expect(m[0].level).toBe("high");
  });

  it("no match returns empty", () => {
    const m = matchCustomers(
      { documentNumber: ev("QQ1111111"), dateOfBirth: ev("1975-05-05") },
      customers,
    );
    expect(m.length).toBe(0);
  });

  it("never merges — only reports candidates", () => {
    const m = matchCustomers({ documentNumber: ev("AB1234567") }, customers);
    expect(m.length).toBe(1);
    expect(m[0]).toHaveProperty("reasons");
  });
});
