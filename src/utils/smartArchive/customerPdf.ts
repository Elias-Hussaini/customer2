/**
 * Per-customer PDF builder (بایگانی هوشمند — مدارک مشتریان):
 * merges every file of ONE customer's پرونده into a single PDF named after
 * the customer, then packs all customers into a folder — either a real
 * folder on disk (File System Access API, Chrome/Edge) or a ZIP that
 * contains the same structure.
 *
 * Pipeline per customer:
 *   entries ──buildCustomerPdf(options)──► one PDF (Blob)
 *      · optional Persian cover page (rasterized DOM — perfect RTL)
 *      · every document gets its own page(s): images are placed natively,
 *        PDFs are re-rendered page-by-page via the bundled pdf.js
 *      · optional caption band above each document (نام مدرک)
 *
 * Everything happens locally in the browser — no upload, ever.
 */
import { isoToJalali, todayIso, toPersianDigits, JALALI_MONTHS } from "../jalali";
import { resolveTemplate, sanitizeSegment, type ArchiveEntry } from "./engine";
import { captureElement } from "../export/raster";
import { renderPdfPagesToCanvases } from "../../lib/studio/convert";

/* ------------------------------- options --------------------------------- */

export type CustomerPdfPageSize = "a4" | "a5" | "fit";
export type CustomerPdfOrientation = "auto" | "portrait" | "landscape";
export type CustomerPdfQuality = "light" | "standard" | "high";
export type CustomerPdfMargin = "none" | "narrow" | "normal";
export type CustomerPdfFolderMode = "flat" | "perRep" | "perEmployer" | "custom";

export interface CustomerPdfOptions {
  /** Persian cover page with the customer's details. */
  cover: boolean;
  /** Caption band («پاسپورت», «ویزا — صفحه ۲ از ۳») above each document. */
  captions: boolean;
  pageSize: CustomerPdfPageSize;
  orientation: CustomerPdfOrientation;
  quality: CustomerPdfQuality;
  margin: CustomerPdfMargin;
  /** PDF file name pattern — default «{مشتری}». */
  nameTemplate: string;
  folderMode: CustomerPdfFolderMode;
  /** Folder path pattern when folderMode = "custom". */
  folderTemplate: string;
}

export const DEFAULT_PDF_OPTIONS: CustomerPdfOptions = {
  cover: true,
  captions: true,
  pageSize: "a4",
  orientation: "auto",
  quality: "standard",
  margin: "normal",
  nameTemplate: "{مشتری}",
  folderMode: "flat",
  folderTemplate: "{نماینده}",
};

/* Page formats in PDF points (1 pt = 1/72"). */
const PAGE_FORMATS_PT: Record<Exclude<CustomerPdfPageSize, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
};

const MARGIN_PT: Record<CustomerPdfMargin, number> = {
  none: 0,
  narrow: 16,
  normal: 32,
};

const QUALITY_PRESETS: Record<
  CustomerPdfQuality,
  { jpeg: number; pdfScale: number; pdfMaxEdge: number }
> = {
  light: { jpeg: 0.72, pdfScale: 1.6, pdfMaxEdge: 1600 },
  standard: { jpeg: 0.85, pdfScale: 2.0, pdfMaxEdge: 2200 },
  high: { jpeg: 0.93, pdfScale: 2.6, pdfMaxEdge: 2900 },
};

/** px → pt for the "fit" page size (CSS 96 dpi reference). */
const PX_TO_PT = 72 / 96;

/* ------------------------------- grouping -------------------------------- */

export interface CustomerGroup {
  customerId: string;
  customerName: string;
  passportNo: string;
  repName: string;
  employerName: string;
  entries: ArchiveEntry[];
}

/** Group archive entries per customer (externally imported files have no
 *  customer record and are skipped). Docs come first (label order), then
 *  issued visas; groups are sorted by customer name. Pure function. */
export function groupEntriesByCustomer(entries: ArchiveEntry[]): CustomerGroup[] {
  const byId = new Map<string, CustomerGroup>();
  for (const e of entries) {
    if (e.kind === "external" || !e.customerId || !e.customerName) continue;
    let g = byId.get(e.customerId);
    if (!g) {
      g = {
        customerId: e.customerId,
        customerName: e.customerName,
        passportNo: e.passportNo ?? "",
        repName: e.repName ?? "",
        employerName: e.employerName ?? "",
        entries: [],
      };
      byId.set(e.customerId, g);
    }
    g.entries.push(e);
  }
  const rank = (e: ArchiveEntry) => (e.kind === "issuedVisa" ? 2 : e.kind === "profilePhoto" ? 1 : 0);
  const label = (e: ArchiveEntry) => e.docLabel ?? e.originalName ?? "";
  const groups = [...byId.values()].filter((g) => g.entries.length > 0);
  for (const g of groups) {
    g.entries.sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b), "fa") || a.size - b.size);
  }
  groups.sort((a, b) => a.customerName.localeCompare(b.customerName, "fa"));
  return groups;
}

