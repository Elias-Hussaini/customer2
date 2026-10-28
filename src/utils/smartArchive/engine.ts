/**
 * Smart Archive engine (بایگانی هوشمند) — a REUSABLE, rule-driven ZIP
 * organization engine. The engine is deliberately separate from the data
 * layer and the UI:
 *
 *   entries  ──buildPlan(options, overrides)──►  plan items  ──generateAndSave──►  ZIP
 *
 *  - File CONTENTS are never modified; only names/destinations are decided.
 *  - Every destination is sanitized + validated (no path traversal, no
 *    illegal characters) and duplicate paths get a Persian numeric suffix —
 *    nothing is ever silently overwritten.
 *  - Manual per-file overrides (rename / move / exclude) are applied on top
 *    of the rules and survive rule changes until explicitly reset.
 *  - Unicode filenames (Persian / Arabic / German / English) are preserved;
 *    JSZip writes the UTF-8 flag so unzippers show them correctly.
 */
import { saveAs } from "file-saver";

/* ------------------------------- types ---------------------------------- */

export type ArchiveFileKind = "issuedVisa" | "doc" | "profilePhoto";

export type FolderMode = "perCustomer" | "single" | "flat";
export type FileNaming = "customerName" | "docLabel" | "sequence" | "original";

/** One candidate file for the archive (original bytes, never mutated). */
export interface ArchiveEntry {
  /** Attachment id (or synthetic id for profile photos). */
  id: string;
  blob: Blob;
  originalName: string;
  mime: string;
  size: number;
  customerId: string;
  customerName: string;
  kind: ArchiveFileKind;
  /** DocType slot id ("passport", "nidFront", custom ids, "other"). */
  docTypeId?: string;
  /** Persian label of the slot («پاسپورت», «id روی», «ویزا», …). */
  docLabel?: string;
}

export interface PlanOptions {
  folderMode: FolderMode;
  /** Custom folder name when folderMode = "single" (e.g. «ویزا های امروز صادر شده»). */
  singleFolderName: string;
  fileNaming: FileNaming;
  /** perCustomer mode: separate «مدارک» / «ویزاها» subfolders inside each customer folder. */
  docSubfolders: boolean;
}

export interface PlanItem {
  entry: ArchiveEntry;
  /** Folder path inside the ZIP ("" = root, "a/b" nested). */
  folder: string;
  /** Final file name including extension. */
  fileName: string;
}

export interface PlanIssue {
  entryId: string;
  /** human-readable Persian explanation */
  message: string;
}

export interface ArchivePlan {
  items: PlanItem[];
  issues: PlanIssue[];
  stats: {
    /** candidate files found for the current scope */
    total: number;
    /** files that will be written into the ZIP */
    included: number;
    /** files explicitly excluded by the user */
    excluded: number;
    /** distinct folders in the plan (root not counted) */
    folders: number;
    /** total bytes of included files */
    bytes: number;
    /** files whose name had to change (collision suffix / sanitize / override) */
    renamed: number;
  };
}

export interface PlanOverride {
  folder?: string;
  fileName?: string;
  excluded?: boolean;
}

/* ---------------------------- sanitization ------------------------------- */

