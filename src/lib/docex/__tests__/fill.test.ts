/**
 * PDF form-fill tests (pdf-lib, real bytes). All identity data is synthetic.
 * Covers: AcroForm fill, Latin transliteration fallback for Persian text
 * (WinAnsi font limitation), missing-required reporting, date formatting.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, PDFTextField } from "pdf-lib";
import {
  fillTemplate,
  formatDateForTemplate,
  isWinAnsiSafe,
  suggestSource,
  type PdfTemplate,
  type AcroMapping,
} from "../fill";
import type { Customer } from "../../../types";

function fakeCustomer(): Customer {
  return {
    id: "c1",
    firstName: "نور محمد",
    lastName: "کریمی",
    birthDate: "1990-01-01",
    passportNo: "PA1990345",
    passportIssueDate: "2022-03-15",
    passportExpiryDate: "2027-03-15",
    registrationDate: "2026-10-25",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Build a one-page AcroForm PDF like a visa application. */
async function acroPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  const mk = (name: string, y: number) => {
    const f = form.createTextField(name);
    f.setText("");
    f.addToPage(page, { x: 200, y, width: 300, height: 20, font });
  };
  mk("surname", 750);
  mk("given_names", 715);
  mk("passport_no", 680);
  mk("date_of_birth", 645);
  mk("date_of_expiry", 610);
  return doc.save();
}

function mappings(): AcroMapping[] {
  return [
    { pdfField: "surname", source: "lastName", dateFormat: "iso", casing: "upper", required: true },
    { pdfField: "given_names", source: "firstName", dateFormat: "iso", casing: "raw", required: true },
    { pdfField: "passport_no", source: "passportNo", dateFormat: "iso", casing: "raw", required: true },
    { pdfField: "date_of_birth", source: "birthDate", dateFormat: "ddmmyyyy", casing: "raw", required: true },
    { pdfField: "date_of_expiry", source: "passportExpiryDate", dateFormat: "dmonyyyy", casing: "raw", required: false },
  ];
}

async function template(): Promise<PdfTemplate> {
  const file = await acroPdf();
  const doc = await PDFDocument.load(file);
  return {
    id: "t1",
    name: "test",
    kind: "acroform",
    file,
    fileName: "test.pdf",
    pageCount: doc.getPageCount(),
    mappings: mappings(),
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("isWinAnsiSafe", () => {
  it("accepts Latin and digits, rejects Persian", () => {
    expect(isWinAnsiSafe("KARIMI PA1990345")).toBe(true);
    expect(isWinAnsiSafe("کریمی")).toBe(false);
    expect(isWinAnsiSafe("نور محمد")).toBe(false);
  });
});

describe("suggestSource aliases", () => {
  it("maps common visa-form field names", () => {
    expect(suggestSource("surname")).toBe("lastName");
    expect(suggestSource("given_names")).toBe("firstName");
    expect(suggestSource("passport_no")).toBe("passportNo");
    expect(suggestSource("date_of_birth")).toBe("birthDate");
    expect(suggestSource("national_id")).toBe("nationalId");
    expect(suggestSource("random_text")).toBeNull();
  });
});

describe("formatDateForTemplate", () => {
  it("formats all supported output formats", () => {
    expect(formatDateForTemplate("1990-01-01", "iso")).toBe("1990-01-01");
    expect(formatDateForTemplate("1990-01-01", "ddmmyyyy")).toBe("01/01/1990");
    expect(formatDateForTemplate("1990-01-01", "ddmmyy")).toBe("01/01/90");
    expect(formatDateForTemplate("1990-01-01", "yyyymmdd")).toBe("19900101");
    expect(formatDateForTemplate("1990-01-01", "dmonyyyy")).toBe("01 JAN 1990");
    expect(formatDateForTemplate("1990-01-01", "jalali")).toBe("1368/10/11");
  });
});

describe("fillTemplate — AcroForm", () => {
  it("fills fields, transliterates Persian to Latin (font limitation), reports honestly", async () => {
    const t = await template();
    const { bytes, report } = await fillTemplate(t, { customer: fakeCustomer() });

    // Latin fields filled directly.
    expect(report.filled.find((f) => f.pdfField === "passport_no")?.value).toBe("PA1990345");
    // Persian name → deterministic Latin transliteration (dictionary-based).
    const surname = report.transliterated.find((x) => x.pdfField === "surname");
    expect(surname).toBeTruthy();
    expect(surname!.to).toMatch(/KARIMI/i);
    const given = report.transliterated.find((x) => x.pdfField === "given_names");
    expect(given!.to).toMatch(/NOOR MOHAMMAD/i);
    // Dates formatted per mapping.
    expect(report.filled.find((f) => f.pdfField === "date_of_birth")?.value).toBe("01/01/1990");
    expect(report.filled.find((f) => f.pdfField === "date_of_expiry")?.value).toBe("15 MAR 2027");
    // Nothing silently missing or failed.
    expect(report.missing).toEqual([]);
    expect(report.errors).toEqual([]);

    // The output PDF itself carries the values — extract the real text with
    // pdf.js (appearance streams are Flate-compressed, so raw-byte search
    // would be fragile).
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const outDoc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const outPage = await outDoc.getPage(1);
    const outText = (await outPage.getTextContent()).items
      .map((it) => (it as { str?: string }).str ?? "")
      .join(" ");
    expect(outText).toContain("KARIMI");
    expect(outText).toContain("PA1990345");
    expect(outText).toContain("01/01/1990");
    await outDoc.destroy();
  });

  it("reports missing required fields instead of inventing values", async () => {
    const t = await template();
    const partial: Customer = { ...fakeCustomer(), passportNo: undefined, birthDate: undefined };
    const { report } = await fillTemplate(t, { customer: partial });
    const missingFields = report.missing.map((m) => m.pdfField).sort();
    expect(missingFields).toEqual(["date_of_birth", "passport_no"]);
    // No fabricated values for the missing ones.
    expect(report.filled.find((f) => f.pdfField === "passport_no")).toBeUndefined();
  });

  it("never modifies the stored template bytes", async () => {
    const t = await template();
    const before = new Uint8Array(t.file);
    await fillTemplate(t, { customer: fakeCustomer() });
    expect(Array.from(t.file)).toEqual(Array.from(before));
  });
});