/* --------------------------- name/folder rules ---------------------------- */

function templateContext(g: CustomerGroup) {
  const j = isoToJalali(todayIso());
  const fa = (n: number | string) => toPersianDigits(n);
  return {
    customer: g.customerName,
    rep: g.repName,
    employer: g.employerName,
    passport: g.passportNo,
    kind: "پرونده",
    doc: "",
    seq: "",
    date: j ? `${fa(j.jy)}/${fa(String(j.jm).padStart(2, "0"))}/${fa(String(j.jd).padStart(2, "0"))}` : "",
    year: j ? fa(j.jy) : "",
    month: j ? JALALI_MONTHS[j.jm - 1] ?? "" : "",
  };
}

/** PDF file name (with extension) for one customer. Pure function. */
export function pdfFileNameFor(g: CustomerGroup, opts: CustomerPdfOptions): string {
  const base = sanitizeSegment(
    resolveTemplate(opts.nameTemplate || "{مشتری}", templateContext(g)),
    g.customerName || "مشتری",
  );
  return `${base || "مشتری"}.pdf`;
}

/** Folder path inside the ZIP / directory for one customer ("" = root). Pure. */
export function pdfFolderFor(g: CustomerGroup, opts: CustomerPdfOptions): string {
  const ctx = templateContext(g);
  let raw = "";
  if (opts.folderMode === "perRep") raw = g.repName;
  else if (opts.folderMode === "perEmployer") raw = g.employerName;
  else if (opts.folderMode === "custom") raw = resolveTemplate(opts.folderTemplate || "{مشتری}", ctx);
  return raw
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg !== "")
    .map((seg) => sanitizeSegment(seg, "پوشه"))
    .join("/");
}

/** Full relative path «folder/name.pdf» — used by the ZIP packer and the
 *  real-folder writer, with collision handling done by the caller. Pure. */
export function pdfRelativePath(g: CustomerGroup, opts: CustomerPdfOptions): string {
  const folder = pdfFolderFor(g, opts);
  const name = pdfFileNameFor(g, opts);
  return folder ? `${folder}/${name}` : name;
}

/* ------------------------------ page geometry ----------------------------- */

export interface PageDims {
  w: number;
  h: number;
}

/** Page size in pt for one content image. Pure function.
 *  - fixed formats (a4/a5): orientation applied (auto = follow the image)
 *  - "fit": the page IS the image (96 dpi reference), margin ignored */
export function pageDimsFor(
  opts: CustomerPdfOptions,
  contentW: number,
  contentH: number,
  hasCaption: boolean,
): PageDims {
  const capH = hasCaption ? captionHeightPt(opts.pageSize === "fit" ? contentW * PX_TO_PT : PAGE_FORMATS_PT[opts.pageSize][0]) : 0;
  if (opts.pageSize === "fit") {
    // reserve a slim band for the caption when enabled
    return { w: Math.max(72, contentW * PX_TO_PT), h: Math.max(72, contentH * PX_TO_PT + capH) };
  }
  const [pw, ph] = PAGE_FORMATS_PT[opts.pageSize];
  const landscape =
    opts.orientation === "landscape" ||
    (opts.orientation === "auto" && contentW > contentH * 1.02);
  return landscape ? { w: ph, h: pw } : { w: pw, h: ph };
}

/** Caption band height in pt — the rasterized band keeps a fixed aspect
 *  ratio (≈ 46px tall at 640px wide), scaled to the page width. */
function captionHeightPt(pageW: number): number {
  return Math.max(14, pageW * (46 / CAPTION_PX_WIDTH));
}

const CAPTION_PX_WIDTH = 640;

/* ----------------------------- DOM rasterizers ---------------------------- */

function offscreenContainer(widthPx: number): HTMLDivElement {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-10000px";
  host.style.width = `${widthPx}px`;
  host.style.background = "#ffffff";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  return host;
}

async function rasterize(host: HTMLElement): Promise<HTMLCanvasElement> {
  try {
    return await captureElement(host);
  } finally {
    host.remove();
  }
}

