/**
 * Pure-logic tests for the per-customer PDF dossier builder
 * (بایگانی هوشمند — پروندهٔ هر مشتری به یک PDF).
 *
 * Only the pure functions are covered here (grouping, file/folder naming,
 * page geometry) — canvas rasterization and jsPDF composition need a real
 * browser and are verified by the round QA scripts instead.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PDF_OPTIONS,
  groupEntriesByCustomer,
  pageDimsFor,
  pdfFileNameFor,
  pdfFolderFor,
  pdfRelativePath,
  type CustomerGroup,
} from "../smartArchive/customerPdf";
import type { ArchiveEntry } from "../smartArchive/engine";

function entry(partial: Partial<ArchiveEntry> & { id: string }): ArchiveEntry {
  return {
    blob: new Blob(["x"]),
    originalName: "file.jpg",
    mime: "image/jpeg",
    size: 10,
    customerId: "c1",
    customerName: "علی رضایی",
    kind: "doc",
    ...partial,
  };
}

function group(name: string, extra: Partial<CustomerGroup> = {}): CustomerGroup {
  return {
    customerId: `id-${name}`,
    customerName: name,
    passportNo: "A123",
    repName: "احمدی",
    employerName: "شرکت نمونه",
    entries: [],
    ...extra,
  };
}

describe("groupEntriesByCustomer", () => {
  it("groups entries by customer and skips external files", () => {
    const groups = groupEntriesByCustomer([
      entry({ id: "a", customerId: "c1", customerName: "ب" }),
      entry({ id: "b", customerId: "c2", customerName: "الف" }),
      entry({ id: "c", customerId: "c1", customerName: "ب" }),
      entry({ id: "d", customerId: "external", customerName: "", kind: "external" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].customerName).toBe("الف"); // sorted fa
    expect(groups[1].entries).toHaveLength(2);
  });

  it("orders entries docs → profile photo → issued visa", () => {
    const groups = groupEntriesByCustomer([
      entry({ id: "v", kind: "issuedVisa", docLabel: "ویزا" }),
      entry({ id: "p", kind: "profilePhoto", docLabel: "پروفایل" }),
      entry({ id: "d2", kind: "doc", docLabel: "پاسپورت" }),
      entry({ id: "d1", kind: "doc", docLabel: "تذکره" }),
    ]);
    // Persian collation: پ (پاسپورت) sorts before ت (تذکره)
    expect(groups[0].entries.map((e) => e.id)).toEqual(["d2", "d1", "p", "v"]);
  });

  it("carries the customer context (passport/rep/employer) into the group", () => {
    const groups = groupEntriesByCustomer([
      entry({ id: "a", passportNo: "Z9", repName: "کریمی", employerName: "ابن سینا" }),
    ]);
    expect(groups[0].passportNo).toBe("Z9");
    expect(groups[0].repName).toBe("کریمی");
    expect(groups[0].employerName).toBe("ابن سینا");
  });
});

describe("pdf naming + folder rules", () => {
  it("default template names the PDF after the customer", () => {
    const g = group("مریم کریمی");
    expect(pdfFileNameFor(g, DEFAULT_PDF_OPTIONS)).toBe("مریم کریمی.pdf");
  });

  it("custom template uses passport and customer tokens", () => {
    const g = group("مریم کریمی");
    const name = pdfFileNameFor(g, {
      ...DEFAULT_PDF_OPTIONS,
      nameTemplate: "{پاسپورت} - {مشتری}",
    });
    expect(name).toBe("A123 - مریم کریمی.pdf");
  });

  it("sanitizes illegal path characters out of the name", () => {
    const g = group('what: "ever"?');
    const name = pdfFileNameFor(g, DEFAULT_PDF_OPTIONS);
    expect(name).not.toMatch(/[:"?]/);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("falls back to the customer name for an empty template result", () => {
    const g = group("علی");
    const name = pdfFileNameFor(g, { ...DEFAULT_PDF_OPTIONS, nameTemplate: "{پاسپورت}" });
    // group() has passport A123 → template resolves; make it empty instead
    const name2 = pdfFileNameFor({ ...g, passportNo: "" }, {
      ...DEFAULT_PDF_OPTIONS,
      nameTemplate: "{پاسپورت}",
    });
    expect(name).toBe("A123.pdf");
    expect(name2).toBe("علی.pdf");
  });

  it("flat mode puts PDFs in the root; perRep nests under the representative", () => {
    const g = group("علی رضایی", { repName: "احمدی" });
    expect(pdfFolderFor(g, { ...DEFAULT_PDF_OPTIONS, folderMode: "flat" })).toBe("");
    expect(pdfFolderFor(g, { ...DEFAULT_PDF_OPTIONS, folderMode: "perRep" })).toBe("احمدی");
    expect(
      pdfRelativePath(g, { ...DEFAULT_PDF_OPTIONS, folderMode: "perRep" }),
    ).toBe("احمدی/علی رضایی.pdf");
  });

  it("perEmployer nests under the employer name", () => {
    const g = group("علی", { employerName: "ابن سینا" });
    expect(pdfFolderFor(g, { ...DEFAULT_PDF_OPTIONS, folderMode: "perEmployer" })).toBe(
      "ابن سینا",
    );
  });

  it("custom folder templates resolve per customer and sanitize segments", () => {
    const g = group("علی", { repName: "احمدی" });
    expect(
      pdfFolderFor(g, {
        ...DEFAULT_PDF_OPTIONS,
        folderMode: "custom",
        folderTemplate: "{نماینده}/{مشتری}",
      }),
    ).toBe("احمدی/علی");
  });
});

describe("pageDimsFor", () => {
  const a4 = { w: 595.28, h: 841.89 };

  it("a4 portrait for a tall document with auto orientation", () => {
    const dims = pageDimsFor(DEFAULT_PDF_OPTIONS, 1000, 1600, false);
    expect(Math.round(dims.w)).toBe(Math.round(a4.w));
    expect(Math.round(dims.h)).toBe(Math.round(a4.h));
  });

  it("auto orientation flips to landscape for wide documents", () => {
    const dims = pageDimsFor(DEFAULT_PDF_OPTIONS, 1600, 1000, false);
    expect(Math.round(dims.w)).toBe(Math.round(a4.h));
    expect(Math.round(dims.h)).toBe(Math.round(a4.w));
  });

  it("forced portrait keeps A4 portrait even for wide content", () => {
    const dims = pageDimsFor(
      { ...DEFAULT_PDF_OPTIONS, orientation: "portrait" },
      1600,
      1000,
      false,
    );
    expect(Math.round(dims.w)).toBe(Math.round(a4.w));
  });

  it("a5 shrinks the page", () => {
    const dims = pageDimsFor({ ...DEFAULT_PDF_OPTIONS, pageSize: "a5" }, 1000, 1600, false);
    expect(Math.round(dims.w)).toBe(420);
  });

  it("fit mode sizes the page to the image (96dpi → pt) plus the caption band", () => {
    const noCap = pageDimsFor(
      { ...DEFAULT_PDF_OPTIONS, pageSize: "fit" },
      1240,
      1754,
      false,
    );
    expect(Math.round(noCap.w)).toBe(930); // 1240 * 0.75
    expect(Math.round(noCap.h)).toBe(Math.round(1754 * 0.75));
    const withCap = pageDimsFor(
      { ...DEFAULT_PDF_OPTIONS, pageSize: "fit" },
      1240,
      1754,
      true,
    );
    expect(withCap.h).toBeGreaterThan(noCap.h);
    expect(withCap.w).toBe(noCap.w);
  });

  it("never produces a degenerate (zero) page", () => {
    const dims = pageDimsFor({ ...DEFAULT_PDF_OPTIONS, pageSize: "fit" }, 10, 10, true);
    expect(dims.w).toBeGreaterThanOrEqual(72);
    expect(dims.h).toBeGreaterThanOrEqual(72);
  });
});
