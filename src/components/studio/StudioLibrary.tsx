/**
 * StudioLibrary — the in-app organized save system, now a real Windows-style
 * explorer («همون پوشه‌بندی لیست‌ها، دقیق توی ابزار عکس»).
 *
 * • Explorer toolbar: back button + clickable breadcrumb (خانه / پوشه /
 *   زیرپوشه) + شبکه/فهرست view modes (persisted).
 * • Folders NEST: create a folder inside the open folder; deleting lifts
 *   sub-folders one level up and keeps the images (→ «سایر»).
 * • Drag & drop, everywhere it helps («درگ اند دراپ متنوع و جذاب»):
 *   - OS files → page = import into the open folder; onto a folder tile or a
 *     breadcrumb crumb = import right into THAT folder.
 *   - image card → folder tile / breadcrumb crumb = move (a whole multi-
 *     selection travels together when the grabbed card is selected).
 *   - folder tile → folder tile / crumb / خانه = nest it there (cycle-proof).
 * • Multi-select mode (انتخاب): tap cards, then move/delete the whole batch —
 *   the touch-friendly path to everything drag & drop does with a mouse.
 * • Search (with the recall arrow) widens to ALL folders; every image: re-open
 *   in the editor, download, move, rename, delete. Whole-scope export: one
 *   ZIP, or straight into an OS folder on Chrome.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  CheckSquare,
  Download,
  ExternalLink,
  FileArchive,
  FolderInput,
  FolderPlus,
  Home,
  ImagePlus,
  LayoutGrid,
  List as ListIcon,
  MoreVertical,
  Pencil,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { saveAs } from "file-saver";
import { Menu } from "../ui/Menu";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { Button } from "../ui/Button";
import { hasDragFiles, useDropTarget, useFilesDragging } from "../ui/DropZone";
import { SearchBox } from "../ui/inputs";
import {
  childrenOfStudio,
  createFolder,
  deleteFolder,
  deleteImage,
  isStudioDescendant,
  moveFolder,
  moveImage,
  renameFolder,
  renameImage,
  saveStudioImage,
  studioFolderChain,
  type StudioFolder,
  type StudioImage,
} from "../../db/studio";
import {
  folderIdFromDataTransfer,
  hasInternalStudioDrag,
  imageIdsFromDataTransfer,
  setDraggedFolderId,
  setDraggedImageIds,
} from "../../lib/studio/dnd";
import { compressImage } from "../../utils/imageCompress";
import { useStudioFolders, useStudioImages } from "../../hooks/useData";
import { humanBytes } from "../../lib/studio/canvas";
import { formatJalali, toPersianDigits } from "../../utils/jalali";
import { WinFolderIcon } from "../domain/FolderIcon";

const VIEW_KEY = "studio.library.view.v1";
type ViewMode = "grid" | "list";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function StudioLibrary({
  onEditInStudio,
}: {
  onEditInStudio: (image: StudioImage) => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const folders = useStudioFolders();
  const images = useStudioImages();

  // Explorer position: the open folder (null = root) + the «سایر» pseudo-view.
  const [folderId, setFolderId] = useState<string | null>(null);
  const [inOther, setInOther] = useState(false);
  const [view, setView] = useState<ViewMode>(loadView);
  const [query, setQuery] = useState("");
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Multi-select batch («انتخاب»).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Move dialogs (the touch-friendly twins of drag & drop).
  const [movingImage, setMovingImage] = useState<StudioImage | null>(null);
  const [movingSelection, setMovingSelection] = useState(false);
  const [movingFolder, setMovingFolder] = useState<StudioFolder | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode — ignore */
    }
  }, [view]);

  const allFolders = useMemo(() => folders ?? [], [folders]);
  const chain = useMemo(() => studioFolderChain(allFolders, folderId), [allFolders, folderId]);
  const children = useMemo(() => childrenOfStudio(allFolders, folderId), [allFolders, folderId]);

  /** Images per folder id («none» = سایر) and sub-folder counts, for the tiles. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const img of images ?? []) {
      const key = img.folderId ?? "none";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [images]);
  const subCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of allFolders) {
      if (f.parentId) map.set(f.parentId, (map.get(f.parentId) ?? 0) + 1);
    }
    return map;
  }, [allFolders]);

  /** Root shows همه (every image, ready for batch work); a folder shows only
   *  its own; «سایر» shows the unfiled ones. A search widens to ALL folders. */
  const scopedImages = useMemo(() => {
    const all = images ?? [];
    if (inOther) return all.filter((i) => i.folderId == null);
    if (folderId == null) return all;
    return all.filter((i) => i.folderId === folderId);
  }, [images, folderId, inOther]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedImages;
    return (images ?? []).filter((i) => i.name.toLowerCase().includes(q));
  }, [images, scopedImages, query]);

  const totalBytes = visible.reduce((s, i) => s + i.size, 0);
  const searching = query.trim() !== "";
  const scopeLabel = searching
    ? "نتایج جستجو"
    : inOther
      ? "سایر"
      : folderId == null
        ? "همه"
        : (chain[chain.length - 1]?.name ?? "پوشه");

  /* ---------------------------- navigation -------------------------------- */

  const clearTransient = () => {
    setSelected(new Set());
    setQuery("");
  };
  const goFolder = (id: string | null) => {
    setFolderId(id);
    setInOther(false);
    clearTransient();
  };
  const goOther = () => {
    setInOther(true);
    clearTransient();
  };
  const goBack = () => {
    if (inOther) {
      setInOther(false);
      clearTransient();
      return;
    }
    if (chain.length > 1) goFolder(chain[chain.length - 2].id);
    else if (chain.length === 1) goFolder(null);
  };

  /* ------------------------------ import ---------------------------------- */

  const importFiles = async (files: File[], forcedFolderId: string | null | undefined) => {
    const targetFolder =
      forcedFolderId === undefined
        ? folderId != null && !inOther
          ? folderId
          : null
        : forcedFolderId;
    let ok = 0;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast.error(`«${file.name}»: فقط تصویر قابل ورود به کتابخانه است`);
        continue;
      }
      try {
        const res = await compressImage({ blob: file, name: file.name });
        const bitmap = await createImageBitmap(res.blob);
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();
        await saveStudioImage({
          folderId: targetFolder,
          name: res.name || file.name,
          mime: res.mime || res.blob.type,
          blob: res.blob,
          width,
          height,
        });
        ok++;
      } catch (e) {
        console.error(e);
      }
    }
    if (ok > 0) {
      const dest = targetFolder
        ? ` («${allFolders.find((f) => f.id === targetFolder)?.name ?? "پوشه"}»)`
        : "";
      toast.success(
        ok > 1
          ? `${toPersianDigits(ok)} تصویر وارد کتابخانه شد${dest}`
          : `تصویر وارد کتابخانه شد${dest}`,
      );
    }
  };

  const dragging = useFilesDragging();
  const pageDrop = useDropTarget((files) => void importFiles(files, undefined));
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* --------------------------- drop routing ------------------------------- */

  /** Everything a drop onto `targetFolderId` (null = root/سایر) can do. */
  const dropInto = async (e: React.DragEvent, targetFolderId: string | null) => {
    // 1) in-app image cards → move them into the target folder
    const ids = imageIdsFromDataTransfer(e.dataTransfer);
    if (ids.length > 0) {
      let moved = 0;
      for (const id of ids) {
        const img = (images ?? []).find((i) => i.id === id);
        if (img && (img.folderId ?? null) !== targetFolderId) {
          await moveImage(id, targetFolderId);
          moved++;
        }
      }
      if (moved > 0) {
        const dest = targetFolderId
          ? `«${allFolders.find((f) => f.id === targetFolderId)?.name ?? "پوشه"}»`
          : "«سایر»";
        toast.success(
          moved > 1
            ? `${toPersianDigits(moved)} تصویر به ${dest} منتقل شد`
            : `تصویر به ${dest} منتقل شد`,
        );
      }
      setSelected(new Set());
      return;
    }
    // 2) an in-app folder tile → nest it here (never into itself/descendants)
    const fid = folderIdFromDataTransfer(e.dataTransfer);
    if (fid) {
      if (fid === targetFolderId) return;
      if (targetFolderId && isStudioDescendant(allFolders, fid, targetFolderId)) {
        toast.error("نمی‌شود پوشه را داخل خودش یا زیرپوشه‌هایش برد");
        return;
      }
      try {
        await moveFolder(fid, targetFolderId);
        toast.success(targetFolderId ? "پوشه جابه‌جا شد" : "پوشه به سطح اصلی برگشت");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "جابه‌جایی پوشه ناموفق بود");
      }
      return;
    }
    // 3) OS files → import straight into the target folder
    if (hasDragFiles(e)) {
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) void importFiles(files, targetFolderId);
    }
  };

  /* ------------------------------ folders --------------------------------- */

  const addFolder = async () => {
    const name = (newFolderName ?? "").trim();
    if (!name) return;
    try {
      await createFolder(name, folderId);
      setNewFolderName(null);
      toast.success(folderId ? "زیرپوشه ساخته شد" : "پوشه ساخته شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ساخت پوشه ناموفق بود");
    }
  };

  const removeFolder = async (id: string, name: string) => {
    const inside = (images ?? []).filter((i) => i.folderId === id).length;
    const subs = subCount.get(id) ?? 0;
    const ok = await confirm({
      title: `حذف پوشهٔ «${name}»؟`,
      message:
        inside || subs
          ? `${toPersianDigits(inside)} تصویر به «سایر» منتقل می‌شود و ${toPersianDigits(subs)} زیرپوشه یک سطح بالا می‌رود — هیچ‌چیز پاک نمی‌شود.`
          : "پوشه خالی است.",
      danger: true,
      confirmLabel: "حذف پوشه",
    });
    if (!ok) return;
    await deleteFolder(id);
    if (folderId === id) goFolder(null);
    toast.info("پوشه حذف شد");
  };

  const renameFolderTo = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      toast.success("پوشه تغییر نام یافت");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تغییر نام ناموفق بود");
    }
  };

  /* ------------------------------ selection ------------------------------- */

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveMany = async (ids: string[], target: string | null) => {
    let moved = 0;
    for (const id of ids) {
      const img = (images ?? []).find((i) => i.id === id);
      if (img && (img.folderId ?? null) !== target) {
        await moveImage(id, target);
        moved++;
      }
    }
    if (moved > 0) {
      const dest = target ? `«${allFolders.find((f) => f.id === target)?.name ?? "پوشه"}»` : "«سایر»";
      toast.success(
        moved > 1 ? `${toPersianDigits(moved)} تصویر به ${dest} منتقل شد` : `تصویر به ${dest} منتقل شد`,
      );
    }
    setSelected(new Set());
    setMovingImage(null);
    setMovingSelection(false);
  };

  const deleteSelection = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `حذف ${toPersianDigits(ids.length)} تصویر؟`,
      message: "این تصاویر برای همیشه از کتابخانه حذف می‌شوند.",
      danger: true,
      confirmLabel: "حذف",
    });
    if (!ok) return;
    for (const id of ids) await deleteImage(id);
    setSelected(new Set());
    setSelectMode(false);
    toast.info("تصاویر حذف شدند");
  };

  /* ------------------------------ exports ---------------------------------- */

  const dedupeName = (used: Set<string>, name: string) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let n = 2;
    while (used.has(`${base} ${n}${ext}`)) n++;
    const out = `${base} ${n}${ext}`;
    used.add(out);
    return out;
  };

  const exportZip = async () => {
    if (visible.length === 0) {
      toast.error("چیزی برای خروجی نیست");
      return;
    }
    setBusy("در حال ساخت ZIP…");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const used = new Set<string>();
      for (const img of visible) {
        const bytes = new Uint8Array(await img.blob.arrayBuffer());
        zip.file(dedupeName(used, img.name), bytes, { compression: "STORE" });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `ابزار-عکس-${scopeLabel.replace(/\s+/g, "-")}.zip`);
      toast.success(`${toPersianDigits(visible.length)} تصویر در یک ZIP خروجی شد`);
    } finally {
      setBusy(null);
    }
  };

  const exportToSystemFolder = async () => {
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{
        name: string;
        getFileHandle: (name: string, opts: { create: boolean }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }>;
    }).showDirectoryPicker;
    if (!picker) {
      toast.error("این قابلیت فقط در کروم/اج (دسکتاپ) کار می‌کند — از خروجی ZIP استفاده کنید");
      return;
    }
    if (visible.length === 0) {
      toast.error("چیزی برای خروجی نیست");
      return;
    }
    setBusy("انتخاب پوشهٔ سیستم…");
    try {
      const dir = await picker({ mode: "readwrite" });
      setBusy("در حال نوشتن…");
      const used = new Set<string>();
      for (const img of visible) {
        const handle = await dir.getFileHandle(dedupeName(used, img.name), { create: true });
        const writable = await handle.createWritable();
        await writable.write(img.blob);
        await writable.close();
      }
      toast.success(`${toPersianDigits(visible.length)} تصویر در پوشهٔ «${dir.name}» ذخیره شد`);
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        console.error(e);
        toast.error("نوشتن در پوشهٔ سیستم ممکن نشد");
      }
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------ render ----------------------------------- */

  const showFolderBadge = searching || (folderId == null && !inOther);
  const folderNameOf = (img: StudioImage) =>
    img.folderId ? (allFolders.find((f) => f.id === img.folderId)?.name ?? "پوشه") : "سایر";

  return (
    <div
      className="flex flex-col gap-4"
      {...(dragging ? pageDrop.dropHandlers : {})}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length) void importFiles(files, undefined);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void importFiles(files, undefined);
        }}
      />

      {/* ------------------------- explorer toolbar ------------------------- */}
      <div className="glass flex flex-wrap items-center gap-1.5 rounded-2xl px-2.5 py-2">
        <button
          className="icon-btn glass !h-8 !w-8"
          aria-label="بازگشت"
          title="بازگشت به پوشه قبلی"
          disabled={!folderId && !inOther}
          onClick={goBack}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-ink-900/10 dark:bg-white/10" />

        {/* breadcrumb — every crumb is ALSO a drop target (images + folders) */}
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="مسیر پوشه">
          <Crumb
            label="خانه"
            icon
            bold
            folderId={null}
            onClick={() => goFolder(null)}
            onDropInto={dropInto}
          />
          {chain.map((f, i) => (
            <Crumb
              key={f.id}
              label={f.name}
              bold={i === chain.length - 1}
              folderId={f.id}
              onClick={() => goFolder(f.id)}
              onDropInto={dropInto}
            />
          ))}
          {inOther && (
            <span className="flex shrink-0 items-center gap-0.5">
              <ChevronLeft size={13} className="text-ink-400" />
              <span className="rounded-lg px-2 py-1.5 text-[12.5px] font-extrabold text-brand-600 dark:text-brand-300">
                سایر
              </span>
            </span>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-ink-900/5 p-0.5 dark:bg-white/5">
          <button
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              view === "grid" ? "bg-white text-brand-600 shadow-sm dark:bg-ink-800 dark:text-brand-300" : "text-ink-400"
            }`}
            onClick={() => setView("grid")}
            aria-label="نمایش شبکه‌ای"
            title="نمایش شبکه‌ای"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              view === "list" ? "bg-white text-brand-600 shadow-sm dark:bg-ink-800 dark:text-brand-300" : "text-ink-400"
            }`}
            onClick={() => setView("list")}
            aria-label="نمایش فهرستی"
            title="نمایش فهرستی"
          >
            <ListIcon size={14} />
          </button>
        </div>
      </div>

      {/* ------------------------------ folders ----------------------------- */}
      {!inOther && (
        <div
          className={`gap-2.5 ${
            view === "grid"
              ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
              : "glass flex flex-col gap-1.5 rounded-3xl p-2"
          }`}
        >
          {/* «سایر» — the unfiled images, only at root */}
          {folderId == null &&
            (view === "grid" ? (
              <OtherTile count={counts.get("none") ?? 0} onClick={goOther} onDropInto={dropInto} />
            ) : (
              <OtherRow count={counts.get("none") ?? 0} onClick={goOther} onDropInto={dropInto} />
            ))}
          {children.map((f) =>
            view === "grid" ? (
              <FolderTile
                key={f.id}
                folder={f}
                imgCount={counts.get(f.id) ?? 0}
                subFolders={subCount.get(f.id) ?? 0}
                onOpen={() => goFolder(f.id)}
                onRename={(name) => void renameFolderTo(f.id, name)}
                onMoveMenu={() => setMovingFolder(f)}
                onDelete={() => void removeFolder(f.id, f.name)}
                onDropInto={dropInto}
              />
            ) : (
              <FolderRow
                key={f.id}
                folder={f}
                imgCount={counts.get(f.id) ?? 0}
                subFolders={subCount.get(f.id) ?? 0}
                onOpen={() => goFolder(f.id)}
                onRename={(name) => void renameFolderTo(f.id, name)}
                onMoveMenu={() => setMovingFolder(f)}
                onDelete={() => void removeFolder(f.id, f.name)}
                onDropInto={dropInto}
              />
            ),
          )}
          {newFolderName === null ? (
            !inOther && (
              <button
                className={`flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ink-900/15 px-3 py-2.5 text-[11px] font-bold text-ink-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-white/15 dark:text-ink-400 ${
                  view === "list" ? "w-full" : ""
                }`}
                onClick={() => setNewFolderName("")}
                title={folderId ? "ساخت زیرپوشه در همین پوشه" : "ساخت پوشهٔ جدید"}
              >
                <FolderPlus size={14} />
                {folderId ? "زیرپوشهٔ جدید" : "پوشهٔ جدید"}
              </button>
            )
          ) : (
            <span className="flex items-center gap-1 rounded-2xl px-1 py-1">
              <input
                autoFocus
                className="field !w-32 !py-1.5 !text-[12px]"
                value={newFolderName}
                placeholder="نام پوشه…"
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFolder();
                  if (e.key === "Escape") setNewFolderName(null);
                }}
              />
              <button className="icon-btn !h-8 !w-8" title="ساخت" onClick={() => void addFolder()}>
                <Check size={14} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* ---------------------------- tools row ----------------------------- */}
      <div className="glass rounded-3xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="جستجوی نام تصویر…"
            className="min-w-[150px] flex-1"
            recallKey="studio.library"
          />
          <Button
            size="sm"
            variant={selectMode ? "primary" : "glass"}
            icon={selectMode ? Square : CheckSquare}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            title="انتخاب چند تصویر و انتقال/حذف گروهی"
          >
            {selectMode ? "پایان انتخاب" : "انتخاب"}
          </Button>
          <Button size="sm" variant="glass" icon={ImagePlus} onClick={() => fileRef.current?.click()}>
            افزودن تصویر
          </Button>
          <Button size="sm" variant="glass" icon={FileArchive} onClick={() => void exportZip()}>
            خروجی ZIP
          </Button>
          <Button
            size="sm"
            variant="glass"
            icon={ExternalLink}
            onClick={() => void exportToSystemFolder()}
            title="مستقیم در یک پوشهٔ سیستم ذخیره می‌کند (کروم/اج)"
          >
            ذخیره در پوشهٔ سیستم
          </Button>
        </div>
        <p className="mt-2 num text-[11px] text-ink-500 dark:text-ink-400">
          {searching ? "نتایج جستجو در همهٔ پوشه‌ها: " : `${scopeLabel}: `}
          {toPersianDigits(visible.length)} تصویر • {humanBytes(totalBytes)}
          {busy ? ` • ${busy}` : ""}
        </p>
      </div>

      {/* ------------------------------ images ------------------------------ */}
      {visible.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 rounded-3xl border border-dashed border-ink-900/15 py-12 text-center dark:border-white/15">
          <ImagePlus size={30} className="text-brand-400" />
          <p className="text-[13px] font-bold">
            {searching ? "موردی یافت نشد" : inOther ? "«سایر» خالی است" : "این‌جا خالی است"}
          </p>
          <p className="max-w-sm text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
            تصویر بکشید و رها کنید، بچسبانید، یا «افزودن تصویر» را بزنید. با رها کردن روی پوشه‌ها
            (یا خانه، بالای صفحه) تصاویر مستقیم همان‌جا می‌نشینند.
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((img) => (
            <LibCard
              key={img.id}
              img={img}
              dragIds={selected.has(img.id) ? Array.from(selected) : [img.id]}
              selectMode={selectMode}
              isSelected={selected.has(img.id)}
              showFolderBadge={showFolderBadge}
              folderName={folderNameOf(img)}
              onOpenFolder={
                img.folderId
                  ? () => {
                      setQuery("");
                      setFolderId(img.folderId ?? null);
                      setInOther(false);
                    }
                  : goOther
              }
              onToggleSelect={() => toggleSelected(img.id)}
              onEdit={() => onEditInStudio(img)}
              onDownload={() => saveAs(img.blob, img.name)}
              onMoveMenu={() => setMovingImage(img)}
              onRename={async (name) => {
                try {
                  await renameImage(img.id, name);
                  toast.success("نام ذخیره شد");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "تغییر نام ناموفق بود");
                }
              }}
              onDelete={async () => {
                const ok = await confirm({
                  title: `حذف «${img.name}»؟`,
                  message: "این تصویر برای همیشه از کتابخانه حذف می‌شود.",
                  danger: true,
                  confirmLabel: "حذف",
                });
                if (!ok) return;
                await deleteImage(img.id);
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.delete(img.id);
                  return next;
                });
                toast.info("تصویر حذف شد");
              }}
            />
          ))}
        </div>
      ) : (
        <div className="glass flex flex-col gap-0.5 rounded-3xl p-2">
          {visible.map((img) => (
            <ImageRow
              key={img.id}
              img={img}
              dragIds={selected.has(img.id) ? Array.from(selected) : [img.id]}
              selectMode={selectMode}
              isSelected={selected.has(img.id)}
              showFolderBadge={showFolderBadge}
              folderName={folderNameOf(img)}
              onOpenFolder={
                img.folderId
                  ? () => {
                      setQuery("");
                      setFolderId(img.folderId ?? null);
                      setInOther(false);
                    }
                  : goOther
              }
              onToggleSelect={() => toggleSelected(img.id)}
              onEdit={() => onEditInStudio(img)}
              onDownload={() => saveAs(img.blob, img.name)}
              onMoveMenu={() => setMovingImage(img)}
              onRename={async (name) => {
                try {
                  await renameImage(img.id, name);
                  toast.success("نام ذخیره شد");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "تغییر نام ناموفق بود");
                }
              }}
              onDelete={async () => {
                const ok = await confirm({
                  title: `حذف «${img.name}»؟`,
                  message: "این تصویر برای همیشه از کتابخانه حذف می‌شود.",
                  danger: true,
                  confirmLabel: "حذف",
                });
                if (!ok) return;
                await deleteImage(img.id);
                toast.info("تصویر حذف شد");
              }}
            />
          ))}
        </div>
      )}

      {/* --------------------------- selection bar --------------------------- */}
      {selected.size > 0 && (
        <div className="glass sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-3xl px-3.5 py-2.5">
          <p className="text-[12.5px] font-extrabold">
            {toPersianDigits(selected.size)} تصویر انتخاب شد
          </p>
          <span className="flex-1" />
          <Button size="sm" variant="glass" icon={FolderInput} onClick={() => setMovingSelection(true)}>
            انتقال به پوشه…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            className="!text-rose-600 dark:!text-rose-400"
            onClick={() => void deleteSelection()}
          >
            حذف
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected(new Set());
              setSelectMode(false);
            }}
          >
            انصراف
          </Button>
        </div>
      )}

      {/* ----------------------------- move modals ---------------------------- */}
      {movingImage && (
        <MoveTargetModal
          title={`انتقال «${movingImage.name}» به…`}
          folders={allFolders}
          rootLabel="سایر (بدون پوشه)"
          onClose={() => setMovingImage(null)}
          onPick={(target) => void moveMany([movingImage.id], target)}
        />
      )}
      {movingSelection && (
        <MoveTargetModal
          title={`انتقال ${toPersianDigits(selected.size)} تصویر به…`}
          folders={allFolders}
          rootLabel="سایر (بدون پوشه)"
          onClose={() => setMovingSelection(false)}
          onPick={(target) => void moveMany(Array.from(selected), target)}
        />
      )}
      {movingFolder && (
        <MoveTargetModal
          title={`انتقال پوشهٔ «${movingFolder.name}» به…`}
          folders={allFolders}
          rootLabel="خانه — سطح اصلی"
          excludeId={movingFolder.id}
          onClose={() => setMovingFolder(null)}
          onPick={async (target) => {
            const f = movingFolder;
            setMovingFolder(null);
            if (f.id === target) return;
            try {
              await moveFolder(f.id, target);
              toast.success(target ? "پوشه جابه‌جا شد" : "پوشه به سطح اصلی برگشت");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "جابه‌جایی پوشه ناموفق بود");
            }
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- drop-target hook ----------------------------- */

/** A highlight-precise drop zone that accepts BOTH OS files and the in-app
 *  studio drags (image cards + folder tiles). Depth-counted like ui/DropZone
 *  so hovering children doesn't flicker. */
function useStudioDrop(onDrop: (e: React.DragEvent) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const accepts = (e: React.DragEvent) => hasDragFiles(e) || hasInternalStudioDrag(e);

  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = hasDragFiles(e) ? "copy" : "move";
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        dropRef.current(e);
      },
    },
  };
}

