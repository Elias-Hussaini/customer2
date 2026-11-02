/**
 * ImageEditor — the heart of «ابزار عکس».
 *
 * Pipeline: an offscreen HTMLCanvasElement holds the working image at its
 * natural resolution. Every operation (crop / resize / rotate / flip /
 * adjustments) produces a NEW canvas which is pushed onto a bounded history
 * stack (undo/redo); the on-screen preview is a data-URL <img> with staged
 * CSS filters for the live adjustments preview — nothing is re-encoded
 * until the user saves or downloads.
 *
 * Output settings (format / quality / long-edge cap) only affect the final
 * encode; the live size estimate re-encodes (debounced) so «فشرده‌سازی
 * فوق‌العاده قوی» shows exactly what it will produce.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  FolderPlus,
  ImageDown,
  MoveHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scaling,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDropTarget, useFilesDragging } from "../ui/DropZone";
import { useStudioFolders } from "../../hooks/useData";
import { Button } from "../ui/Button";
import { useToast } from "../../hooks/useToast";
import {
  DEFAULT_ADJUSTMENTS,
  OUTPUT_FORMATS,
  adjustmentsToFilter,
  applyAdjustments,
  applyCrop,
  applyFineRotate,
  applyFlip,
  applyResize,
  applyRotate90,
  canvasFromBitmap,
  canvasToPreviewUrl,
  clampSel,
  encodeCanvas,
  extForFormat,
  fitRatio,
  humanBytes,
  isDefaultAdjustments,
  retargetExt,
  savingsPct,
  selToRect,
  type Adjustments,
  type OutputFormat,
} from "../../lib/studio/canvas";
import type { StudioSource } from "../../lib/studio/session";
import { loadStudioPrefs, saveStudioPrefs } from "../../lib/studio/prefs";

const CROP_PRESETS: { key: string; label: string; ratio: number | null }[] = [
  { key: "free", label: "آزاد", ratio: null },
  { key: "square", label: "۱:۱", ratio: 1 },
  { key: "landscape", label: "۴:۳", ratio: 4 / 3 },
  { key: "wide", label: "۱۶:۹", ratio: 16 / 9 },
  { key: "portrait", label: "۳:۴", ratio: 3 / 4 },
  { key: "passport", label: "پاسپورتی ۳۵:۴۵", ratio: 35 / 45 },
];

const MAX_HISTORY = 24;

type Sel = { x: number; y: number; w: number; h: number };

interface OutputSettings {
  format: OutputFormat;
  quality: number; // 0.3..1
  maxEdge: number; // 0 = unchanged
}

/** Output defaults come from the remembered prefs (JPEG first run — «پیشفرض
 *  jpg، نه webp» — and the user's last format/quality/max-edge afterwards). */
const fallbackOutput = (): OutputSettings => {
  const p = loadStudioPrefs();
  return { format: p.format, quality: p.quality, maxEdge: p.maxEdge };
};

const MAXEDGE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "بدون تغییر" },
  { value: 2000, label: "حداکثر ۲۰۰۰px" },
  { value: 1600, label: "حداکثر ۱۶۰۰px" },
  { value: 1200, label: "حداکثر ۱۲۰۰px" },
  { value: 800, label: "حداکثر ۸۰۰px" },
  { value: 600, label: "حداکثر ۶۰۰px" },
];

export interface EditorSaveTargets {
  /** Save into the in-app library (folders). */
  onOpenLibraryTab: () => void;
  /** A PDF was dropped/picked/pasted — hand it to the quick-convert board
   *  (تبدیل سریع) which splits it into editable page images. */
  onForwardPdfs?: (files: File[]) => void;
}

