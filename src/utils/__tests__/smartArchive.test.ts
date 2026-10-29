import { describe, expect, it } from "vitest";
import {
  buildPlan,
  formatBytes,
  isValidZipPath,
  resolveTemplate,
  sanitizeSegment,
  type ArchiveEntry,
  type PlanOptions,
} from "../smartArchive/engine";

/** Minimal in-memory entry factory. */
function entry(partial: Partial<ArchiveEntry> & { id: string }): ArchiveEntry {
  return {
    blob: new Blob(["x".repeat(16)], { type: "application/pdf" }),
    originalName: "file.pdf",
    mime: "application/pdf",
    size: 16,
    customerId: "c1",
    customerName: "علی رضایی",
    kind: "doc",
    ...partial,
  };
}

const OPTS: PlanOptions = {
  folderMode: "perCustomer",
  singleFolderName: "بایگانی",
  fileNaming: "docLabel",
  docSubfolders: false,
  extraFolders: [],
};

describe("sanitizeSegment", () => {
  it("strips path separators and illegal characters (path traversal impossible)", () => {
    expect(sanitizeSegment("../../etc/passwd", "فایل")).not.toContain("/");
    expect(sanitizeSegment('a<b>:c"d|e?f*', "فایل")).toBe("a b c d e f");
    expect(sanitizeSegment("pasted\\windows\\path", "فایل")).not.toContain("\\");
  });
  it("rejects empty / dot-only segments with the fallback", () => {
    expect(sanitizeSegment("", "fallback")).toBe("fallback");
    expect(sanitizeSegment("   ", "fallback")).toBe("fallback");
    expect(sanitizeSegment("..", "fallback")).toBe("fallback");
    expect(sanitizeSegment(".", "fallback")).toBe("fallback");
  });
  it("trims leading/trailing dots and spaces (Windows unzip safety)", () => {
    expect(sanitizeSegment(" name.pdf ", "f")).toBe("name.pdf");
    expect(sanitizeSegment("folder.", "f")).toBe("folder");
  });
  it("keeps Persian / Arabic / German unicode intact", () => {
    expect(sanitizeSegment("علی رضایی", "f")).toBe("علی رضایی");
    expect(sanitizeSegment("Müller-Überläufe", "f")).toBe("Müller-Überläufe");
    expect(sanitizeSegment("مؤمن", "f")).toBe("مؤمن");
  });
});

describe("isValidZipPath", () => {
  it("accepts normal relative unicode paths", () => {
    expect(isValidZipPath("علی رضایی/پاسپورت.pdf")).toBe(true);
    expect(isValidZipPath("a/b/c.pdf")).toBe(true);
    expect(isValidZipPath("file.pdf")).toBe(true);
  });
  it("rejects traversal, absolute and backslash paths", () => {
    expect(isValidZipPath("../escape.pdf")).toBe(false);
    expect(isValidZipPath("/abs.pdf")).toBe(false);
    expect(isValidZipPath("a\\b.pdf")).toBe(false);
    expect(isValidZipPath("a//b.pdf")).toBe(false);
    expect(isValidZipPath("")).toBe(false);
  });
});