/* ------------------------------ breadcrumb -------------------------------- */

function Crumb({
  label,
  bold = false,
  icon = false,
  folderId,
  onClick,
  onDropInto,
}: {
  label: string;
  bold?: boolean;
  icon?: boolean;
  folderId: string | null;
  onClick: () => void;
  onDropInto: (e: React.DragEvent, folderId: string | null) => void;
}) {
  const { over, handlers } = useStudioDrop((e) => void onDropInto(e, folderId));
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <ChevronLeft size={13} className="text-ink-400" />
      <button
        {...handlers}
        className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] transition-all hover:bg-brand-500/10 ${
          over ? "bg-brand-500/14 ring-2 ring-brand-500" : ""
        } ${
          bold
            ? "font-extrabold text-brand-600 dark:text-brand-300"
            : "font-medium text-ink-600 dark:text-ink-300"
        }`}
        onClick={onClick}
        title="کشیدن تصویر/پوشه روی آن = انتقال به همین‌جا"
      >
        {icon && <Home size={14} />}
        {label}
      </button>
    </span>
  );
}

/* ------------------------------ folder tile ------------------------------- */

function FolderTile({
  folder,
  imgCount,
  subFolders,
  onOpen,
  onRename,
  onMoveMenu,
  onDelete,
  onDropInto,
}: {
  folder: StudioFolder;
  imgCount: number;
  subFolders: number;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMoveMenu: () => void;
  onDelete: () => void;
  onDropInto: (e: React.DragEvent, folderId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const { over, handlers } = useStudioDrop((e) => void onDropInto(e, folder.id));

  if (editing) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-brand-400/50 bg-brand-500/6 px-2 py-4">
        <WinFolderIcon size={40} />
        <input
          autoFocus
          className="field !w-28 !py-1 text-center !text-[11px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              if (draft.trim() && draft.trim() !== folder.name) onRename(draft);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft.trim() !== folder.name) onRename(draft);
          }}
        />
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        className={`win-folder w-full rounded-2xl ${over ? "bg-brand-500/12 ring-2 ring-brand-500" : ""}`}
        draggable
        onDragStart={(e) => setDraggedFolderId(e, folder.id)}
        onClick={onOpen}
        aria-label={`باز کردن پوشه ${folder.name}`}
        title={`${folder.name} — باز کردن؛ کشیدن تصویر یا فایل روی آن = انتقال به همین‌جا`}
        {...handlers}
      >
        <WinFolderIcon size={56} />
        <span className="win-folder-name">{folder.name}</span>
        <span className="win-folder-meta num">
          {toPersianDigits(imgCount)} تصویر
          {subFolders > 0 && ` • ${toPersianDigits(subFolders)} زیرپوشه`}
        </span>
      </button>
      <div className="absolute left-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu
          items={[
            {
              icon: Pencil,
              label: "تغییر نام",
              onClick: () => {
                setDraft(folder.name);
                setEditing(true);
              },
            },
            { icon: FolderInput, label: "انتقال به…", onClick: onMoveMenu },
            { icon: Trash2, label: "حذف پوشه", danger: true, onClick: () => void onDelete() },
          ]}
          trigger={
            <span className="icon-btn !h-7 !w-7 glass" aria-label="عملیات پوشه">
              <MoreVertical size={13} />
            </span>
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------- folder row ------------------------------- */

function FolderRow({
  folder,
  imgCount,
  subFolders,
  onOpen,
  onRename,
  onMoveMenu,
  onDelete,
  onDropInto,
}: {
  folder: StudioFolder;
  imgCount: number;
  subFolders: number;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMoveMenu: () => void;
  onDelete: () => void;
  onDropInto: (e: React.DragEvent, folderId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const { over, handlers } = useStudioDrop((e) => void onDropInto(e, folder.id));

  return (
    <div className={`group relative rounded-2xl ${over ? "ring-2 ring-brand-500" : ""}`}>
      {editing ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            autoFocus
            className="field !w-40 !py-1 !text-[12px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (draft.trim() && draft.trim() !== folder.name) onRename(draft);
              }
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft.trim() !== folder.name) onRename(draft);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="win-row w-full"
          draggable
          onDragStart={(e) => setDraggedFolderId(e, folder.id)}
          onClick={onOpen}
          {...handlers}
        >
          <span className="w-7 shrink-0">
            <WinFolderIcon size={26} />
          </span>
          <span className="min-w-0 flex-1 text-right">
            <span className="block truncate text-[13px] font-bold">{folder.name}</span>
            <span className="num block truncate text-[10px] text-ink-400">
              {toPersianDigits(imgCount)} تصویر
              {subFolders > 0 && ` • ${toPersianDigits(subFolders)} زیرپوشه`}
            </span>
          </span>
          <span className="flex w-10 justify-end" />
        </button>
      )}
      <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu
          items={[
            {
              icon: Pencil,
              label: "تغییر نام",
              onClick: () => {
                setDraft(folder.name);
                setEditing(true);
              },
            },
            { icon: FolderInput, label: "انتقال به…", onClick: onMoveMenu },
            { icon: Trash2, label: "حذف پوشه", danger: true, onClick: () => void onDelete() },
          ]}
          trigger={
            <span className="icon-btn !h-7 !w-7 glass" aria-label="عملیات پوشه">
              <MoreVertical size={13} />
            </span>
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------ «سایر» tile ------------------------------- */

function OtherTile({
  count,
  onClick,
  onDropInto,
}: {
  count: number;
  onClick: () => void;
  onDropInto: (e: React.DragEvent, folderId: string | null) => void;
}) {
  const { over, handlers } = useStudioDrop((e) => void onDropInto(e, null));
  return (
    <button
      type="button"
      className={`win-folder w-full rounded-2xl ${over ? "bg-brand-500/12 ring-2 ring-brand-500" : ""}`}
      onClick={onClick}
      title="تصاویر بدون پوشه — کشیدن تصویر روی آن = بی‌پوشه کردن"
      {...handlers}
    >
      <span className="flex h-[46px] items-center justify-center">
        <span className="flex h-11 w-14 items-center justify-center rounded-xl bg-ink-500/10 text-ink-500 dark:text-ink-300">
          <ImagePlus size={20} />
        </span>
      </span>
      <span className="win-folder-name">سایر</span>
      <span className="win-folder-meta num">{toPersianDigits(count)} تصویر</span>
    </button>
  );
}

/* ------------------------------- «سایر» row -------------------------------- */

function OtherRow({
  count,
  onClick,
  onDropInto,
}: {
  count: number;
  onClick: () => void;
  onDropInto: (e: React.DragEvent, folderId: string | null) => void;
}) {
  const { over, handlers } = useStudioDrop((e) => void onDropInto(e, null));
  return (
    <button
      type="button"
      className={`win-row w-full ${over ? "ring-2 ring-brand-500" : ""}`}
      onClick={onClick}
      title="تصاویر بدون پوشه — کشیدن تصویر روی آن = بی‌پوشه کردن"
      {...handlers}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-500/10 text-ink-500 dark:text-ink-300">
        <ImagePlus size={15} />
      </span>
      <span className="min-w-0 flex-1 text-right">
        <span className="block truncate text-[13px] font-bold">سایر</span>
        <span className="num block truncate text-[10px] text-ink-400">
          {toPersianDigits(count)} تصویر بدون پوشه
        </span>
      </span>
      <span className="flex w-10 justify-end" />
    </button>
  );
}

/* ------------------------------ library card ------------------------------ */

function LibCard({
  img,
  dragIds,
  selectMode,
  isSelected,
  showFolderBadge,
  folderName,
  onOpenFolder,
  onToggleSelect,
  onEdit,
  onDownload,
  onMoveMenu,
  onRename,
  onDelete,
}: {
  img: StudioImage;
  /** The ids this card drags with it (a whole selection, when grabbed from one). */
  dragIds: string[];
  selectMode: boolean;
  isSelected: boolean;
  showFolderBadge: boolean;
  folderName: string;
  onOpenFolder: () => void;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onMoveMenu: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(img.name);

  useEffect(() => {
    const url = URL.createObjectURL(img.blob);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [img]);

  return (
    <div
      className={`glass relative flex flex-col gap-1.5 rounded-2xl p-2.5 text-[11px] transition-all ${
        isSelected ? "ring-2 ring-brand-500" : ""
      }`}
      draggable={!editing}
      onDragStart={(e) => setDraggedImageIds(e, dragIds)}
    >
      {/* select checkbox (انتخاب mode) */}
      {selectMode && (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-white/85 text-brand-600 shadow-sm dark:bg-ink-800/90 dark:text-brand-300"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={isSelected ? "برداشتن انتخاب" : "انتخاب تصویر"}
        >
          {isSelected ? <Check size={14} /> : <Square size={13} className="text-ink-400" />}
        </button>
      )}

      <div className="flex items-start justify-between gap-1">
        {editing ? (
          <input
            autoFocus
            className="field !py-1 !text-[11.5px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (draft.trim() && draft.trim() !== img.name) void onRename(draft);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-right font-bold"
            title={`${img.name} — برای تغییر نام بزنید`}
            onClick={() => {
              setDraft(img.name);
              setEditing(true);
            }}
          >
            {img.name}
          </button>
        )}
        <span className="num shrink-0 text-[10px] text-ink-400" dir="ltr">
          {img.width}×{img.height}
        </span>
      </div>

      <button
        className="relative h-28 overflow-hidden rounded-xl bg-white/60 dark:bg-white/10"
        onClick={() => (selectMode ? onToggleSelect() : onEdit())}
        title={selectMode ? "انتخاب" : "باز کردن در ویرایشگر"}
      >
        {thumb && <img src={thumb} alt={img.name} className="h-full w-full object-cover" draggable={false} />}
        <span
          className={`absolute inset-0 items-center justify-center bg-ink-900/0 text-white opacity-0 transition-opacity hover:bg-ink-900/35 hover:opacity-100 ${
            selectMode ? "hidden" : "flex"
          }`}
        >
          <Wand2 size={22} />
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-1">
        <span className="num text-[10px] text-ink-400">{humanBytes(img.size)}</span>
        <span className="num text-[10px] text-ink-400">• {formatJalali(new Date(img.createdAt).toISOString().slice(0, 10))}</span>
        {showFolderBadge && (
          <button
            className="chip-soft mr-auto max-w-full truncate rounded-full px-2 py-0.5 text-[9.5px] text-ink-500 dark:text-ink-400"
            onClick={onOpenFolder}
            title={`رفتن به ${folderName}`}
          >
            {folderName}
          </button>
        )}
        <span className={showFolderBadge ? "" : "flex-1"} />
        <Menu
          trigger={
            <button type="button" className="icon-btn !h-6 !w-6 !text-ink-400" aria-label="عملیات">
              <MoreVertical size={13} />
            </button>
          }
          items={[
            { icon: Wand2, label: "ویرایش در ابزار", onClick: onEdit },
            { icon: Download, label: "دانلود", onClick: onDownload },
            { icon: Pencil, label: "تغییر نام", onClick: () => { setDraft(img.name); setEditing(true); } },
            { icon: FolderInput, label: "انتقال به پوشه…", onClick: onMoveMenu },
            { icon: Trash2, label: "حذف", danger: true, onClick: () => void onDelete() },
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------- image row -------------------------------- */

function ImageRow({
  img,
  dragIds,
  selectMode,
  isSelected,
  showFolderBadge,
  folderName,
  onOpenFolder,
  onToggleSelect,
  onEdit,
  onDownload,
  onMoveMenu,
  onRename,
  onDelete,
}: {
  img: StudioImage;
  /** The ids this row drags with it (a whole selection, when grabbed from one). */
  dragIds: string[];
  selectMode: boolean;
  isSelected: boolean;
  showFolderBadge: boolean;
  folderName: string;
  onOpenFolder: () => void;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onMoveMenu: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(img.name);

  useEffect(() => {
    const url = URL.createObjectURL(img.blob);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [img]);

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-all ${
        isSelected ? "bg-brand-500/10 ring-2 ring-brand-500" : "hover:bg-brand-500/6"
      }`}
      draggable={!editing}
      onDragStart={(e) => setDraggedImageIds(e, dragIds)}
    >
      {selectMode && (
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-brand-600 dark:text-brand-300"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={isSelected ? "برداشتن انتخاب" : "انتخاب تصویر"}
        >
          {isSelected ? <Check size={16} /> : <Square size={15} className="text-ink-400" />}
        </button>
      )}
      <button
        className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-white/60 dark:bg-white/10"
        onClick={() => (selectMode ? onToggleSelect() : onEdit())}
        title={selectMode ? "انتخاب" : "باز کردن در ویرایشگر"}
      >
        {thumb && <img src={thumb} alt={img.name} className="h-full w-full object-cover" draggable={false} />}
      </button>
      {editing ? (
        <input
          autoFocus
          className="field !w-40 !py-1 !text-[12px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              if (draft.trim() && draft.trim() !== img.name) void onRename(draft);
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button className="min-w-0 flex-1 text-right" onClick={() => (selectMode ? onToggleSelect() : onEdit())}>
          <span className="block truncate text-[12.5px] font-bold">{img.name}</span>
          <span className="num block truncate text-[10px] text-ink-400" dir="ltr">
            {img.width}×{img.height} • {humanBytes(img.size)} • {formatJalali(new Date(img.createdAt).toISOString().slice(0, 10))}
          </span>
        </button>
      )}
      {showFolderBadge && (
        <button
          className="chip-soft hidden max-w-24 shrink-0 truncate rounded-full px-2 py-0.5 text-[9.5px] text-ink-500 sm:block dark:text-ink-400"
          onClick={onOpenFolder}
          title={`رفتن به ${folderName}`}
        >
          {folderName}
        </button>
      )}
      <span className="flex shrink-0 justify-end">
        <Menu
          trigger={
            <button
              type="button"
              className="icon-btn !h-7 !w-7 !text-ink-400 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              aria-label="عملیات"
            >
              <MoreVertical size={13} />
            </button>
          }
          items={[
            { icon: Wand2, label: "ویرایش در ابزار", onClick: onEdit },
            { icon: Download, label: "دانلود", onClick: onDownload },
            { icon: Pencil, label: "تغییر نام", onClick: () => { setDraft(img.name); setEditing(true); } },
            { icon: FolderInput, label: "انتقال به پوشه…", onClick: onMoveMenu },
            { icon: Trash2, label: "حذف", danger: true, onClick: () => void onDelete() },
          ]}
        />
      </span>
    </div>
  );
}