/** A file the editor treats as a PDF (by mime or extension). */
function isPdfFile(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

export function ImageEditor({
  source,
  onClearSource,
  librarySlot,
}: {
  source: StudioSource | null;
  onClearSource: () => void;
  librarySlot: EditorSaveTargets;
}) {
  const toast = useToast();
  const navigate = useNavigate();

  /* ------------------------------ core state ------------------------------ */

  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<HTMLCanvasElement[]>([]);
  const [redoStack, setRedoStack] = useState<HTMLCanvasElement[]>([]);
  const current = history.length > 0 ? history[history.length - 1] : null;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("image");
  const [sourceBytes, setSourceBytes] = useState<number | null>(null);
  /** Where this image came from — enables «ذخیره در پرونده» (in-place). */
  const [origin, setOrigin] = useState<StudioSource | null>(null);

  // crop
  const [cropMode, setCropMode] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [preset, setPreset] = useState("free");

  // resize panel
  const [wInput, setWInput] = useState("");
  const [hInput, setHInput] = useState("");
  const [lockRatio, setLockRatio] = useState(true);

  // fine rotate
  const [fineAngle, setFineAngle] = useState(0);

  // adjustments
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);

  // output
  const [output, setOutput] = useState<OutputSettings>(fallbackOutput);
  const [estimate, setEstimate] = useState<{ bytes: number } | null>(null);
  const [estimating, setEstimating] = useState(false);

  // save-to-library dialog
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveFolder, setSaveFolder] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: "new" | "move" | "resize"; handle: string; startX: number; startY: number; startSel: Sel } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ------------------------------ loading --------------------------------- */

  const loadBlob = useCallback(async (blob: Blob, name: string, src: StudioSource | null, bytes?: number) => {
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = canvasFromBitmap(bitmap);
      bitmap.close();
      setOriginal(canvas);
      setHistory([canvas]);
      setRedoStack([]);
      setSourceName(name);
      setSourceBytes(bytes ?? blob.size);
      setOrigin(src);
      setAdjust(DEFAULT_ADJUSTMENTS);
      setCropMode(false);
      setSel(null);
      setPreset("free");
      setFineAngle(0);
      setWInput(String(canvas.width));
      setHInput(String(canvas.height));
      setSaveName(retargetExt(name, output.format));
      setPreviewUrl(canvasToPreviewUrl(canvas));
    } catch {
      toast.error("این فایل به‌عنوان تصویر باز نمی‌شود");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Consume the incoming source.
  useEffect(() => {
    if (!source) return;
    if (source.kind === "attachment") {
      void loadBlob(source.attachment.blob, source.attachment.name, source, source.attachment.size);
    } else if (source.kind === "library") {
      void loadBlob(source.image.blob, source.image.name, source, source.image.size);
    } else if (source.kind === "photo") {
      // عکس پروفایل — a data URL: fetch it back into a Blob and load that.
      void (async () => {
        try {
          const res = await fetch(source.photo);
          const blob = await res.blob();
          await loadBlob(blob, `${source.name} — عکس پروفایل`, source, blob.size);
        } catch {
          toast.error("خواندن عکس پروفایل ناموفق بود");
        }
      })();
    } else if (source.kind === "files" && source.files.length > 0) {
      const pdfs = source.files.filter(isPdfFile);
      if (pdfs.length > 0) {
        // PDFs can't be edited directly — forward to تبدیل سریع.
        librarySlot.onForwardPdfs?.(pdfs);
        const images = source.files.filter((f) => !isPdfFile(f));
        if (images.length > 0) void loadBlob(images[0], images[0].name, null, images[0].size);
      } else {
        void loadBlob(source.files[0], source.files[0].name, null, source.files[0].size);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Drop / paste anywhere on the editor.
  const dragging = useFilesDragging();
  const drop = useDropTarget((files) => {
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length > 0) {
      librarySlot.onForwardPdfs?.(pdfs);
      const image = files.find((f) => f.type.startsWith("image/"));
      if (image) void loadBlob(image, image.name, null, image.size);
      return;
    }
    const image = files.find((f) => f.type.startsWith("image/"));
    if (image) void loadBlob(image, image.name, null, image.size);
    else toast.error("فقط تصویر و PDF قابل استفاده است");
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const all = Array.from(e.clipboardData?.files ?? []);
      const pdfs = all.filter(isPdfFile);
      if (pdfs.length > 0) {
        librarySlot.onForwardPdfs?.(pdfs);
        return;
      }
      const file = all.find((f) => f.type.startsWith("image/"));
      if (file) void loadBlob(file, file.name || "pasted.png", null, file.size);
    };
    window.addEventListener("paste", onPaste as EventListener);
    return () => window.removeEventListener("paste", onPaste as EventListener);
  }, [loadBlob]);

  /* ------------------------------ history --------------------------------- */

  const push = (next: HTMLCanvasElement) => {
    setHistory((h) => {
      const trimmed = [...h, next];
      return trimmed.length > MAX_HISTORY ? trimmed.slice(trimmed.length - MAX_HISTORY) : trimmed;
    });
    setRedoStack([]);
    setPreviewUrl(canvasToPreviewUrl(next));
    setWInput(String(next.width));
    setHInput(String(next.height));
    setSel(null);
    setEstimate(null);
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length < 2) return h;
      const last = h[h.length - 1];
      setRedoStack((r) => [...r, last]);
      const next = h.slice(0, -1);
      setPreviewUrl(canvasToPreviewUrl(next[next.length - 1]));
      setWInput(String(next[next.length - 1].width));
      setHInput(String(next[next.length - 1].height));
      setSel(null);
      setEstimate(null);
      return next;
    });
  };

  const redo = () => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setHistory((h) => [...h, next]);
      setPreviewUrl(canvasToPreviewUrl(next));
      setWInput(String(next.width));
      setHInput(String(next.height));
      setSel(null);
      setEstimate(null);
      return r.slice(0, -1);
    });
  };

  const reset = () => {
    if (!original) return;
    setHistory([original]);
    setRedoStack([]);
    setPreviewUrl(canvasToPreviewUrl(original));
    setWInput(String(original.width));
    setHInput(String(original.height));
    setAdjust(DEFAULT_ADJUSTMENTS);
    setSel(null);
    setCropMode(false);
    setFineAngle(0);
    setEstimate(null);
  };

  /* ------------------------------ operations ------------------------------ */

  const applySelCrop = () => {
    if (!current || !sel) return;
    try {
      push(applyCrop(current, selToRect(sel, current.width, current.height)));
      setCropMode(false);
      toast.success("برش اعمال شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "برش ناموفق بود");
    }
  };

  const applyResizeInputs = () => {
    if (!current) return;
    const w = Number(wInput.replace(/[^\d]/g, ""));
    let h = Number(hInput.replace(/[^\d]/g, ""));
    if (!w || !h) {
      if (lockRatio && w && current.width) {
        const r = fitRatio(w, null, current.width / current.height);
        h = r.h;
      }
      if (!w || !h) {
        toast.error("عرض و ارتفاع را به پیکسل وارد کنید");
        return;
      }
    }
    if (lockRatio && w && h) {
      const fitted = fitRatio(w, null, current.width / current.height);
      h = fitted.h;
      setHInput(String(h));
    }
    if (w < 4 || h < 4) {
      toast.error("حداقل ۴ پیکسل");
      return;
    }
    push(applyResize(current, w, h));
    toast.success(`سایز به ${w}×${h} تغییر کرد`);
  };

  const onWChange = (v: string) => {
    setWInput(v);
    if (lockRatio && current && v) {
      const w = Number(v.replace(/[^\d]/g, ""));
      if (w > 0) setHInput(String(Math.round(w / (current.width / current.height))));
    }
  };
  const onHChange = (v: string) => {
    setHInput(v);
    if (lockRatio && current && v) {
      const h = Number(v.replace(/[^\d]/g, ""));
      if (h > 0) setWInput(String(Math.round(h * (current.width / current.height))));
    }
  };

  const quickScale = (pct: number) => {
    if (!current) return;
    const w = Math.max(1, Math.round((current.width * pct) / 100));
    const h = Math.max(1, Math.round((current.height * pct) / 100));
    push(applyResize(current, w, h));
    toast.success(`سایز به ${w}×${h} تغییر کرد`);
  };

  const rotate = (dir: 1 | -1) => current && push(applyRotate90(current, dir));
  const flip = (axis: "h" | "v") => current && push(applyFlip(current, axis));

  const applyFine = () => {
    if (!current || Math.abs(fineAngle) < 0.5) return;
    push(applyFineRotate(current, fineAngle));
    setFineAngle(0);
    toast.success("چرخش دقیق اعمال شد");
  };

  const bakeAdjust = () => {
    if (!current || isDefaultAdjustments(adjust)) return;
    push(applyAdjustments(current, adjust));
    setAdjust(DEFAULT_ADJUSTMENTS);
    toast.success("تنظیمات در تصویر اعمال شد");
  };

  /* ---------------------- remembered preferences -------------------------- */

  // Every output change is remembered (device-level) so the next session
  // starts exactly where this one ended — «از اول همهٔ تنظیمات رو انجام بدم» نه.
  useEffect(() => {
    saveStudioPrefs({
      format: output.format,
      quality: output.quality,
      maxEdge: output.maxEdge,
    });
  }, [output]);

  /* ------------------------------ output estimate ------------------------- */

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        let work = current;
        if (output.maxEdge > 0) {
          const long = Math.max(work.width, work.height);
          if (long > output.maxEdge) {
            const scale = output.maxEdge / long;
            work = applyResize(work, Math.round(work.width * scale), Math.round(work.height * scale));
          }
        }
        const blob = await encodeCanvas(work, output.format, output.quality);
        if (!cancelled) setEstimate({ bytes: blob.size });
      } catch {
        if (!cancelled) setEstimate(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setEstimating(false);
    };
  }, [current, output]);

  const encodeFinal = async (): Promise<{ blob: Blob; width: number; height: number; mime: OutputFormat } | null> => {
    if (!current) return null;
    let work = current;
    if (output.maxEdge > 0) {
      const long = Math.max(work.width, work.height);
      if (long > output.maxEdge) {
        const scale = output.maxEdge / long;
        work = applyResize(work, Math.round(work.width * scale), Math.round(work.height * scale));
      }
    }
    const blob = await encodeCanvas(work, output.format, output.quality);
    return { blob, width: work.width, height: work.height, mime: output.format };
  };

  const download = async (fmt?: OutputFormat) => {
    if (!current) return;
    const prevFormat = output.format;
    if (fmt && fmt !== prevFormat) setOutput((o) => ({ ...o, format: fmt }));
    const useFmt = fmt ?? output.format;
    try {
      let work = current;
      if (output.maxEdge > 0) {
        const long = Math.max(work.width, work.height);
        if (long > output.maxEdge) {
          const scale = output.maxEdge / long;
          work = applyResize(work, Math.round(work.width * scale), Math.round(work.height * scale));
        }
      }
      const blob = await encodeCanvas(work, useFmt, output.quality);
      const { saveAs } = await import("file-saver");
      saveAs(blob, retargetExt(sourceName, useFmt as OutputFormat));
      toast.success("دانلود شد");
    } catch (e) {
      console.error(e);
      toast.error("خروجی گرفتن ناموفق بود");
    }
  };

  /* --------------------------- in-place save (profile) --------------------- */

  const saveInPlace = async () => {
    if (!current) return;
    if (origin?.kind === "attachment") {
      const att = origin.attachment;
      if (!att.mime.startsWith("image/")) return;
      const { replaceAttachmentBlob } = await import("../../db/attachments");
      const final = await encodeFinal();
      if (!final) return;
      await replaceAttachmentBlob(att.id, {
        blob: final.blob,
        mime: final.mime,
        name: retargetExt(att.name, final.mime),
      });
      toast.success("در پرونده ذخیره شد — همان سند جایگزین شد");
      return;
    }
    if (origin?.kind === "photo") {
      // عکس پروفایل: square-crop the result exactly like every avatar, then
      // write it back onto the record (survives JSON backups like all photos).
      const final = await encodeFinal();
      if (!final) return;
      try {
        const { dataUrlToSquareDataUrl, setCustomerPhoto, setRepresentativePhoto, setEmployerPhoto } =
          await import("../../db/photos");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(final.blob);
        });
        const square = await dataUrlToSquareDataUrl(dataUrl);
        if (origin.entity === "customer") await setCustomerPhoto(origin.id, square, origin.name);
        else if (origin.entity === "rep") await setRepresentativePhoto(origin.id, square, origin.name);
        else await setEmployerPhoto(origin.id, square, origin.name);
        toast.success("عکس پروفایل ویرایش و ذخیره شد");
      } catch (e) {
        console.error(e);
        toast.error("ذخیره عکس پروفایل ناموفق بود");
      }
      return;
    }
    if (origin?.kind === "library") {
      const img = origin.image;
      const { replaceStudioImage } = await import("../../db/studio");
      const final = await encodeFinal();
      if (!final) return;
      await replaceStudioImage(img.id, {
        blob: final.blob,
        mime: final.mime,
        width: final.width,
        height: final.height,
      });
      toast.success("در کتابخانه ذخیره شد — همان تصویر جایگزین شد");
    }
  };

  /* ------------------------------ save to library -------------------------- */

  /** Open the save dialog with the last-used folder preselected (if it still
   *  exists — a deleted folder falls back to سایر). */
  const folders = useStudioFolders() ?? [];
  const openSaveDialog = () => {
    const last = loadStudioPrefs().lastFolderId;
    setSaveFolder(last && folders.some((f) => f.id === last) ? last : null);
    setSaveOpen(true);
  };

  const doSaveToLibrary = async () => {
    if (!current) return;
    const final = await encodeFinal();
    if (!final) return;
    const { saveStudioImage } = await import("../../db/studio");
    await saveStudioImage({
      folderId: saveFolder,
      name: saveName.trim() || retargetExt(sourceName, final.mime),
      mime: final.mime,
      blob: final.blob,
      width: final.width,
      height: final.height,
    });
    toast.success("در کتابخانهٔ ابزار عکس ذخیره شد");
    saveStudioPrefs({ lastFolderId: saveFolder });
    setSaveOpen(false);
    librarySlot.onOpenLibraryTab();
  };

  /* ------------------------------ crop overlay ----------------------------- */

  const ratio = CROP_PRESETS.find((p) => p.key === preset)?.ratio ?? null;

  const applyPreset = (key: string) => {
    setPreset(key);
    const r = CROP_PRESETS.find((p) => p.key === key)?.ratio ?? null;
    if (r && sel) {
      // keep width, derive height from ratio; clamp.
      const next = clampSel({ ...sel, h: sel.w / r });
      setSel(next);
    }
  };

  const ptToFraction = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const onOverlayDown = (e: React.PointerEvent) => {
    if (!cropMode) return;
    const p = ptToFraction(e);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (sel) {
      const handles = handlePositions(sel);
      const near = handles.find(
        (h) => Math.abs(h.x - p.x) < 0.035 && Math.abs(h.y - p.y) < 0.035,
      );
      if (near) {
        dragRef.current = { mode: "resize", handle: near.key, startX: p.x, startY: p.y, startSel: sel };
        return;
      }
      if (p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h) {
        dragRef.current = { mode: "move", handle: "", startX: p.x, startY: p.y, startSel: sel };
        return;
      }
    }
    dragRef.current = { mode: "new", handle: "", startX: p.x, startY: p.y, startSel: { x: p.x, y: p.y, w: 0, h: 0 } };
    setSel(clampSel({ x: p.x, y: p.y, w: 0.02, h: 0.02 }));
  };

  const onOverlayMove = (e: React.PointerEvent) => {
    if (!cropMode || !dragRef.current) return;
    const d = dragRef.current;
    const p = ptToFraction(e);
    if (d.mode === "new") {
      const x = Math.min(d.startX, p.x);
      const y = Math.min(d.startY, p.y);
      let w = Math.abs(p.x - d.startX);
      let h = Math.abs(p.y - d.startY);
      if (ratio) {
        // shape to ratio while dragging: fit inside the drag box.
        if (w / h > ratio) w = h * ratio;
        else h = w / ratio;
      }
      setSel(clampSel({ x, y, w: Math.max(w, 0.03), h: Math.max(h, 0.03) }));
    } else if (d.mode === "move") {
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      const next = { ...d.startSel };
      next.x = Math.min(Math.max(d.startSel.x + dx, 0), 1 - d.startSel.w);
      next.y = Math.min(Math.max(d.startSel.y + dy, 0), 1 - d.startSel.h);
      setSel(next);
    } else if (d.mode === "resize") {
      const s = { ...d.startSel };
      const h = d.handle;
      if (h.includes("w")) {
        const right = s.x + s.w;
        const nx = Math.min(Math.max(p.x, 0), right - 0.04);
        s.w = right - nx;
        s.x = nx;
      }
      if (h.includes("e")) {
        s.w = Math.min(Math.max(p.x - s.x, 0.04), 1 - s.x);
      }
      if (h.includes("n")) {
        const bottom = s.y + s.h;
        const ny = Math.min(Math.max(p.y, 0), bottom - 0.04);
        s.h = bottom - ny;
        s.y = ny;
      }
      if (h.includes("s")) {
        s.h = Math.min(Math.max(p.y - s.y, 0.04), 1 - s.y);
      }
      if (ratio) {
        // keep ratio: derive height from width (anchor: top-left).
        s.h = Math.min(s.w / ratio, 1 - s.y);
        s.w = Math.min(s.h * ratio, 1 - s.x);
      }
      setSel(clampSel(s));
    }
  };

  const onOverlayUp = () => {
    dragRef.current = null;
  };

  /* ------------------------------ render ---------------------------------- */

  const fmtOptions = OUTPUT_FORMATS;
  const activeEstimate = estimate?.bytes ?? null;
  const savingPctVsOriginal =
    sourceBytes && activeEstimate ? savingsPct(sourceBytes, activeEstimate) : null;

  return (
    <div
      className="flex flex-col gap-4"
      {...(dragging ? drop.dropHandlers : {})}
      onPaste={(e) => {
        const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (file) void loadBlob(file, file.name || "pasted.png", null, file.size);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length === 0) return;
          const pdfs = files.filter(isPdfFile);
          if (pdfs.length > 0) librarySlot.onForwardPdfs?.(pdfs);
          const image = files.find((f) => !isPdfFile(f));
          if (image) void loadBlob(image, image.name, null, image.size);
        }}
      />

      {!current ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-dashed border-ink-900/15 px-6 py-14 text-center dark:border-white/15">
          <Wand2 size={34} className="text-brand-400" />
          <p className="text-[15px] font-extrabold">یک تصویر بکشید و رها کنید</p>
          <p className="max-w-sm text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            یا بچسبانید (Ctrl+V)، یا از کتابخانه باز کنید — برش، سایز پیکسلی، چرخش، فشرده‌سازی و هر
            چیزی که یک ویرایشگر حرفه‌ای لازم دارد، همین‌جاست.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={Upload} onClick={() => fileRef.current?.click()}>
              انتخاب تصویر
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* preview + crop overlay */}
          <div className="glass relative overflow-hidden rounded-3xl p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-extrabold">{sourceName}</p>
                <p className="num text-[11px] text-ink-500 dark:text-ink-400" dir="ltr">
                  {current.width}×{current.height}
                  {sourceBytes ? ` • ${humanBytes(sourceBytes)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-glass btn-sm" onClick={undo} disabled={history.length < 2} title="واگرد">
                  <Undo2 size={14} />
                </button>
                <button className="btn btn-glass btn-sm" onClick={redo} disabled={redoStack.length === 0} title="از نو">
                  <Redo2 size={14} />
                </button>
                <button className="btn btn-glass btn-sm" onClick={reset} title="بازنشانی به اصلی">
                  <RotateCcw size={14} />
                </button>
                <button
                  className="btn btn-glass btn-sm"
                  onClick={() => {
                    onClearSource();
                    setHistory([]);
                    setOriginal(null);
                    setPreviewUrl(null);
                  }}
                >
                  <X size={14} /> تصویر جدید
                </button>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={previewUrl ?? undefined}
                  alt={sourceName}
                  className="max-h-[52vh] w-auto max-w-full rounded-2xl"
                  style={{ filter: adjustmentsToFilter(adjust) }}
                  draggable={false}
                />
                {cropMode && (
                  <div
                    ref={overlayRef}
                    className="absolute inset-0 touch-none"
                    style={{ cursor: "crosshair" }}
                    onPointerDown={onOverlayDown}
                    onPointerMove={onOverlayMove}
                    onPointerUp={onOverlayUp}
                    onPointerCancel={onOverlayUp}
                  >
                    {sel && (
                      <>
                        <div
                          className="absolute rounded-[10px] border-2 border-brand-500 bg-brand-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
                          style={{
                            left: `${sel.x * 100}%`,
                            top: `${sel.y * 100}%`,
                            width: `${sel.w * 100}%`,
                            height: `${sel.h * 100}%`,
                          }}
                        >
                          {handlePositions(sel).map((h) => (
                            <span
                              key={h.key}
                              className="absolute h-4 w-4 rounded-full border-2 border-white bg-brand-500 shadow"
                              style={{
                                left: `calc(${h.fx * 100}% - 8px)`,
                                top: `calc(${h.fy * 100}% - 8px)`,
                                cursor: h.cursor,
                              }}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {cropMode && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-500/8 px-3 py-2.5">
                <Crop size={15} className="text-brand-600 dark:text-brand-300" />
                <div className="flex flex-wrap gap-1">
                  {CROP_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      className={`chip !px-2.5 !py-1 !text-[11px] ${preset === p.key ? "" : "chip-soft"}`}
                      onClick={() => applyPreset(p.key)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                <button className="btn btn-ghost btn-sm" onClick={() => { setCropMode(false); setSel(null); }}>
                  لغو
                </button>
                <Button size="sm" variant="primary" onClick={applySelCrop} disabled={!sel}>
                  برش بزن
                </Button>
              </div>
            )}
          </div>

          {/* toolbar sections */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Section icon={Crop} title="برش و سایز">
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`btn btn-sm ${cropMode ? "btn-primary" : "btn-glass"}`}
                  onClick={() => setCropMode((v) => !v)}
                >
                  <Crop size={14} /> {cropMode ? "در حال انتخاب…" : "انتخاب ناحیه"}
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => quickScale(50)} title="نصف سایز">
                  <Scaling size={14} /> ۵۰٪
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => quickScale(25)} title="یک‌چهارم">
                  <Scaling size={14} /> ۲۵٪
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">
                  عرض (px)
                  <input
                    className="field num !w-24 text-center"
                    dir="ltr"
                    inputMode="numeric"
                    value={wInput}
                    onChange={(e) => onWChange(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">
                  ارتفاع (px)
                  <input
                    className="field num !w-24 text-center"
                    dir="ltr"
                    inputMode="numeric"
                    value={hInput}
                    onChange={(e) => onHChange(e.target.value)}
                  />
                </label>
                <button
                  className={`chip !px-2.5 !py-1.5 !text-[11px] ${lockRatio ? "" : "chip-soft"}`}
                  onClick={() => setLockRatio((v) => !v)}
                  title={lockRatio ? "قفل نسبت فعال" : "نسبت آزاد"}
                >
                  <MoveHorizontal size={12} className={lockRatio ? "text-brand-600" : ""} />
                  {lockRatio ? "نسبت قفل" : "نسبت آزاد"}
                </button>
                <Button size="sm" variant="primary" onClick={applyResizeInputs}>
                  تغییر سایز
                </Button>
              </div>
            </Section>

            <Section icon={RotateCw} title="چرخش و آینه">
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-glass btn-sm" onClick={() => rotate(-1)} title="۹۰ درجه چپ">
                  <RotateCcw size={14} /> چپ
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => rotate(1)} title="۹۰ درجه راست">
                  <RotateCw size={14} /> راست
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => flip("h")} title="آینه افقی">
                  <FlipHorizontal size={14} />
                </button>
                <button className="btn btn-glass btn-sm" onClick={() => flip("v")} title="آینه عمودی">
                  <FlipVertical size={14} />
                </button>
              </div>
              <div className="mt-3 flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">
                  چرخش دقیق: {fineAngle}°
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={0.5}
                    value={fineAngle}
                    onChange={(e) => setFineAngle(Number(e.target.value))}
                    className="accent-brand-500"
                  />
                </label>
                <Button size="sm" variant="glass" onClick={applyFine} disabled={Math.abs(fineAngle) < 0.5}>
                  اعمال
                </Button>
              </div>
            </Section>

            <Section icon={SlidersHorizontal} title="تنظیم تصویر">
              <div className="flex flex-col gap-2.5">
                <Range
                  label="روشنایی"
                  value={adjust.brightness}
                  min={40}
                  max={180}
                  onChange={(v) => setAdjust((a) => ({ ...a, brightness: v }))}
                />
                <Range
                  label="کنتراست"
                  value={adjust.contrast}
                  min={40}
                  max={180}
                  onChange={(v) => setAdjust((a) => ({ ...a, contrast: v }))}
                />
                <Range
                  label="اشباع رنگ"
                  value={adjust.saturation}
                  min={0}
                  max={200}
                  onChange={(v) => setAdjust((a) => ({ ...a, saturation: v }))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={`chip !py-1.5 !text-[11px] ${adjust.grayscale ? "" : "chip-soft"}`}
                    onClick={() => setAdjust((a) => ({ ...a, grayscale: !a.grayscale }))}
                  >
                    سیاه‌وسفید
                  </button>
                  <button
                    className="btn btn-glass btn-sm"
                    onClick={() => setAdjust(DEFAULT_ADJUSTMENTS)}
                    disabled={isDefaultAdjustments(adjust)}
                  >
                    بازنشانی
                  </button>
                  <Button size="sm" variant="primary" onClick={bakeAdjust} disabled={isDefaultAdjustments(adjust)}>
                    اعمال در تصویر
                  </Button>
                </div>
                <p className="text-[10.5px] leading-5 text-ink-400">
                  پیش‌نمایش همین لحظه روی تصویر اعمال می‌شود؛ «اعمال در تصویر» آن را دائمی می‌کند (قابل واگرد).
                </p>
              </div>
            </Section>

            <Section icon={Sparkles} title="فشرده‌سازی و خروجی">
              <div className="flex flex-wrap gap-1.5">
                {fmtOptions.map((f) => (
                  <button
                    key={f.value}
                    className={`chip !px-3 !py-1.5 !text-[11px] ${output.format === f.value ? "" : "chip-soft"}`}
                    onClick={() => setOutput((o) => ({ ...o, format: f.value }))}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-[11px] font-bold text-ink-500 dark:text-ink-400">
                کیفیت: {Math.round(output.quality * 100)}٪
                <input
                  type="range"
                  min={30}
                  max={100}
                  step={1}
                  value={Math.round(output.quality * 100)}
                  onChange={(e) => setOutput((o) => ({ ...o, quality: Number(e.target.value) / 100 }))}
                  className="mt-1 w-full accent-brand-500"
                />
              </label>
              <label className="mt-2 block text-[11px] font-bold text-ink-500 dark:text-ink-400">
                حداکثر ضلع
                <select
                  className="field mt-1"
                  value={output.maxEdge}
                  onChange={(e) => setOutput((o) => ({ ...o, maxEdge: Number(e.target.value) }))}
                >
                  {MAXEDGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-500/8 px-3 py-2.5 text-[12px]">
                <ImageDown size={15} className="text-brand-600 dark:text-brand-300" />
                {estimating ? (
                  <span className="text-ink-400">در حال برآورد…</span>
                ) : activeEstimate != null ? (
                  <span className="num font-bold">
                    {humanBytes(activeEstimate)}
                    {savingPctVsOriginal != null && savingPctVsOriginal > 0
                      ? ` (${savingPctVsOriginal}٪ کوچک‌تر از اصلی)`
                      : savingPctVsOriginal != null && savingPctVsOriginal < 0
                        ? " (بزرگ‌تر از اصلی — کیفیت را کم کنید)"
                        : ""}
                  </span>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </div>
            </Section>
          </div>

          {/* action bar */}
          <div className="glass sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-3xl px-3.5 py-3">
            <Button size="sm" variant="primary" icon={Save} onClick={openSaveDialog}>
              ذخیره در کتابخانه
            </Button>
            <span className="mx-1 hidden h-6 w-px bg-ink-900/10 dark:bg-white/10 sm:block" />
            <span className="flex items-center gap-1">
              {fmtOptions.map((f) => (
                <button
                  key={f.value}
                  className="chip !px-2.5 !py-1.5 !text-[11px]"
                  title={`دانلود ${f.label}`}
                  onClick={() => void download(f.value)}
                >
                  <ImageDown size={12} /> {f.label}
                </button>
              ))}
            </span>
            <span className="flex-1" />
            {origin && (
              <Button size="sm" variant="glass" icon={FolderPlus} onClick={() => void saveInPlace()}>
                {origin.kind === "attachment"
                  ? "ذخیره در پرونده"
                  : origin.kind === "photo"
                    ? "ذخیره عکس پروفایل"
                    : "ذخیره روی همان تصویر"}
              </Button>
            )}
          </div>

          {/* save-to-library dialog */}
          {saveOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm">
              <div className="glass w-full max-w-sm rounded-3xl p-5">
                <p className="mb-3 text-[14px] font-extrabold">ذخیره در کتابخانهٔ ابزار عکس</p>
                <label className="mb-3 block text-[11px] font-bold text-ink-500 dark:text-ink-400">
                  نام تصویر
                  <input
                    className="field mt-1"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="مثلاً پاسپورت — صفحهٔ اول"
                  />
                </label>
                <SaveFolderPicker value={saveFolder} onChange={setSaveFolder} />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSaveOpen(false)}>
                    انصراف
                  </button>
                  <Button size="sm" variant="primary" onClick={() => void doSaveToLibrary()}>
                    ذخیره
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ small parts ------------------------------ */

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Crop;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="glass rounded-3xl p-4">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-extrabold">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Icon size={15} />
        </span>
        {title}
      </p>
      {children}
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-[11px] font-bold text-ink-500 dark:text-ink-400">
      {label}: <span className="num">{value}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-brand-500"
      />
    </label>
  );
}

function handlePositions(sel: Sel): { key: string; x: number; y: number; fx: number; fy: number; cursor: string }[] {
  return [
    { key: "nw", x: sel.x, y: sel.y, fx: 0, fy: 0, cursor: "nwse-resize" },
    { key: "ne", x: sel.x + sel.w, y: sel.y, fx: 100, fy: 0, cursor: "nesw-resize" },
    { key: "sw", x: sel.x, y: sel.y + sel.h, fx: 0, fy: 100, cursor: "nesw-resize" },
    { key: "se", x: sel.x + sel.w, y: sel.y + sel.h, fx: 100, fy: 100, cursor: "nwse-resize" },
  ];
}

/** Folder selector used by the save dialog. */
function SaveFolderPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const folders = useStudioFolders() ?? [];
  return (
    <label className="block text-[11px] font-bold text-ink-500 dark:text-ink-400">
      پوشه
      <select
        className="field mt-1"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">سایر (بدون پوشه)</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
