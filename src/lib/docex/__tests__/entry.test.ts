/**
 * Speed & robustness suite: OCR-confusion folding (lssue/Oate), digit
 * lookalikes in dates, glued date formats, Arabic→Persian normalization,
 * entry-date (تاریخ ورود) via the visa-stamp profile, and kind detection.
 * All fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";
import { toGregorian } from "jalaali-js";
import {
  extractByLabels,
  detectKind,
  normalizeUnicodeLine,
  PASSPORT_PROFILE,
  VISA_STAMP_PROFILE,
  VISA_FORM_PROFILE,
} from "../text";
import { parsePrintedDate } from "../dates";
import { latinNameToFa } from "../translit";

const jIso = (jy: number, jm: number, jd: number) => {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
};

describe("label matching under OCR confusion", () => {
  it("reads the issue date when OCR prints lssue for issue (I↔L)", () => {
    const page = "Date of lssue 20 FEB 2020\nDate of expiry 20 FEB 2030";
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBe("2020-02-20");
    expect(f.dateOfExpiry?.value).toBe("2030-02-20");
  });

  it("reads the issue date when OCR prints Oate for Date (D↔O)", () => {
    const page = "Oate of issue 15 MAR 2022";
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBe("2022-03-15");
  });

  it("reads the birth date when OCR prints B1RTH-style noise (1↔I, S↔5)", () => {
    const page = "Date of b1rth 1O MAR 1997";
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfBirth?.value).toBe("1997-03-10");
  });

  it("still rejects a random line that merely looks label-ish", () => {
    const page = "Mister Dated issues were discussed at length";
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBeUndefined();
  });
});

describe("parsePrintedDate — OCR digit lookalikes & glued formats", () => {
  it("fixes O inside digit runs (2O2O → 2020)", () => {
    expect(parsePrintedDate("15 MAR 2O2O")).toBe("2020-03-15");
  });
  it("fixes a trailing O after a day digit (1O MAR 2020 → 10)", () => {
    expect(parsePrintedDate("1O MAR 2020")).toBe("2020-03-10");
  });
  it("parses glued ddMONyyyy without separators", () => {
    expect(parsePrintedDate("15MAR2022")).toBe("2022-03-15");
    expect(parsePrintedDate("5JAN1997")).toBe("1997-01-05");
  });
  it("parses Arabic-Indic digits (٠-٩) as well as Persian (۰-۹)", () => {
    expect(parsePrintedDate("١٣٩٧/٠٥/٠٢")).toBe(jIso(1397, 5, 2));
  });
  it("never invents a date from garbage", () => {
    expect(parsePrintedDate("hello world")).toBeNull();
    expect(parsePrintedDate("99 ERR 9999")).toBeNull();
  });
});

describe("Arabic→Persian normalization", () => {
  it("maps Arabic yeh/kaf onto Persian ی/ک", () => {
    expect(normalizeUnicodeLine("تاريخ صدور")).toBe("تاریخ صدور");
    expect(normalizeUnicodeLine("محمد كريم")).toBe("محمد کریم");
  });
  it("lets an Arabic-yeh label still match the Persian profile label", () => {
    const page = "تاريخ صدور ۱۳۹۷/۰۵/۰۲";
    const f = extractByLabels(page, PASSPORT_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBe(jIso(1397, 5, 2));
  });
});

describe("entry date (تاریخ ورود) — visa stamp profile", () => {
  it("extracts the Persian entry date from a stamp-like page", () => {
    const page = "وزارت امور خارجه\nتاریخ ورود ۱۳۹۸/۰۵/۱۲";
    const f = extractByLabels(page, VISA_STAMP_PROFILE, "ocr_printed");
    expect(f.entryDate?.value).toBe(jIso(1398, 5, 12));
  });

  it("extracts the English entry date variant", () => {
    const page = "VISA — ENTRY DATE 15 AUG 2019";
    const f = extractByLabels(page, VISA_STAMP_PROFILE, "ocr_printed");
    expect(f.entryDate?.value).toBe("2019-08-15");
  });

  it("does not map the VISA issue date onto the passport issue date", () => {
    // A visa page carries its own issue label — it must never land in
    // dateOfIssue (that field belongs to the passport data page only).
    const page = "تاریخ صدور ویزا ۱۳۹۸/۰۴/۰۱";
    const f = extractByLabels(page, VISA_STAMP_PROFILE, "ocr_printed");
    expect(f.dateOfIssue?.value).toBeUndefined();
    expect(f.entryDate?.value).toBeUndefined();
  });
});

describe("detectKind — ordering & Persian passport keyword", () => {
  it("classifies a visa form (full of the word Passport) as visa_form", () => {
    const form = "VISA APPLICATION\nPassport no: A12345678\nDate of birth: 10 MAR 1997";
    expect(detectKind(form, false, null)).toBe("visa_form");
  });
  it("classifies an Iranian bio page (گذرنامه) as passport", () => {
    // Realistic bio page: the passport word + data-page labels (نام خانوادگی،
    // تاریخ تولد، شماره پاسپورت) — enough label evidence to be a source.
    const page =
      "جمهوری اسلامی ایران\nگذرنامه\nنام: زهرا\nنام خانوادگی: موسوی\nتاریخ تولد: ۱۳۷۵/۰۴/۱۲\nشماره پاسپورت: A12345678";
    expect(detectKind(page, false, null)).toBe("passport");
  });
  it("keeps a cover that only says گذرنامه out of the passport kind", () => {
    expect(detectKind("جمهوری اسلامی ایران\nگذرنامه", false, null)).not.toBe("passport");
  });
  it("keeps an unrecognizable stamp page unknown (visa-stamp profile covers it)", () => {
    expect(detectKind("وزارت امور خارجه تاریخ ورود", false, null)).toBe("unknown");
    const f = extractByLabels("تاریخ ورود ۱۳۹۸/۰۵/۱۲", VISA_STAMP_PROFILE, "ocr_printed");
    expect(f.entryDate?.value).toBe(jIso(1398, 5, 12));
  });
});

describe("Persian name transliteration quality", () => {
  it("fixes the FAIZI mapping (was فيزی — wrong word)", () => {
    expect(latinNameToFa("FAIZI")).toBe("فایزی");
  });
  it("covers very common names the letter map would butcher", () => {
    expect(latinNameToFa("MEHDI")).toBe("مهدی");
    expect(latinNameToFa("NOOR MOHAMMAD")).toBe("نور محمد");
    expect(latinNameToFa("MOUSAVI")).toBe("موسوی");
  });
});