/** Persian caption band for one document («پاسپورت», «ویزا — صفحه ۲ از ۳»). */
async function renderCaptionBand(text: string): Promise<HTMLCanvasElement> {
  const host = offscreenContainer(CAPTION_PX_WIDTH);
  const band = document.createElement("div");
  band.setAttribute("dir", "rtl");
  band.style.cssText = [
    "box-sizing: border-box",
    "width: 100%",
    "padding: 9px 18px",
    "background: #f1f0ff",
    "border-bottom: 3px solid #635bff",
    "color: #2e2e58",
    "font-family: Vazirmatn, Tahoma, sans-serif",
    "font-size: 21px",
    "font-weight: 700",
    "white-space: nowrap",
    "overflow: hidden",
    "text-overflow: ellipsis",
  ].join(";");
  band.textContent = text;
  host.appendChild(band);
  return rasterize(host);
}

/** Persian cover page for one customer's dossier. */
async function renderCoverCanvas(g: CustomerGroup, widthPx: number): Promise<HTMLCanvasElement> {
  const host = offscreenContainer(widthPx);
  const j = isoToJalali(todayIso());
  const fa = (n: number | string) => toPersianDigits(n);
  const dateFa = j
    ? `${fa(j.jy)}/${fa(String(j.jm).padStart(2, "0"))}/${fa(String(j.jd).padStart(2, "0"))}`
    : "";
  const docs = g.entries.filter((e) => e.kind === "doc").length;
  const visas = g.entries.filter((e) => e.kind === "issuedVisa").length;

  const row = (label: string, value: string) => {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:14px;padding:7px 0;";
    const l = document.createElement("span");
    l.style.cssText = "color:#8a8aa8;font-weight:600;flex-shrink:0;";
    l.textContent = label;
    const v = document.createElement("span");
    v.style.cssText = "font-weight:700;color:#26264d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    v.textContent = value || "—";
    r.append(l, v);
    return r;
  };

  const root = document.createElement("div");
  root.setAttribute("dir", "rtl");
  root.style.cssText = [
    "box-sizing:border-box",
    "width:100%",
    "min-height:" + Math.round(widthPx * 1.34) + "px",
    "padding:56px 48px",
    "background:#ffffff",
    "font-family:Vazirmatn, Tahoma, sans-serif",
    "display:flex",
    "flex-direction:column",
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-size:34px;font-weight:800;color:#635bff;margin-bottom:6px;";
  title.textContent = "پروندهٔ مشتری";
  const subtitle = document.createElement("div");
  subtitle.style.cssText = "font-size:15px;color:#8a8aa8;margin-bottom:34px;";
  subtitle.textContent = `بایگانی مدارک — ${dateFa}`;
  root.append(title, subtitle);

  const name = document.createElement("div");
  name.style.cssText =
    "font-size:40px;font-weight:800;color:#1c1c3a;margin-bottom:20px;word-break:break-word;";
  name.textContent = g.customerName;
  root.appendChild(name);

  const card = document.createElement("div");
  card.style.cssText =
    "border:2px solid #eceaff;border-radius:18px;padding:8px 22px;margin-bottom:auto;";
  card.append(
    row("شماره پاسپورت", g.passportNo),
    row("نماینده", g.repName),
    row("کارفرما", g.employerName),
    row("مدارک", `${fa(docs)} فایل`),
    row("ویزاهای صادر شده", `${fa(visas)} فایل`),
  );
  root.appendChild(card);

  host.appendChild(root);
  return rasterize(host);
}

/* ------------------------------ image helpers ----------------------------- */

function isPdfEntry(e: ArchiveEntry): boolean {
  return e.mime === "application/pdf" || /\.pdf$/i.test(e.originalName);
}

function isImageEntry(e: ArchiveEntry): boolean {
  return e.mime.startsWith("image/");
}

/** Decode any image blob to a white-backed canvas (flattens alpha for JPEG). */
async function imageToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/* ------------------------------ the builder ------------------------------- */

export interface CustomerPdfIssue {
  customerName: string;
  message: string;
}

export interface CustomerPdfBuildResult {
  blob: Blob;
  pages: number;
  issues: CustomerPdfIssue[];
}

/** Build ONE customer's dossier PDF (cover + every file, each on its own
 *  page(s)). Never throws for a single bad file — it lands in `issues`.
 *  Throws only when NOTHING could be rendered (caller skips the customer). */
export async function buildCustomerPdf(
  g: CustomerGroup,
  opts: CustomerPdfOptions,
): Promise<CustomerPdfBuildResult> {
  const { jsPDF } = await import("jspdf");
  const q = QUALITY_PRESETS[opts.quality];
  const margin = MARGIN_PT[opts.margin];
  const issues: CustomerPdfIssue[] = [];
  let pages = 0;

  /** the document is created lazily on the first drawn page so its size
   *  always matches reality (no probing, no dead first page) */
  const docRef: { current: InstanceType<typeof jsPDF> | null } = { current: null };

  const newPage = (dims: PageDims): InstanceType<typeof jsPDF> => {
    // jsPDF force-normalizes format arrays per orientation (portrait ⇒ w≤h),
    // so pass the orientation that MATCHES the requested dims — otherwise a
    // landscape page would silently swap back to portrait.
    const orientation = dims.w > dims.h ? "landscape" : "portrait";
    if (docRef.current) {
      docRef.current.addPage([dims.w, dims.h], orientation);
    } else {
      docRef.current = new jsPDF({
        unit: "pt",
        format: [dims.w, dims.h],
        orientation,
        compress: true,
      });
    }
    const doc = docRef.current;
    // explicit white background on every page
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, dims.w, dims.h, "F");
    pages++;
    return doc;
  };

  /** draw an image centered inside the content box, keeping the aspect */
  const drawFitted = (
    doc: InstanceType<typeof jsPDF>,
    canvas: HTMLCanvasElement,
    box: { x: number; y: number; w: number; h: number },
  ) => {
    const k = Math.min(box.w / canvas.width, box.h / canvas.height);
    const w = canvas.width * k;
    const h = canvas.height * k;
    doc.addImage(
      canvas.toDataURL("image/jpeg", q.jpeg),
      "JPEG",
      box.x + (box.w - w) / 2,
      box.y + (box.h - h) / 2,
      w,
      h,
    );
  };

  // yield a macro-task between documents so the UI keeps breathing
  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

  // ---- cover ----
  if (opts.cover) {
    const [w, h] = opts.pageSize === "a5" ? PAGE_FORMATS_PT.a5 : PAGE_FORMATS_PT.a4;
    const coverCanvas = await renderCoverCanvas(g, Math.round((w / 72) * 96));
    const doc = newPage({ w, h });
    drawFitted(doc, coverCanvas, { x: 0, y: 0, w, h });
    await breathe();
  }

  // ---- documents ----
  const captionCache = new Map<string, HTMLCanvasElement>();
  for (const e of g.entries) {
    const label = e.docLabel || e.originalName || "مدرک";
    let canvases: HTMLCanvasElement[];
    if (isPdfEntry(e)) {
      try {
        canvases = await renderPdfPagesToCanvases(e.blob, {
          scale: q.pdfScale,
          maxEdge: q.pdfMaxEdge,
        });
      } catch {
        issues.push({ customerName: g.customerName, message: `«${label}»: خواندن فایل PDF ناموفق بود` });
        continue;
      }
    } else if (isImageEntry(e)) {
      try {
        canvases = [await imageToCanvas(e.blob)];
      } catch {
        issues.push({ customerName: g.customerName, message: `«${label}»: خواندن عکس ناموفق بود` });
        continue;
      }
    } else {
      issues.push({ customerName: g.customerName, message: `«${label}»: فقط عکس و PDF داخل پروندهٔ PDF می‌آید` });
      continue;
    }

    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i];
      const multi = canvases.length > 1;
      const captionText = multi ? `${label} — صفحهٔ ${toPersianDigits(i + 1)} از ${toPersianDigits(canvases.length)}` : label;
      const dims = pageDimsFor(opts, canvas.width, canvas.height, opts.captions);

      let caption: HTMLCanvasElement | null = null;
      if (opts.captions) {
        if (!captionCache.has(captionText)) {
          captionCache.set(captionText, await renderCaptionBand(captionText));
        }
        caption = captionCache.get(captionText)!;
      }

      const doc = newPage(dims);
      const contentW = dims.w - margin * 2;
      const capH = caption ? Math.max(14, (caption.height / caption.width) * contentW) : 0;
      if (caption) {
        doc.addImage(caption.toDataURL("image/jpeg", q.jpeg), "JPEG", margin, margin, contentW, capH);
      }
      drawFitted(doc, canvas, {
        x: margin,
        y: margin + capH + (capH > 0 ? 8 : 0),
        w: contentW,
        h: dims.h - margin * 2 - capH - (capH > 0 ? 8 : 0),
      });
      await breathe();
    }
  }

  const doc = docRef.current;
  if (pages === 0 || !doc) {
    throw new Error("no pages");
  }
  const blob = doc.output("blob");
  return { blob, pages, issues };
}