/* ---------------------------- move-target modal --------------------------- */

function MoveTargetModal({
  title,
  folders,
  rootLabel,
  excludeId,
  onClose,
  onPick,
}: {
  title: string;
  folders: StudioFolder[];
  /** Label of the "no folder" / root option. */
  rootLabel: string;
  /** When moving a FOLDER: exclude it and its whole subtree. */
  excludeId?: string;
  onClose: () => void;
  onPick: (folderId: string | null) => void | Promise<void>;
}) {
  const options = useMemo(() => {
    let list = folders;
    if (excludeId) {
      list = folders.filter(
        (f) => f.id !== excludeId && !isStudioDescendant(folders, excludeId, f.id),
      );
    }
    return list
      .map((f) => ({
        id: f.id,
        label: studioFolderChain(folders, f.id)
          .map((x) => x.name)
          .join(" / "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fa"));
  }, [folders, excludeId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="glass max-h-[70vh] w-full max-w-xs overflow-y-auto rounded-3xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-[13px] font-extrabold">{title}</p>
        <div className="flex flex-col gap-1.5">
          <button
            className="btn btn-sm btn-glass justify-start"
            onClick={() => void onPick(null)}
            autoFocus
          >
            {rootLabel}
          </button>
          {options.map((o) => (
            <button key={o.id} className="btn btn-sm btn-glass justify-start" onClick={() => void onPick(o.id)}>
              {o.label}
            </button>
          ))}
          {options.length === 0 && (
            <p className="pt-1 text-center text-[11px] text-ink-400">پوشهٔ دیگری وجود ندارد.</p>
          )}
        </div>
      </div>
    </div>
  );
}
