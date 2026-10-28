import { useEffect, useRef, useState } from "react";
import { FileImage, FileText, UploadCloud } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Drag & drop utilities — the shared plumbing behind every drop surface
 * (customer profile documents, payment receipts, accounting attachments…).
 *
 * - `hasDragFiles` separates real file drags from text/element drags.
 * - `useFilesDragging` watches the whole window: it drives the full-screen
 *   drop overlay AND acts as a navigation guard (a file dropped in the wrong
 *   place can never make the browser tab leave the app).
 * - `useDropTarget` turns any element into a highlighted drop zone; the
 *   nearest target always wins (drop stops propagation).
 * - `FileDropOverlay` is the big, beautiful "رها کنید" screen (pure visual,
 *   pointer-events: none, so precise drops still reach the slot under it).
 */

/** True when a drag event carries actual files (not text / page elements). */
export function hasDragFiles(e: { dataTransfer?: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

/**
 * True while files are dragged anywhere over the window. Uses a dragover
 * "heartbeat" + short timeout (robust against enter/leave flicker) and
 * preventDefaults window dragover/drop so an accidental drop never opens
 * the file in the tab (which would lose all unsaved app state).
 */
export function useFilesDragging(): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let offTimer: number | undefined;
    const onDragOver = (e: DragEvent) => {
      if (!hasDragFiles(e)) return;
      e.preventDefault();
      setDragging(true);
      window.clearTimeout(offTimer);
      offTimer = window.setTimeout(() => setDragging(false), 250);
    };
    const stop = (e: DragEvent) => {
      if (e.type === "drop") e.preventDefault();
      window.clearTimeout(offTimer);
      setDragging(false);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", stop);
    window.addEventListener("dragend", stop);
    return () => {
      window.clearTimeout(offTimer);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", stop);
      window.removeEventListener("dragend", stop);
    };
  }, []);

  return dragging;
}

/**
 * Element-level drop zone with a `hovering` flag for highlight styling.
 * Drop events stop propagation so only the NEAREST target handles a drop.
 */
export function useDropTarget(onFiles: (files: File[]) => void) {
  const [hovering, setHovering] = useState(false);
  const cbRef = useRef(onFiles);
  cbRef.current = onFiles;
  const depthRef = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    depthRef.current += 1;
    setHovering(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setHovering(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasDragFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = 0;
    setHovering(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) cbRef.current(files);
  };

  return { hovering, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** Full-screen "drop here" visual — transparent to the pointer so precise
 *  drops still land on the exact slot row beneath it. */
export function FileDropOverlay({
  active,
  title = "فایل‌ها را اینجا رها کنید",
  hint,
}: {
  active: boolean;
  title?: string;
  hint?: string;
}) {
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center" aria-hidden>
      <div className="absolute inset-0 bg-white/55 backdrop-blur-[5px] dark:bg-[#12141f]/75" />
      <div className="anim-pop relative m-6 flex w-full max-w-md flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-brand-400/90 bg-white/85 px-8 py-10 text-center shadow-2xl shadow-brand-500/20 dark:border-brand-400/70 dark:bg-[#1a1d2e]/92">
        <span className="drop-float flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-[#837aff] to-[#5344d6] text-white shadow-lg shadow-brand-500/40">
          <UploadCloud size={30} />
        </span>
        <p className="text-[15px] font-extrabold">{title}</p>
        {hint && (
          <p className="max-w-[300px] text-[12px] leading-5 text-ink-500 dark:text-ink-400">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Image icon for pictures, document icon for PDFs/everything else. */
export function fileKindIcon(file: { type?: string; name?: string }): LucideIcon {
  return (file.type?.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(file.name ?? ""))
    ? FileImage
    : FileText;
}