/* ------------------------------- packaging -------------------------------- */

export interface PdfProgress {
  /** 0..100 across ALL customers. */
  pct: number;
  customerName: string;
}

export interface CustomersPdfResult {
  /** relative paths actually written (folder/name.pdf). */
  files: string[];
  pages: number;
  issues: CustomerPdfIssue[];
}

/** Make paths unique (case-insensitive) with Persian numeric suffixes. */
function uniquify(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.map((p) => {
    let candidate = p;
    let n = 2;
    while (seen.has(candidate.toLowerCase())) {
      const slash = candidate.lastIndexOf("/");
      const dir = slash > 0 ? candidate.slice(0, slash) + "/" : "";
      const name = slash > 0 ? candidate.slice(slash + 1) : candidate;
      const dot = name.lastIndexOf(".");
      candidate = `${dir}${name.slice(0, dot)} ${toPersianDigits(n)}${name.slice(dot)}`;
      n++;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Build every customer PDF and pack them into ONE ZIP Blob. */
export async function buildCustomersPdfZip(
  groups: CustomerGroup[],
  opts: CustomerPdfOptions,
  onProgress?: (p: PdfProgress) => void,
): Promise<{ blob: Blob; result: CustomersPdfResult }> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const files: string[] = [];
  const issues: CustomerPdfIssue[] = [];
  let pages = 0;
  let done = 0;
  const blobs: Blob[] = [];
  for (const g of groups) {
    onProgress?.({ pct: Math.round((done / groups.length) * 90), customerName: g.customerName });
    try {
      const built = await buildCustomerPdf(g, opts);
      issues.push(...built.issues);
      pages += built.pages;
      blobs.push(built.blob);
      files.push(pdfRelativePath(g, opts));
    } catch {
      issues.push({ customerName: g.customerName, message: "هیچ فایل قابل تبدیلی نبود (فقط عکس و PDF)" });
    }
    done++;
  }
  const unique = uniquify(files);
  unique.forEach((path, i) => zip.file(path, blobs[i]));
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } },
    (meta) => onProgress?.({ pct: 90 + Math.round(meta.percent / 10), customerName: "" }),
  );
  return { blob, result: { files: unique, pages, issues } };
}

