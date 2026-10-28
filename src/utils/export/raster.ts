import { downloadBlob } from "./tabular";

/**
 * Rasterize a DOM element (the print-styled export document).
 *
 * PRIMARY ENGINE — modern-screenshot (SVG foreignObject): the browser itself
 * lays out and paints the captured subtree, so Persian text lands EXACTLY
 * where the browser renders it — pills, chips and letter-avatars stay
 * perfectly centered. (html2canvas re-implements text layout and drew
 * Vazirmatn text ~0.9×font-size too low, pushing text out of small rounded
 * containers.)
 *
 * FALLBACK — html2canvas: kept for exotic environments where the
 * foreignObject pipeline is unavailable; inline hex/rgb styles keep it safe.
 *
 * Both engines are heavy — lazy-loaded on first export.
 */
export async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  try {
    const { domToCanvas } = await import("modern-screenshot");
    return await domToCanvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      font: {},
    });
  } catch (e) {
    console.warn("modern-screenshot failed, falling back to html2canvas", e);
    const [{ default: html2canvas }] = await Promise.all([import("html2canvas")]);
    return html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
  }
}

/** PNG image of an element. */
export async function exportElementAsPng(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureElement(el);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) downloadBlob(blob, `${filename}.png`);
}

/** Multi-page A4 PDF built from a rasterized element (perfect Persian/RTL).
 *
 * Pagination is ROW-AWARE: the table rows of the export document carry a
 * `data-export-row` attribute, the table head a `data-export-head` and every
 * section band a `data-export-section`. Pages are cut exactly BETWEEN rows
 * (and never through a section band), so no customer row or band is ever
 * sliced in half, and every continuation page repeats the table header so
 * long lists stay readable.
 */
export async function exportElementAsPdf(el: HTMLElement, filename: string): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);
  const canvas = await captureElement(el);
  // Wide reports (auto-width export doc) flip the page to landscape so the
  // single-line table stays readable instead of being shrunk too hard.
  const landscape = canvas.width / 2 > 860;
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation: landscape ? "landscape" : "portrait",
    compress: true,
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = landscape ? 22 : 28;
  const imgW = pageW - margin * 2;
  const k = imgW / canvas.width; // pt per canvas px

  // ---- DOM → canvas mapping (zoom-safe: pure rect ratios) ----
  const elRect = el.getBoundingClientRect();
  const domToCanvas = (domBottom: number) =>
    ((domBottom - elRect.top) / elRect.width) * canvas.width;

  // ---- Cut candidates: bottom edge of every row, the top of the summary
  // footer (so it never gets sliced), both edges of every section band
  // (so a band is never cut in half), and the document end ----
  const rowEls = Array.from(el.querySelectorAll<HTMLElement>("[data-export-row]"));
  const headEl = el.querySelector<HTMLElement>("[data-export-head]");
  const footerEl = el.querySelector<HTMLElement>("[data-export-footer]");
  const sectionEls = Array.from(el.querySelectorAll<HTMLElement>("[data-export-section]"));
  const cutSet = new Set<number>([canvas.height]);
  for (const r of rowEls) {
    const y = domToCanvas(r.getBoundingClientRect().bottom);
    if (y > 2 && y < canvas.height - 2) cutSet.add(Math.round(y));
  }
  for (const s of sectionEls) {
    const sr = s.getBoundingClientRect();
    const top = domToCanvas(sr.top);
    const bottom = domToCanvas(sr.bottom);
    if (top > 2 && top < canvas.height - 2) cutSet.add(Math.round(top));
    if (bottom > 2 && bottom < canvas.height - 2) cutSet.add(Math.round(bottom));
  }
  if (footerEl) {
    const y = domToCanvas(footerEl.getBoundingClientRect().top);
    if (y > 2 && y < canvas.height - 2) cutSet.add(Math.round(y));
  }
  const cuts = [...cutSet].sort((a, b) => a - b);

  // ---- Repeated header band (table head), cropped once from the canvas ----
  let headUrl: string | null = null;
  let headHpx = 0;
  if (headEl) {
    const hr = headEl.getBoundingClientRect();
    const top = Math.max(0, domToCanvas(hr.top));
    const bottom = Math.min(canvas.height, domToCanvas(hr.bottom));
    if (bottom - top > 4) {
      headHpx = Math.round(bottom - top);
      const hc = document.createElement("canvas");
      hc.width = canvas.width;
      hc.height = headHpx;
      const hctx = hc.getContext("2d");
      if (hctx) {
        hctx.fillStyle = "#ffffff";
        hctx.fillRect(0, 0, hc.width, hc.height);
        hctx.drawImage(canvas, 0, top, canvas.width, headHpx, 0, 0, canvas.width, headHpx);
        headUrl = hc.toDataURL("image/jpeg", 0.92);
      }
    }
  }

  const headGapPt = headUrl ? 10 : 0;
  const headerBlockPt = headUrl ? headHpx * k + headGapPt : 0;
  // Canvas-px content budget per page: page 1 has the document header and
  // needs no repeated table head; continuation pages reserve room for it.
  const H1 = Math.floor((pageH - margin * 2) / k);
  const Hn = Math.floor((pageH - margin * 2 - headerBlockPt) / k);

  /** Largest cut position in (start, limit]. */
  const snap = (start: number, limit: number): number => {
    let best = -1;
    for (const c of cuts) {
      if (c > limit) break;
      if (c > start) best = c;
    }
    return best;
  };

  let start = 0;
  let page = 0;
  while (start < canvas.height - 1) {
    const budget = page === 0 ? H1 : Hn;
    let end = Math.min(start + budget, canvas.height);
    if (end < canvas.height) {
      const boundary = snap(start, end);
      // Cut between rows when a boundary is reasonably close to the budget;
      // a row taller than a page still falls back to a hard cut.
      if (boundary > start + budget * 0.25) end = boundary;
    }
    const segH = end - start;
    if (segH <= 0) break;
    const seg = document.createElement("canvas");
    seg.width = canvas.width;
    seg.height = segH;
    const ctx = seg.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, seg.width, seg.height);
    ctx.drawImage(canvas, 0, start, canvas.width, segH, 0, 0, canvas.width, segH);
    if (page > 0) {
      pdf.addPage();
      if (headUrl) {
        // Repeat the table header so continuation pages stay readable.
        pdf.addImage(headUrl, "JPEG", margin, margin, imgW, headHpx * k);
      }
    }
    const y0 = margin + (page > 0 ? headerBlockPt : 0);
    pdf.addImage(seg.toDataURL("image/jpeg", 0.92), "JPEG", margin, y0, imgW, segH * k);
    start = end;
    page++;
  }
  pdf.save(`${filename}.pdf`);
}
