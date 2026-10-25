/**
 * PDF reading via pdfjs-dist — lazy-loaded so the main bundle stays small.
 * Detects the text layer, extracts text per page and renders pages to
 * canvases for OCR / preview. Runs entirely in the user's browser.
 */

export interface PdfPageText {
  index: number; // 1-based
  text: string;
  charCount: number;
}

export interface PdfPageRender {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = lib;
  return lib;
}

export interface LoadedPdf {
  numPages: number;
  /** Get text-layer text of a page ("" when the page is a scan). */
  getPageText(index1: number): Promise<string>;
  /** Render a page to a canvas at ~targetDpi (capped). */
  renderPage(index1: number, targetDpi?: number): Promise<PdfPageRender>;
  /** Render page 1 as a small thumbnail data URL. */
  thumbnail(): Promise<string>;
  destroy(): void;
}

export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const lib = await loadPdfjs();
  // Copy into a fresh buffer — pdf.js transfers ownership of the input.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const doc = await lib.getDocument({ data: copy }).promise;

  const pageCache = new Map<number, { textItems: { str: string; y: number; x: number }[]; width: number; height: number }>();

  async function loadPage(index1: number) {
    const cached = pageCache.get(index1);
    if (cached) return cached;
    const page = await doc.getPage(index1);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    type AnyItem = { str?: string; transform?: number[] };
    const items = content.items
      .map((it) => it as unknown as AnyItem)
      .filter((it): it is { str: string; transform: number[] } =>
        typeof it.str === "string" && Array.isArray(it.transform)
      )
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    const entry = { textItems: items, width: viewport.width, height: viewport.height };
    pageCache.set(index1, entry);
    return entry;
  }

  /** Group text items into visual lines (tolerant y-bucketing), keep order. */
  function itemsToLines(items: { str: string; x: number; y: number }[]): string[] {
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const tol = 3.5;
      let row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
      if (!row) {
        row = { y: it.y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x: it.x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // top of page first (PDF y grows upward)
    return rows.map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return {
    numPages: doc.numPages,
    async getPageText(index1) {
      const { textItems } = await loadPage(index1);
      return itemsToLines(textItems).join("\n");
    },
    async renderPage(index1, targetDpi = 200) {
      const lib2 = pdfjsLib!;
      const page = await doc.getPage(index1);
      const base = page.getViewport({ scale: 1 });
      // Cap the long edge at ~2600px (enough for OCR, safe for memory).
      const longEdge = Math.max(base.width, base.height);
      const scale = Math.min(targetDpi / 72, 2600 / longEdge);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      void lib2;
      return { canvas, width: canvas.width, height: canvas.height };
    },
    async thumbnail() {
      const t = this as { renderPage(index1: number, targetDpi?: number): Promise<PdfPageRender> };
      const { canvas } = await t.renderPage(1, 40);
      return canvas.toDataURL("image/jpeg", 0.7);
    },
    destroy() {
      void doc.destroy();
    },
  };
}

/** True when the page has a usable text layer (scans have ~none). */
export function hasTextLayer(text: string): boolean {
  return text.replace(/\s/g, "").length >= 30;
}