/* --------------------- real folder via File System Access ------------------ */

interface FsWritable {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface FsFileHandle {
  createWritable: () => Promise<FsWritable>;
}
interface FsDirHandle {
  name: string;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FsDirHandle>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
}

/** MUST be called directly inside a click handler (user-gesture requirement).
 *  Throws DOMException AbortError when the user cancels; returns null when
 *  the API is unsupported (→ caller falls back to ZIP). */
export async function pickPdfDirectory(): Promise<FsDirHandle | null> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: unknown) => Promise<FsDirHandle>;
  };
  if (typeof w.showDirectoryPicker !== "function") return null;
  return w.showDirectoryPicker({ mode: "readwrite" });
}

async function ensureDir(root: FsDirHandle, path: string): Promise<FsDirHandle> {
  let dir = root;
  for (const seg of path.split("/").filter(Boolean)) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  return dir;
}

/** Build every customer PDF and write it into the REAL directory the user
 *  picked (nested representative/employer folders are created as needed). */
export async function writePdfsToDirectory(
  dir: FsDirHandle,
  groups: CustomerGroup[],
  opts: CustomerPdfOptions,
  onProgress?: (p: PdfProgress) => void,
): Promise<CustomersPdfResult> {
  const files: string[] = [];
  const issues: CustomerPdfIssue[] = [];
  let pages = 0;
  let done = 0;
  const taken = new Set<string>();
  for (const g of groups) {
    onProgress?.({ pct: Math.round((done / groups.length) * 100), customerName: g.customerName });
    let built: CustomerPdfBuildResult;
    try {
      built = await buildCustomerPdf(g, opts);
    } catch {
      issues.push({ customerName: g.customerName, message: "هیچ فایل قابل تبدیلی نبود (فقط عکس و PDF)" });
      done++;
      continue;
    }
    issues.push(...built.issues);
    pages += built.pages;
    const rel = pdfRelativePath(g, opts);
    const slash = rel.lastIndexOf("/");
    const folder = slash > 0 ? rel.slice(0, slash) : "";
    let name = slash > 0 ? rel.slice(slash + 1) : rel;
    const target = folder ? `${folder}/${name}` : name;
    let candidate = target;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const renamed = `${name.slice(0, dot)} ${toPersianDigits(n)}${name.slice(dot)}`;
      candidate = folder ? `${folder}/${renamed}` : renamed;
      n++;
    }
    taken.add(candidate.toLowerCase());
    const dirHandle = folder ? await ensureDir(dir, folder) : dir;
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(built.blob);
    await writable.close();
    files.push(candidate);
    done++;
  }
  return { files, pages, issues };
}
