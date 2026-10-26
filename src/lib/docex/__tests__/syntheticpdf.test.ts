import { describe, expect, it } from "vitest";
import { parseMrzFromText } from "../mrz";
import { scorePageText } from "../score";
import { detectKind } from "../text";
import { readFileSync } from "node:fs";

const BYTES = readFileSync("/home/z/my-project/qa/round7/test-passport.pdf");

async function pageText(index1: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(BYTES), useSystemFonts: true }).promise;
  const page = await doc.getPage(index1);
  const content = await page.getTextContent();
  const items = content.items
    .map((it) => it as unknown as { str?: string; transform?: number[] })
    .filter((it) => typeof it.str === "string" && Array.isArray(it.transform))
    .map((it) => ({ str: it.str as string, x: it.transform![4], y: it.transform![5] }));
  // row-bucket like pdfread
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) <= 3.5);
    if (!row) {
      row = { y: it.y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: it.x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.parts.sort((a, b) => a.x - b.x);
  const text = rows
    .map((r) => r.parts.map((p) => p.s).join(" ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
  await doc.destroy();
  return text;
}

describe("synthetic 2-page passport PDF — page relevance debugging", () => {
  it("cover page must NOT be an identity source; bio page must", async () => {
    const coverText = await pageText(1);
    const bioText = await pageText(2);
    console.log("=== COVER TEXT ===\n" + coverText);
    console.log("=== BIO TEXT ===\n" + bioText);

    const coverRel = scorePageText(coverText, false);
    const bioMrz = parseMrzFromText(bioText);
    const bioRel = scorePageText(bioText, Boolean(bioMrz));

    console.log("cover relevance:", JSON.stringify(coverRel));
    console.log("cover kind:", detectKind(coverText, false, null));
    console.log("bio relevance:", JSON.stringify(bioRel));
    console.log("bio kind:", detectKind(bioText, Boolean(bioMrz), bioMrz?.mrz.format ?? null));
    console.log("MRZ docnum:", JSON.stringify(bioMrz?.fields.documentNumber));
    console.log("MRZ surname:", JSON.stringify(bioMrz?.fields.surname));
    console.log("MRZ given:", JSON.stringify(bioMrz?.fields.givenNames));
    console.log("MRZ checks:", JSON.stringify(bioMrz?.mrz.checks));

    expect(coverRel.tier).toBe(3);
    expect(bioRel.tier).toBe(1);
    expect(bioMrz?.fields.documentNumber?.value).toBe("T1234567");
  });
});
