/**
 * Tests for the LOCAL deterministic document classification (localsort.ts)
 * and its merge with cloud answers (docsort fuzzy matching).
 *
 * The MRZ fixtures use the CANONICAL published ICAO 9303-3 examples
 * (verified by hand against the printed check digits 7 / 2 / 9 / 6) and
 * self-consistent TD3 lines whose check digits are computed with the
 * exported checkDigit() — the 7-3-1 weights are pinned by the known-value
 * tests, so the construction is not circular.
 */

import { describe, expect, it } from "vitest";
import {
  checkDigit,
  cleanMrzLine,
  findMrzCandidates,
  detectMrz,
  classifyByFilename,
  classifyByText,
  scoreTazkiraSide,
  slotKind,
  findSlotForKind,
  mergeVerdicts,
} from "../localsort";
import { fuzzyMatchSlot, type DocSlotOption } from "../docsort";

const SLOTS: DocSlotOption[] = [
  { id: "doc-passport", label: "عکس پاسپورت" },
  { id: "doc-front-tazkira", label: "عکس روی تذکره" },
  { id: "doc-back-tazkira", label: "عکس پشت تذکره" },
];

/* ----------------------------- check digits ------------------------------- */

describe("ICAO 7-3-1 check digits", () => {
  it("matches published ICAO example values", () => {
    // Values printed in the ICAO 9303-3 specimen documents.
    expect(checkDigit("D23145890")).toBe(7);
    expect(checkDigit("740812")).toBe(2);
    expect(checkDigit("120415")).toBe(9);
    expect(checkDigit("<".repeat(14))).toBe(0);
  });

  it("rejects characters outside the MRZ alphabet", () => {
    expect(checkDigit("AB?C")).toBeNull();
  });
});

/* ------------------------------- MRZ text --------------------------------- */

describe("cleanMrzLine", () => {
  it("strips spaces and non-MRZ characters", () => {
    expect(cleanMrzLine(" P<UTO  AHMADI<<AHMAD<<<<...")).toBe("P<UTOAHMADI<<AHMAD<<<<");
  });

  it("folds the OCR Ø confusion into a filler", () => {
    expect(cleanMrzLine("P<UTOØ<<")).toBe("P<UTO<<");
  });
});

