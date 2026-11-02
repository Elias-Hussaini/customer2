/**
 * Internal drag & drop for the studio library (ابزار عکس) — the plumbing
 * behind «درگ اند دراپ متنوع و جذاب».
 *
 * OS-file drags are already covered by ui/DropZone (they carry the "Files"
 * type). These helpers add the IN-APP drags on top, with custom MIME types so
 * images and folders can be dropped onto folder tiles and breadcrumb crumbs:
 *
 *   • image card  → folder tile / breadcrumb crumb  = move image(s)
 *   • folder tile → folder tile / «خانه»            = nest the folder
 *   • OS files    → folder tile / breadcrumb crumb  = import right there
 *
 * Payloads are JSON strings (ids), so one drag can carry a whole multi-select.
 */

export const DND_STUDIO_IMAGES = "application/x-c2-studio-images";
export const DND_STUDIO_FOLDER = "application/x-c2-studio-folder";

/** The image ids carried by an in-app drag (empty when it is not one). */
export function imageIdsFromDataTransfer(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  try {
    const raw = dt.getData(DND_STUDIO_IMAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x !== "");
  } catch {
    return [];
  }
}

/** The folder id carried by an in-app folder drag (null when it is not one). */
export function folderIdFromDataTransfer(dt: DataTransfer | null): string | null {
  if (!dt) return null;
  try {
    const raw = dt.getData(DND_STUDIO_FOLDER);
    return raw || null;
  } catch {
    return null;
  }
}

/** True while an in-app studio drag (image or folder) hovers a target. */
export function hasInternalStudioDrag(e: {
  dataTransfer?: DataTransfer | null;
}): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types);
  return list.includes(DND_STUDIO_IMAGES) || list.includes(DND_STUDIO_FOLDER);
}

/** Serialize the dragged image ids onto the dataTransfer (move semantics). */
export function setDraggedImageIds(e: React.DragEvent, ids: string[]): void {
  e.dataTransfer.setData(DND_STUDIO_IMAGES, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "move";
}

/** Serialize the dragged folder id onto the dataTransfer (move semantics). */
export function setDraggedFolderId(e: React.DragEvent, id: string): void {
  e.dataTransfer.setData(DND_STUDIO_FOLDER, id);
  e.dataTransfer.effectAllowed = "move";
}
