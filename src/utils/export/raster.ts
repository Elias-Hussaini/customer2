import { downloadBlob } from "./tabular";

/**
 * Rasterize a DOM element (the print-styled export document). The element is
 * rendered with inline hex/rgb styles only, so html2canvas never meets an
 * unsupported color function and Persian text renders perfectly.
 *
 * html2canvas and jsPDF are heavy — they are lazy-loaded on first export.
 */
export async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  const [{ default: html2canvas }] = await Promise.all([import("html2canvas")]);
  await document.fonts.ready;
  return html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
  });
}

/** PNG image of an element. */
export async function exportElementAsPng(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureElement(el);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) downloadBlob(blob, `${filename}.png`);
}

/** Multi-page A4 PDF built from a rasterized element (perfect Persian/RTL). */
export async function exportElementAsPdf(el: HTMLElement, filename: string): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);
  const canvas = await captureElement(el);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const imgW = pageW - margin * 2;
  const scale = imgW / canvas.width;
  const pageCanvasH = Math.floor((pageH - margin * 2) / scale);

  let offset = 0;
  let page = 0;
  while (offset < canvas.height) {
    const segH = Math.min(pageCanvasH, canvas.height - offset);
    const seg = document.createElement("canvas");
    seg.width = canvas.width;
    seg.height = segH;
    const ctx = seg.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, seg.width, seg.height);
    ctx.drawImage(canvas, 0, offset, canvas.width, segH, 0, 0, canvas.width, segH);
    if (page > 0) pdf.addPage();
    pdf.addImage(seg.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, segH * scale);
    offset += segH;
    page++;
  }
  pdf.save(`${filename}.pdf`);
}
