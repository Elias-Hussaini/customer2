/**
 * Receipt images for exports (سند پیوست).
 *
 * Export documents (PDF/PNG) and XLSX can embed the receipt photo of each
 * transaction/payment BELOW its row. Blobs are converted to data URLs so
 * both raster engines (modern-screenshot + html2canvas fallback) and
 * ExcelJS can render them without CORS/blob-URL quirks.
 */

/** Blob → data:image/...;base64 URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

export interface ReceiptDocMeta {
  id: string;
  mime: string;
}

/**
 * Build ownerKey → ordered image data URLs.
 * `keyOf` maps a doc id to its owner key (transactionId / paymentId);
 * returning null skips the doc. Non-image docs (PDFs) are skipped — they
 * cannot render inline inside the export document.
 */
export async function buildReceiptImages(
  docs: ReceiptDocMeta[],
  keyOf: (docId: string) => string | null | undefined,
  fetchBlob: (docId: string) => Promise<Blob | undefined>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const d of docs) {
    if (!d.mime.startsWith("image/")) continue;
    const key = keyOf(d.id);
    if (!key) continue;
    try {
      const blob = await fetchBlob(d.id);
      if (!blob) continue;
      const url = await blobToDataUrl(blob);
      (out[key] ??= []).push(url);
    } catch {
      /* a broken document never blocks the export */
    }
  }
  return out;
}

/** How many owners actually carry receipts (drives the option visibility). */
export function countReceiptOwners(photos: Record<string, string[]> | null | undefined): number {
  return photos ? Object.keys(photos).length : 0;
}
