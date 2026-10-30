/**
 * PDF text-layer extraction via pdf.js — the zero-cost deterministic
 * signal. Passport PDFs produced by any issuing system carry their MRZ as
 * real text; a local read of that layer identifies the document without
 * OCR and without the cloud. Scanned PDFs simply return "" per page.
 */

import "./mappolyfill";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  // PATCHED worker — see imaging.ts / scripts/gen-pdf-worker.mjs.
  lib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.patched.mjs`;
  pdfjsLib = lib;
  return lib;
}

export interface PdfTextResult {
  /** 1-based page → text-layer content ("" for scanned pages). */
  pages: string[];
  /** True when at least one page had a real text layer. */
  hasTextLayer: boolean;
}

/**
 * Read the text layer of up to `maxPages` pages. Items are joined with
 * line breaks preserved where pdf.js reports Y distances, so MRZ lines
 * stay on their own rows.
 */
export async function pdfTextLayer(
  file: File,
  maxPages = 12,
): Promise<PdfTextResult> {
  const lib = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const total = Math.min(doc.numPages, maxPages);
    const pages: string[] = [];
    let hasTextLayer = false;
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines: { y: number; parts: string[] }[] = [];
      for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
        if (!item.str || !item.transform) continue;
        const y = Math.round(item.transform[5]);
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - y) <= 2) last.parts.push(item.str);
        else lines.push({ y, parts: [item.str] });
      }
      const text = lines.map((l) => l.parts.join("")).join("\n");
      if (text.trim().length > 0) hasTextLayer = true;
      pages.push(text);
    }
    return { pages, hasTextLayer };
  } finally {
    void doc.destroy();
  }
}