describe("buildPlan", () => {
  const e1 = entry({ id: "1", docTypeId: "passport", docLabel: "عکس پاسپورت" });
  const e2 = entry({ id: "2", docTypeId: "nidFront", docLabel: "عکس روی تذکره", mime: "image/jpeg", originalName: "scan.jpg" });
  const e3 = entry({ id: "3", kind: "issuedVisa", docTypeId: "issuedVisa", docLabel: "ویزا" });
  const e4 = entry({
    id: "4",
    customerId: "c2",
    customerName: "مریم حسینی",
    kind: "issuedVisa",
    docTypeId: "issuedVisa",
    docLabel: "ویزا",
  });

  it("perCustomer + docLabel: built-in short names — passport→پاسپورت, tazkira→id روی", () => {
    const plan = buildPlan([e1, e2], OPTS);
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("علی رضایی/پاسپورت.pdf");
    expect(paths).toContain("علی رضایی/id روی.jpg");
  });

  it("customerName naming: every file of a customer named after them with numeric suffixes", () => {
    const plan = buildPlan([e1, e2, e3], { ...OPTS, fileNaming: "customerName" });
    const names = plan.items.map((i) => i.fileName).sort();
    // e1=.pdf  e2=.jpg  e3=.pdf → the second .pdf collides and gets ۲
    expect(names).toEqual(["علی رضایی ۲.pdf", "علی رضایی.jpg", "علی رضایی.pdf"].sort());
  });

  it("sequence naming numbers each customer's files ۱، ۲، ۳", () => {
    const plan = buildPlan([e1, e2, e3, e4], { ...OPTS, fileNaming: "sequence" });
    const byCustomer = new Map(plan.items.map((i) => [i.entry.customerId, i.fileName]));
    expect(byCustomer.get("c1")).toBe("۳.pdf");
    expect(byCustomer.get("c2")).toBe("۱.pdf");
  });

  it("single folder mode puts everything into the custom folder name", () => {
    const plan = buildPlan([e1, e4], {
      ...OPTS,
      folderMode: "single",
      singleFolderName: "ویزا های امروز صادر شده",
    });
    expect(plan.items.every((i) => i.folder === "ویزا های امروز صادر شده")).toBe(true);
    expect(plan.stats.folders).toBe(1);
  });

  it("flat mode puts files at the ZIP root", () => {
    const plan = buildPlan([e1], { ...OPTS, folderMode: "flat" });
    expect(plan.items[0].folder).toBe("");
  });

  it("perFile mode wraps EVERY file in its own folder named after its owner", () => {
    const plan = buildPlan([e1, e2, e3, e4], { ...OPTS, folderMode: "perFile" });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    // علی has 3 files → three folders; مریم has 1 → one folder
    expect(paths).toContain("علی رضایی/پاسپورت.pdf");
    expect(paths).toContain("علی رضایی ۲/id روی.jpg");
    expect(paths).toContain("علی رضایی ۳/ویزا.pdf");
    expect(paths).toContain("مریم حسینی/ویزا.pdf");
    expect(plan.stats.folders).toBe(4);
  });

  it("external files: perCustomer mode puts them together in «فایل‌های اضافی»", () => {
    const x1 = entry({
      id: "x1",
      customerId: "external",
      customerName: "",
      kind: "external",
      originalName: "قرارداد آلمان.pdf",
      docLabel: "قرارداد آلمان",
    });
    const x2 = entry({
      id: "x2",
      customerId: "external",
      customerName: "",
      kind: "external",
      originalName: "Scan.JPG",
      mime: "image/jpeg",
      docLabel: "Scan",
    });
    const plan = buildPlan([e1, x1, x2], OPTS);
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("علی رضایی/پاسپورت.pdf");
    expect(paths).toContain("فایل‌های اضافی/قرارداد آلمان.pdf");
    expect(paths).toContain("فایل‌های اضافی/Scan.jpg");
  });

  it("external files: perFile mode gives each one its own folder (by file name)", () => {
    const x1 = entry({
      id: "x1",
      customerId: "external",
      customerName: "",
      kind: "external",
      originalName: "قرارداد.pdf",
    });
    const plan = buildPlan([x1, e4], { ...OPTS, folderMode: "perFile" });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("قرارداد/قرارداد.pdf");
    expect(paths).toContain("مریم حسینی/ویزا.pdf");
  });

  it("extraFolders: sanitized, deduped, nested — and counted in stats.folders", () => {
    const plan = buildPlan([e1], {
      ...OPTS,
      extraFolders: ["مدارک اضافی/۱۴۰۴", "مدارک اضافی/۱۴۰۴", "  ", "../سند"],
    });
    expect(plan.emptyFolders).toEqual(["مدارک اضافی/۱۴۰۴", "سند"]);
    // 1 file folder + 2 empty folders
    expect(plan.stats.folders).toBe(3);
  });

  it("emptyFolders never collide with file destinations (both coexist in the ZIP)", () => {
    const plan = buildPlan([e1], { ...OPTS, extraFolders: ["علی رضایی"] });
    expect(plan.emptyFolders).toContain("علی رضایی");
    expect(plan.items[0].folder).toBe("علی رضایی");
  });

  it("docSubfolders separates docs and visas inside each customer folder", () => {
    const plan = buildPlan([e1, e3], { ...OPTS, docSubfolders: true });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("علی رضایی/مدارک/پاسپورت.pdf");
    expect(paths).toContain("علی رضایی/ویزاها/ویزا.pdf");
  });

  /* ---------------- representative (agent) folder modes ------------------ */

  const a1 = entry({ id: "a1", repName: "احمدی", kind: "issuedVisa", docTypeId: "issuedVisa" });
  const a2 = entry({
    id: "a2",
    customerId: "c2",
    customerName: "مریم حسینی",
    repName: "احمدی",
    kind: "issuedVisa",
    docTypeId: "issuedVisa",
  });
  const a3 = entry({
    id: "a3",
    customerId: "c3",
    customerName: "کریم نوری",
    repName: "رضایی",
    kind: "issuedVisa",
    docTypeId: "issuedVisa",
  });
  const noRep = entry({
    id: "nr",
    customerId: "c4",
    customerName: "بی نماینده",
    kind: "issuedVisa",
    docTypeId: "issuedVisa",
  });

  it("perAgentCustomer: each representative gets a folder with one subfolder per customer", () => {
    const plan = buildPlan([a1, a2, a3, noRep], {
      ...OPTS,
      folderMode: "perAgentCustomer",
      fileNaming: "customerName",
    });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("احمدی/علی رضایی/علی رضایی.pdf");
    expect(paths).toContain("احمدی/مریم حسینی/مریم حسینی.pdf");
    expect(paths).toContain("رضایی/کریم نوری/کریم نوری.pdf");
    // customers without a representative land in a dedicated folder
    expect(paths).toContain("بدون نماینده/بی نماینده/بی نماینده.pdf");
  });

  it("perAgent: files sit directly inside the representative folder", () => {
    const plan = buildPlan([a1, a2, a3], {
      ...OPTS,
      folderMode: "perAgent",
      fileNaming: "customerName",
    });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("احمدی/علی رضایی.pdf");
    expect(paths).toContain("احمدی/مریم حسینی.pdf");
    expect(paths).toContain("رضایی/کریم نوری.pdf");
  });

  it("perAgent + docSubfolders nests مدارک/ویزاها inside the agent folder", () => {
    const d1 = entry({ id: "d1", repName: "احمدی", docTypeId: "passport", docLabel: "عکس پاسپورت" });
    const plan = buildPlan([d1, a1], {
      ...OPTS,
      folderMode: "perAgent",
      fileNaming: "docLabel",
      docSubfolders: true,
    });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("احمدی/مدارک/پاسپورت.pdf");
    expect(paths).toContain("احمدی/ویزاها/ویزا.pdf");
  });

  it("external files go to «فایل‌های اضافی» in the agent modes", () => {
    const x = entry({
      id: "x",
      customerId: "external",
      customerName: "",
      kind: "external",
      originalName: "قرارداد.pdf",
    });
    const plan = buildPlan([x, a1], {
      ...OPTS,
      folderMode: "perAgentCustomer",
      fileNaming: "customerName",
    });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("فایل‌های اضافی/قرارداد.pdf");
  });

  /* ------------------------------ templates ------------------------------- */

  it("resolveTemplate replaces Persian and English tokens", () => {
    expect(resolveTemplate("{نماینده}/{مشتری}", { rep: "احمدی", customer: "علی" })).toBe("احمدی/علی");
    expect(resolveTemplate("{rep} - {customer}", { rep: "احمدی", customer: "علی" })).toBe("احمدی - علی");
  });

  it("resolveTemplate drops empty tokens without leaving dangling separators", () => {
    expect(resolveTemplate("{نماینده}/{مشتری}", { customer: "علی" })).toBe("علی");
    expect(resolveTemplate("{مشتری} - {مدرک}", { customer: "علی" })).toBe("علی");
    expect(resolveTemplate("{مدرک} - {مشتری}", { customer: "علی" })).toBe("علی");
  });

  it("resolveTemplate removes unknown {…} tokens and collapses doubled slashes", () => {
    expect(resolveTemplate("{غیرمعتبر}/{مشتری}", { customer: "علی" })).toBe("علی");
    expect(resolveTemplate("{مشتری}//{مدرک}", { customer: "علی", doc: "ویزا" })).toBe("علی/ویزا");
  });

  it("custom folder template builds the path from tokens (empty segments dropped)", () => {
    const noRepEntry = entry({ id: "t1", kind: "issuedVisa", docTypeId: "issuedVisa" });
    const plan = buildPlan([a1, noRepEntry], {
      ...OPTS,
      folderMode: "custom",
      folderTemplate: "{نماینده}/{مشتری}",
      fileNaming: "customerName",
    });
    const paths = plan.items.map((i) => `${i.folder}/${i.fileName}`);
    expect(paths).toContain("احمدی/علی رضایی/علی رضایی.pdf");
    // consistent with the agent modes: no representative → «بدون نماینده»
    expect(paths).toContain("بدون نماینده/علی رضایی/علی رضایی.pdf");
  });

  it("custom naming template supports doc type, passport, sequence and date tokens", () => {
    const withPassport = entry({
      id: "t2",
      passportNo: "A12345678",
      dateIso: "2025-10-28",
      docTypeId: "passport",
      docLabel: "عکس پاسپورت",
    });
    const plan = buildPlan([withPassport], {
      ...OPTS,
      fileNaming: "custom",
      nameTemplate: "{مشتری} [{پاسپورت}] {مدرک}",
    });
    expect(plan.items[0].fileName).toBe("علی رضایی [A12345678] پاسپورت.pdf");
  });

  it("custom naming template strips leftover separators when a token is empty", () => {
    const noPassport = entry({ id: "t3", docTypeId: "issuedVisa", kind: "issuedVisa" });
    const plan = buildPlan([noPassport], {
      ...OPTS,
      fileNaming: "custom",
      nameTemplate: "{مشتری} - {پاسپورت}",
    });
    expect(plan.items[0].fileName).toBe("علی رضایی.pdf");
  });

  /* --------------------------- new naming modes ---------------------------- */

  it("customerDoc naming: «مشتری - نوع مدرک» and «مشتری - ویزا»", () => {
    const plan = buildPlan([e1, e3], { ...OPTS, fileNaming: "customerDoc" });
    const names = plan.items.map((i) => i.fileName);
    expect(names).toContain("علی رضایی - پاسپورت.pdf");
    expect(names).toContain("علی رضایی - ویزا.pdf");
  });

  it("docCustomer naming: «نوع مدرک - مشتری»", () => {
    const plan = buildPlan([e1], { ...OPTS, fileNaming: "docCustomer" });
    expect(plan.items[0].fileName).toBe("پاسپورت - علی رضایی.pdf");
  });

  it("passportNo naming uses the passport number, falling back to the customer", () => {
    const p1 = entry({ id: "p1", passportNo: "B99887766", kind: "issuedVisa", docTypeId: "issuedVisa" });
    const plan = buildPlan([p1, e4], { ...OPTS, fileNaming: "passportNo" });
    const names = plan.items.map((i) => i.fileName);
    expect(names).toContain("B99887766.pdf");
    expect(names).toContain("مریم حسینی.pdf"); // no passport on file
  });

  it("customerOriginal naming: «مشتری - نام اصلی»", () => {
    const scan = entry({ id: "co", originalName: "scan.jpg", mime: "image/jpeg", docTypeId: "other" });
    const plan = buildPlan([scan], { ...OPTS, fileNaming: "customerOriginal" });
    expect(plan.items[0].fileName).toBe("علی رضایی - scan.jpg");
  });

  it("changing the folder mode does not corrupt sequence numbering in templates", () => {
    const plan = buildPlan([e1, e2, e3], {
      ...OPTS,
      fileNaming: "custom",
      nameTemplate: "{مشتری} {شماره}",
    });
    const names = plan.items.map((i) => i.fileName).sort();
    expect(names).toEqual(["علی رضایی ۱.pdf", "علی رضایی ۲.jpg", "علی رضایی ۳.pdf"].sort());
  });

  it("collisions across customers with the same name get suffixes, never overwrite", () => {
    const a = entry({ id: "a", customerName: "تکراری", kind: "issuedVisa", docTypeId: "issuedVisa" });
    const b = entry({ id: "b", customerName: "تکراری", kind: "issuedVisa", docTypeId: "issuedVisa" });
    const plan = buildPlan([a, b], { ...OPTS, folderMode: "single", fileNaming: "customerName" });
    const names = plan.items.map((i) => i.fileName).sort();
    expect(names).toEqual(["تکراری ۲.pdf", "تکراری.pdf"].sort());
    expect(plan.issues.length).toBe(1);
    expect(plan.stats.renamed).toBe(1);
  });

  it("collisions are case-insensitive (Windows unzip safety)", () => {
    const a = entry({ id: "a", originalName: "File.PDF", kind: "doc", docTypeId: "other" });
    const b = entry({ id: "b", originalName: "file.pdf", kind: "doc", docTypeId: "other" });
    const plan = buildPlan([a, b], { ...OPTS, fileNaming: "original" });
    const names = plan.items.map((i) => i.fileName).sort();
    expect(names).toEqual(["File.pdf", "file ۲.pdf"].sort());
  });

  it("original naming keeps the uploaded name (extension preserved by mime when missing)", () => {
    const noExt = entry({ id: "x", originalName: "بدون-پسوند", mime: "image/png", kind: "doc", docTypeId: "other" });
    const plan = buildPlan([noExt], { ...OPTS, fileNaming: "original" });
    expect(plan.items[0].fileName).toBe("بدون-پسوند.png");
  });

  it("excluded override removes the file and counts it, without losing it silently", () => {
    const plan = buildPlan([e1, e2], OPTS, { "1": { excluded: true } });
    expect(plan.items.length).toBe(1);
    expect(plan.stats.excluded).toBe(1);
    expect(plan.stats.total).toBe(2);
  });

  it("rename + move overrides apply on top of the rules and are sanitized", () => {
    const plan = buildPlan([e1], OPTS, {
      "1": { fileName: "پاسپورت جدید", folder: "پوشه/زیر پوشه" },
    });
    expect(plan.items[0].fileName).toBe("پاسپورت جدید.pdf");
    expect(plan.items[0].folder).toBe("پوشه/زیر پوشه");
    expect(plan.stats.renamed).toBe(1);
  });

  it("a hostile override folder (../../) is sanitized to a safe path", () => {
    const plan = buildPlan([e1], OPTS, { "1": { folder: "../../etc" } });
    const path = `${plan.items[0].folder}/${plan.items[0].fileName}`;
    expect(isValidZipPath(path)).toBe(true);
    expect(path).not.toContain("..");
  });

  it("empty blobs are reported as issues instead of crashing", () => {
    const empty = entry({ id: "z", blob: new Blob([]), size: 0 });
    const plan = buildPlan([empty, e1], OPTS);
    expect(plan.items.length).toBe(1);
    expect(plan.issues.some((i) => i.entryId === "z")).toBe(true);
  });

  it("stats report folders, bytes and included counts", () => {
    const plan = buildPlan([e1, e4], OPTS);
    expect(plan.stats.included).toBe(2);
    expect(plan.stats.folders).toBe(2);
    expect(plan.stats.bytes).toBe(32);
  });
});

describe("formatBytes", () => {
  it("formats Persian human-readable sizes", () => {
    expect(formatBytes(0)).toBe("۰ بایت");
    expect(formatBytes(512)).toBe("۵۱۲ بایت");
    expect(formatBytes(2048)).toBe("۲.۰ کیلوبایت");
    expect(formatBytes(3 * 1024 * 1024)).toBe("۳.۰ مگابایت");
  });
});