const ILLEGAL = /[\u0000-\u001f<>:"/\\|?*]/g;

function toFaDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** Sanitize ONE path segment (folder or file name) for a ZIP entry. */
export function sanitizeSegment(name: string, fallback: string): string {
  let s = name.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  // Windows unzippers hate trailing dots/spaces; pure ".." escapes the folder.
  s = s.replace(/[.\s]+$/g, "").replace(/^[.\s]+/g, "").trim();
  if (s === "" || s === "." || s === "..") s = fallback;
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s;
}

/** Full-path validation — defense in depth AFTER sanitization. */
export function isValidZipPath(path: string): boolean {
  if (path === "") return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  if (path.includes("//")) return false;
  const segs = path.split("/");
  return segs.every((s) => s !== "" && s !== "." && s !== ".." && !ILLEGAL.test(s));
}

function extOf(name: string, mime: string): string {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

/** Short, clean names for the built-in slots when naming by document type. */
const BUILTIN_DOC_LABELS: Record<string, string> = {
  passport: "پاسپورت",
  nidFront: "id روی",
  nidBack: "id پشت",
  other: "مدرک",
  profilePhoto: "پروفایل",
};

/* ------------------------------ plan build ------------------------------- */

/**
 * Build the archive plan: apply folder/naming rules, layer manual overrides,
 * then make every path unique (Persian numeric suffixes on collision).
 * Pure function — safe to re-run on every keystroke.
 */
export function buildPlan(
  entries: ArchiveEntry[],
  options: PlanOptions,
  overrides: Record<string, PlanOverride> = {},
): ArchivePlan {
  const issues: PlanIssue[] = [];
  const items: PlanItem[] = [];
  let excluded = 0;
  let renamed = 0;

  // sequence numbering runs per customer (all their files, oldest→newest)
  const seqByCustomer = new Map<string, number>();

  for (const e of entries) {
    const ov = overrides[e.id];
    if (ov?.excluded) {
      excluded++;
      continue;
    }
    if (!e.blob || e.blob.size === 0) {
      issues.push({ entryId: e.id, message: "فایل خالی است و نادیده گرفته شد" });
      continue;
    }

    const ext = extOf(ov?.fileName ?? e.originalName, e.mime);
    const customer = sanitizeSegment(e.customerName, "بدون نام");
    // Built-in slots get the user's requested short names (پاسپورت / id روی /
    // id پشت); custom slots use their own label.
    const docLabel = sanitizeSegment(
      BUILTIN_DOC_LABELS[e.docTypeId ?? ""] ?? e.docLabel ?? "مدرک",
      "مدرک",
    );

    // ---- folder rule ----
    let folder: string;
    if (options.folderMode === "flat") {
      folder = "";
    } else if (options.folderMode === "single") {
      folder = sanitizeSegment(options.singleFolderName.trim(), "بایگانی");
    } else {
      folder = customer;
      if (options.docSubfolders) {
        if (e.kind === "doc") folder = `${customer}/مدارک`;
        else if (e.kind === "issuedVisa") folder = `${customer}/ویزاها`;
      }
    }

    // ---- naming rule ----
    let base: string;
    switch (options.fileNaming) {
      case "customerName":
        base = customer;
        break;
      case "docLabel":
        base = e.kind === "issuedVisa" ? "ویزا" : docLabel;
        break;
      case "sequence": {
        const n = (seqByCustomer.get(e.customerId) ?? 0) + 1;
        seqByCustomer.set(e.customerId, n);
        base = toFaDigits(n);
        break;
      }
      case "original":
      default:
        base = sanitizeSegment(e.originalName.replace(/\.[a-z0-9]{1,6}$/i, ""), "فایل");
        break;
    }

    let fileName = `${base}.${ext}`;
    let folderChanged = false;
    let nameChanged = false;

    // ---- manual overrides on top ----
    if (ov?.folder !== undefined) {
      const f = ov.folder.trim().replace(/^\/+|\/+$/g, "");
      const safe = f
        .split("/")
        .map((seg) => sanitizeSegment(seg, "پوشه"))
        .join("/");
      folder = safe;
      folderChanged = true;
    }
    if (ov?.fileName !== undefined && ov.fileName.trim() !== "") {
      const raw = ov.fileName.trim();
      // keep or fix the extension: user may type "علی" or "علی.pdf"
      const withExt = /\.[a-z0-9]{1,6}$/i.test(raw) ? raw : `${raw}.${ext}`;
      const safe = sanitizeSegment(withExt, `فایل.${ext}`);
      fileName = safe;
      nameChanged = true;
    }

    items.push({ entry: e, folder, fileName });
    if (folderChanged || nameChanged) renamed++;
  }

  // ---- collision resolution (case-insensitive full path) ----
  const seen = new Set<string>(); // lowercase paths already taken
  for (const it of items) {
    const path = it.folder ? `${it.folder}/${it.fileName}` : it.fileName;
    let candidate = path;
    let n = 2;
    while (seen.has(candidate.toLowerCase())) {
      const dot = it.fileName.lastIndexOf(".");
      const stem = dot > 0 ? it.fileName.slice(0, dot) : it.fileName;
      const ext = dot > 0 ? it.fileName.slice(dot) : "";
      candidate = it.folder
        ? `${it.folder}/${stem} ${toFaDigits(n)}${ext}`
        : `${stem} ${toFaDigits(n)}${ext}`;
      n++;
    }
    if (candidate !== path) {
      issues.push({
        entryId: it.entry.id,
        message: `نام تکراری — «${path}» به «${candidate}» تغییر کرد (جایگزینی بی‌صدا ممنوع)`,
      });
      it.fileName = candidate.slice(it.folder ? it.folder.length + 1 : 0);
      renamed++;
    }
    seen.add(candidate.toLowerCase());
  }

  // ---- final validation (defense in depth) ----
  for (const it of items) {
    const path = it.folder ? `${it.folder}/${it.fileName}` : it.fileName;
    if (!isValidZipPath(path)) {
      issues.push({ entryId: it.entry.id, message: `مسیر نامعتبر: «${path}» — بازنشانی شد` });
      it.fileName = sanitizeSegment(it.fileName, "فایل.bin");
      it.folder = "";
    }
  }

  const folders = new Set(items.map((i) => i.folder).filter(Boolean));
  return {
    items,
    issues,
    stats: {
      total: entries.length,
      included: items.length,
      excluded,
      folders: folders.size,
      bytes: items.reduce((s, i) => s + i.entry.size, 0),
      renamed,
    },
  };
}

/* ------------------------------ generation ------------------------------- */

function zipPath(it: PlanItem): string {
  return it.folder ? `${it.folder}/${it.fileName}` : it.fileName;
}

interface SaveFilePickerHandle {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

async function pickZipHandle(fileName: string): Promise<SaveFilePickerHandle> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<SaveFilePickerHandle>;
  };
  if (typeof w.showSaveFilePicker !== "function") {
    throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
  }
  return w.showSaveFilePicker({
    suggestedName: fileName,
    types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
  });
}

/**
 * Generate the ZIP (JSZip, DEFLATE, UTF-8 names, progress callback) and save
 * it. Uses the File System Access API (user picks the destination) when
 * available — classic download otherwise. NEVER uploads anything anywhere;
 * everything happens locally in the browser.
 */
export async function generateAndSave(
  items: PlanItem[],
  fileName: string,
  onProgress?: (pct: number) => void,
): Promise<{ via: "picker" | "download" }> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const it of items) {
    zip.file(zipPath(it), it.entry.blob);
  }
  const finalName = `${fileName.replace(/\.zip$/i, "").trim() || "بایگانی"}.zip`;

  // 1) Ask for the destination FIRST (while the click gesture is fresh).
  let handle: SaveFilePickerHandle | null = null;
  try {
    handle = await pickZipHandle(finalName);
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "AbortError") throw e; // user cancelled — no download at all
    handle = null; // unsupported / no gesture → classic download below
  }

  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => onProgress?.(Math.min(100, Math.round(meta.percent))),
  );

  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { via: "picker" };
    } catch (e) {
      console.warn("picker write failed, falling back to download", e);
    }
  }
  saveAs(blob, finalName);
  return { via: "download" };
}

/** Format bytes as a Persian, human-readable size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "۰";
  if (bytes < 1024) return `${toFaDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toFaDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  if (bytes < 1024 * 1024 * 1024) return `${toFaDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
  return `${toFaDigits((bytes / (1024 * 1024 * 1024)).toFixed(2))} گیگابایت`;
}