describe("findMrzCandidates", () => {
  it("groups consecutive MRZ-looking lines", () => {
    const text = ["some prose about the client", "P<UTOAHMADI<<AHMAD<<<<<<<<<<<<<<", "AB1234567<9UTO9504125M2410309<<<<<<<<<<<<<<02"].join("\n");
    const groups = findMrzCandidates(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("ignores a lone MRZ-like line (groups need >= 2)", () => {
    const text = "prose\nAB1234567<9UTO9504125M2410309<<<<<<<<<<<<<<02\nmore prose";
    expect(findMrzCandidates(text)).toHaveLength(0);
  });
});

/* ------------------------------ formats ----------------------------------- */

/** Canonical ICAO 9303-3 TD1 specimen (3 × 30). */
const TD1_TEXT = [
  "I<UTOD231458907<<<<<<<<<<<<<<<",
  "7408122F1204159UTO<<<<<<<<<<<6",
  "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
].join("\n");

/** Canonical ICAO 9303-3 TD2 specimen (2 × 36). */
const TD2_L1 = "I<UTOD231458907" + "<".repeat(21);
const TD2_L2 = "7408122F1204159UTO" + "<".repeat(17) + "6";
const TD2_TEXT = [TD2_L1, TD2_L2].join("\n");

/** Self-consistent TD3 (2 × 44) built with the real check-digit function. */
function td3Fixture(opts: { tamperDob?: boolean; tamperDoc?: boolean; tamperExp?: boolean } = {}): string {
  const doc = "PA1234567";
  const docCk = checkDigit(doc)!;
  const dob = "950412";
  const dobCk = checkDigit(dob)!;
  const exp = "241030";
  const expCk = checkDigit(exp)!;
  const opt = "<".repeat(14);
  const optCk = checkDigit(opt)!;
  const compIn = doc + String(docCk) + dob + String(dobCk) + exp + String(expCk) + opt + String(optCk);
  const comp = checkDigit(compIn)!;
  const l1 = "P<UTOAHMADI<<AHMAD" + "<".repeat(44 - 18);
  const docField = String(opts.tamperDoc ? (docCk + 1) % 10 : docCk);
  const dobField = String(opts.tamperDob ? (dobCk + 1) % 10 : dobCk);
  const expField = String(opts.tamperExp ? (expCk + 1) % 10 : expCk);
  const l2 =
    doc + docField + "UTO" + dob + dobField + "M" + exp + expField +
    opt + String(optCk) + String(comp);
  expect(l1).toHaveLength(44);
  expect(l2).toHaveLength(44);
  return `${l1}\n${l2}`;
}

describe("detectMrz", () => {
  it("recognizes the published TD1 specimen fully (4/4, certain)", () => {
    const mrz = detectMrz(TD1_TEXT)!;
    expect(mrz).not.toBeNull();
    expect(mrz.kind).toBe("idcard");
    expect(mrz.format).toBe("TD1");
    expect(mrz.passed).toBe(4);
    expect(mrz.certain).toBe(true);
  });

  it("recognizes the published TD2 specimen fully (4/4, certain)", () => {
    const mrz = detectMrz(TD2_TEXT)!;
    expect(mrz).not.toBeNull();
    expect(mrz.kind).toBe("idcard");
    expect(mrz.format).toBe("TD2");
    expect(mrz.passed).toBe(4);
    expect(mrz.certain).toBe(true);
  });

  it("prefers the format with more passing checks (TD1 4 beats TD2 3)", () => {
    // The TD1 group also yields a 3-check TD2 reading; the best must be TD1.
    const mrz = detectMrz(TD1_TEXT)!;
    expect(mrz.format).toBe("TD1");
  });

  it("recognizes a valid TD3 as a certain passport", () => {
    const mrz = detectMrz(td3Fixture())!;
    expect(mrz.kind).toBe("passport");
    expect(mrz.format).toBe("TD3");
    expect(mrz.passed).toBe(4);
    expect(mrz.certain).toBe(true);
  });

  it("one tampered check digit also breaks the composite (2/4, not certain)", () => {
    // The composite input contains the DOB check digit, so one tampered
    // check digit disables two checks — proof requires consistency.
    const mrz = detectMrz(td3Fixture({ tamperDob: true }))!;
    expect(mrz.kind).toBe("passport");
    expect(mrz.passed).toBe(2);
    expect(mrz.certain).toBe(false);
  });

  it("heavily tampered check digits reject the MRZ entirely", () => {
    // docnum + dob + expiry all wrong: the composite (which covers them)
    // breaks too. NB: tampering only TWO of them can cancel out in the
    // composite (+7 weight and +3 weight sum to +10 ≡ 0 mod 10), which is
    // exactly why three are needed here.
    expect(detectMrz(td3Fixture({ tamperDoc: true, tamperDob: true, tamperExp: true }))).toBeNull();
  });

  it("returns null for prose without a valid MRZ", () => {
    expect(detectMrz("This is a sponsorship letter mentioning passports and dates but no machine readable zone at all.")).toBeNull();
  });
});

/* ---------------------------- slot matching -------------------------------- */

describe("slotKind / findSlotForKind", () => {
  it("maps Persian and Dari spellings onto kinds", () => {
    expect(slotKind("عکس پاسپورت")).toBe("passport");
    expect(slotKind("پاسپورط")).toBe("passport"); // Dari spelling
    expect(slotKind("عکس روی تذکره")).toBe("tazkiraFront");
    expect(slotKind("عکس پشت تذکره")).toBe("tazkiraBack");
    expect(slotKind("تذکاری")).toBe("tazkiraFront"); // Dari spelling, no side word
    expect(slotKind("کارت ویزه")).toBeNull();
  });

  it("finds the slot for a kind, or null when the agency has none", () => {
    expect(findSlotForKind(SLOTS, "tazkiraBack")?.id).toBe("doc-back-tazkira");
    expect(findSlotForKind(SLOTS, "passport")?.id).toBe("doc-passport");
    expect(findSlotForKind([{ id: "x", label: "کارت ویزه" }], "passport")).toBeNull();
  });
});

/* ---------------------------- filenames ------------------------------------ */

describe("classifyByFilename", () => {
  it("recognizes passport names (fa/en)", () => {
    expect(classifyByFilename("پاسپورت.pdf", SLOTS)?.target).toEqual({ kind: "slot", slotId: "doc-passport", label: "عکس پاسپورت" });
    expect(classifyByFilename("passport-scan.png", SLOTS)?.target).toEqual({ kind: "slot", slotId: "doc-passport", label: "عکس پاسپورت" });
    expect(classifyByFilename("pasport.jpg", SLOTS)?.basis).toBe("filename");
  });

  it("recognizes tazkira front/back names", () => {
    expect(classifyByFilename("تذکره-پشت.jpg", SLOTS)?.target).toEqual({ kind: "slot", slotId: "doc-back-tazkira", label: "عکس پشت تذکره" });
    expect(classifyByFilename("tazkira-front.png", SLOTS)?.target).toEqual({ kind: "slot", slotId: "doc-front-tazkira", label: "عکس روی تذکره" });
    expect(classifyByFilename("تذکره.jpg", SLOTS)?.target).toEqual({ kind: "slot", slotId: "doc-front-tazkira", label: "عکس روی تذکره" });
  });

  it("a personal photo is never a document", () => {
    expect(classifyByFilename("عکس شخصی.jpg", SLOTS)?.target).toEqual({ kind: "photo" });
    expect(classifyByFilename("personal-photo.png", SLOTS)?.target).toEqual({ kind: "photo" });
  });

  it("returns null for names without a document pattern", () => {
    expect(classifyByFilename("IMG_20260101.jpg", SLOTS)).toBeNull();
    expect(classifyByFilename("ahmad.pdf", SLOTS)).toBeNull();
  });

  it("falls to the other side when only one tazkira slot exists", () => {
    const one = [SLOTS[0], SLOTS[1]]; // no back slot
    expect(classifyByFilename("تذکره از پشت.jpg", one)?.target).toEqual({ kind: "slot", slotId: "doc-front-tazkira", label: "عکس روی تذکره" });
  });
});

/* ------------------------------- text -------------------------------------- */

describe("scoreTazkiraSide", () => {
  it("front identity labels beat back labels", () => {
    const front = scoreTazkiraSide("جمهوری اسلامی افغانستان — نام پدر: عبدالله، تخلص: احمدی، زادگاه: هرات، سال تولد");
    expect(front.front).toBeGreaterThanOrEqual(3);
    expect(front.front).toBeGreaterThan(front.back);
  });

  it("back issue/record labels beat front labels", () => {
    const back = scoreTazkiraSide("تاریخ صدور: ۱۴۰۱ — محل صدور: هرات — نشانی: … شماره پرونده ۱۲۳");
    expect(back.back).toBeGreaterThanOrEqual(2);
    expect(back.back).toBeGreaterThan(back.front);
  });
});

describe("classifyByText", () => {
  it("a valid TD3 MRZ inside a PDF text layer is a certain passport verdict", () => {
    const blob = `ISLAMIC REPUBLIC OF AFGHANISTAN\nTYPE P\nCODE UTO\n...\n${td3Fixture()}`;
    const v = classifyByText(blob, SLOTS, "pdftext")!;
    expect(v).not.toBeNull();
    expect(v.target).toEqual({ kind: "slot", slotId: "doc-passport", label: "عکس پاسپورت" });
    expect(v.basis).toBe("pdftext");
    expect(v.certain).toBe(true);
  });

  it("English passport headers (no Persian) classify as passport", () => {
    const v = classifyByText("REPUBLIC OF AFGHANISTAN\nPASSPORT\nTYPE P\n", SLOTS, "ocr");
    expect(v?.target).toEqual({ kind: "slot", slotId: "doc-passport", label: "عکس پاسپورت" });
  });

  it("Persian front labels classify as the tazkira front", () => {
    const v = classifyByText("جمهوری اسلامی افغانستان وزرات داخله — نام، تخلص، نام پدر، نام پدربزرگ، زادگاه، سال تولد", SLOTS, "ocr");
    expect(v?.target).toEqual({ kind: "slot", slotId: "doc-front-tazkira", label: "عکس روی تذکره" });
  });

  it("Persian back labels classify as the tazkira back", () => {
    const v = classifyByText("تذکره — تاریخ صدور، محل صدور، نشانی، شماره پرونده و تمدید", SLOTS, "ocr");
    expect(v?.target).toEqual({ kind: "slot", slotId: "doc-back-tazkira", label: "عکس پشت تذکره" });
  });

  it("one label alone is not enough (strict >= 2)", () => {
    expect(classifyByText("نام پدر", SLOTS, "ocr")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(classifyByText("استلار بسیار زیبا و خوش‌ساخت در مدل‌های جدید", SLOTS, "ocr")).toBeNull();
  });
});

/* ------------------------------- merge ------------------------------------- */

describe("mergeVerdicts", () => {
  const certainLocal = { target: { kind: "slot" as const, slotId: "doc-passport", label: "عکس پاسپورت" }, basis: "mrz" as const, certain: true };
  const likelyLocal = { target: { kind: "slot" as const, slotId: "doc-front-tazkira", label: "عکس روی تذکره" }, basis: "ocr" as const, certain: false };
  const cloudSlot = { kind: "slot" as const, slotId: "doc-back-tazkira", label: "عکس پشت تذکره" };
  const cloudOther = { kind: "other" as const };
  const cloudNew = { kind: "new" as const, label: "عکس ویزه" };

  it("a CERTAIN local verdict beats any cloud answer", () => {
    expect(mergeVerdicts(certainLocal, cloudSlot)).toEqual({ target: certainLocal.target, basis: "mrz" });
    expect(mergeVerdicts(certainLocal, cloudOther)).toEqual({ target: certainLocal.target, basis: "mrz" });
  });

  it("a LIKELY local verdict beats only «سایر»", () => {
    expect(mergeVerdicts(likelyLocal, cloudOther)).toEqual({ target: likelyLocal.target, basis: "ocr" });
    expect(mergeVerdicts(likelyLocal, cloudSlot)).toEqual({ target: cloudSlot, basis: "ai" });
    expect(mergeVerdicts(likelyLocal, cloudNew)).toEqual({ target: cloudNew, basis: "ai" });
  });

  it("the cloud stands when there is no local verdict", () => {
    expect(mergeVerdicts(null, cloudSlot)).toEqual({ target: cloudSlot, basis: "ai" });
    expect(mergeVerdicts(null, cloudOther)).toEqual({ target: cloudOther, basis: "ai" });
  });

  it("unknown when neither exists", () => {
    expect(mergeVerdicts(null, null)).toEqual({ target: null, basis: "unknown" });
  });
});

/* --------------------------- fuzzy slot matching ---------------------------- */

describe("fuzzyMatchSlot (docsort)", () => {
  it("maps free Persian answers onto real slots", () => {
    expect(fuzzyMatchSlot("پاسپورت", SLOTS)?.id).toBe("doc-passport");
    expect(fuzzyMatchSlot("عکس پاسپورت", SLOTS)?.id).toBe("doc-passport");
    expect(fuzzyMatchSlot("تذکره از پشت", SLOTS)?.id).toBe("doc-back-tazkira");
    expect(fuzzyMatchSlot("روی تذکره", SLOTS)?.id).toBe("doc-front-tazkira");
  });

  it("English answers land on the right slot through parseDocSortReply", async () => {
    // The end-to-end path a weak model actually takes: it answers with an
    // English kind word instead of the slot id. (The English bridge knows
    // document KINDS, not sides — «tazkira» means the front slot.)
    const { parseDocSortReply } = await import("../docsort");
    const res = parseDocSortReply('[{"index":1,"slot":"passport"},{"index":2,"slot":"tazkira"}]', SLOTS, 2);
    expect(res[0].target).toEqual({ kind: "slot", slotId: "doc-passport", label: "عکس پاسپورت" });
    expect(res[1].target).toEqual({ kind: "slot", slotId: "doc-front-tazkira", label: "عکس روی تذکره" });
  });

  it("returns null for unrecognized text", () => {
    expect(fuzzyMatchSlot("مداد تراش", SLOTS)).toBeNull();
    expect(fuzzyMatchSlot("", SLOTS)).toBeNull();
  });

  it("bridges the ویزا/ویزه spelling", () => {
    const visaSlots: DocSlotOption[] = [{ id: "v", label: "عکس ویزه" }];
    expect(fuzzyMatchSlot("ویزا", visaSlots)?.id).toBe("v");
  });
});
