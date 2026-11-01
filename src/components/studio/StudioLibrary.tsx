/**
 * StudioLibrary — the in-app organized save system (پوشه‌بندی حرفه‌ای).
 *
 * Folders the user creates/renames/deletes; images inside them (or in «سایر»);
 * drop files ANYWHERE on this tab to import (compressed at rest), drop them
 * ONTO a folder chip to file them there directly. Every image: re-open in
 * the editor, download, move, rename, delete.
 *
 * Whole-scope export: one ZIP, or straight into an OS folder on Chrome
 * (File System Access API) — «بشه خروجی گرفت توی پوشه».
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FileArchive,
  FolderInput,
  FolderPlus,
  ImagePlus,
  MoreVertical,
  Pencil,
  Trash2,
  Wand2,
} from "lucide-react";
import { saveAs } from "file-saver";
import { Menu } from "../ui/Menu";
import { useToast } from "../../hooks/useToast";
import { useConfirm } from "../../hooks/useConfirm";
import { Button } from "../ui/Button";
import { useDropTarget, useFilesDragging } from "../ui/DropZone";
import {
  createFolder,
  deleteFolder,
  deleteImage,
  moveImage,
  renameFolder,
  renameImage,
  saveStudioImage,
  type StudioImage,
} from "../../db/studio";
import { compressImage } from "../../utils/imageCompress";
import { useStudioFolders, useStudioImages } from "../../hooks/useData";
import { humanBytes } from "../../lib/studio/canvas";
import { formatJalali, toPersianDigits } from "../../utils/jalali";

type Scope = "all" | "none" | { folderId: string };

export function StudioLibrary({
  onEditInStudio,
}: {
  onEditInStudio: (image: StudioImage) => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const folders = useStudioFolders();
  const images = useStudioImages();

  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const scopeKey = (s: Scope) => (s === "all" ? "all" : s === "none" ? "none" : s.folderId);
  const inScope = (img: StudioImage, s: Scope) => {
    if (s === "all") return true;
    if (s === "none") return img.folderId == null;
    return img.folderId === s.folderId;
  };

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const img of images ?? []) {
      const key = img.folderId ?? "none";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [images]);

  const visible = useMemo(() => {
    let list = (images ?? []).filter((i) => inScope(i, scope));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((i) => `${i.name}`.toLowerCase().includes(q));
    }
    return list;
  }, [images, scope, query]);

  const totalBytes = visible.reduce((s, i) => s + i.size, 0);

  /* ------------------------------ import ---------------------------------- */

  const importFiles = async (files: File[], forcedFolderId: string | null | undefined) => {
    const targetFolder =
      forcedFolderId === undefined
        ? scope === "all"
          ? null
          : scope === "none"
            ? null
            : scope.folderId
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
      toast.success(
        ok > 1
          ? `${toPersianDigits(ok)} تصویر وارد کتابخانه شد`
          : "تصویر وارد کتابخانه شد",
      );
    }
  };

  const dragging = useFilesDragging();
  const pageDrop = useDropTarget((files) => void importFiles(files, undefined));
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ------------------------------ folders --------------------------------- */

  const addFolder = async () => {
    const name = (newFolderName ?? "").trim();
    if (!name) return;
    try {
      await createFolder(name);
      setNewFolderName(null);
      toast.success("پوشه ساخته شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ساخت پوشه ناموفق بود");
    }
  };

  const removeFolder = async (id: string, name: string) => {
    const inside = (images ?? []).filter((i) => i.folderId === id).length;
    const ok = await confirm({
      title: `حذف پوشهٔ «${name}»؟`,
      message: inside
        ? `${toPersianDigits(inside)} تصویر داخلش به «سایر» منتقل می‌شوند و پاک نمی‌شوند.`
        : "پوشه خالی است.",
      danger: true,
      confirmLabel: "حذف پوشه",
    });
    if (!ok) return;
    await deleteFolder(id);
    if (scopeKey(scope) === id) setScope("all");
    toast.info("پوشه حذف شد");
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
      const label =
        scope === "all"
          ? "همه"
          : scope === "none"
            ? "سایر"
            : (folders ?? []).find((f) => f.id === scope.folderId)?.name ?? "پوشه";
      for (const img of visible) {
        const bytes = new Uint8Array(await img.blob.arrayBuffer());
        zip.file(dedupeName(used, img.name), bytes, { compression: "STORE" });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `ابزار-عکس-${label.replace(/\s+/g, "-")}.zip`);
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

  /* ------------------------------ cards ------------------------------------ */

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

      {/* folder rail */}
      <div className="glass rounded-3xl p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FolderChip
            label="همه"
            count={(images ?? []).length}
            active={scopeKey(scope) === "all"}
            onClick={() => setScope("all")}
          />
          <FolderChip
            label="سایر"
            count={counts.get("none") ?? 0}
            active={scopeKey(scope) === "none"}
            onClick={() => setScope("none")}
          />
          {(folders ?? []).map((f) => (
            <FolderChip
              key={f.id}
              label={f.name}
              count={counts.get(f.id) ?? 0}
              active={scopeKey(scope) === f.id}
              onClick={() => setScope({ folderId: f.id })}
              onRename={async (name) => {
                try {
                  await renameFolder(f.id, name);
                  toast.success("پوشه تغییر نام یافت");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "تغییر نام ناموفق بود");
                }
              }}
              onDelete={() => void removeFolder(f.id, f.name)}
              onDropFiles={(files) => void importFiles(files, f.id)}
            />
          ))}
          {newFolderName === null ? (
            <button
              className="chip !px-2.5 !py-1.5 !text-[11px]"
              onClick={() => setNewFolderName("")}
              title="پوشهٔ جدید"
            >
              <FolderPlus size={12} /> پوشهٔ جدید
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                className="field !w-36 !py-1.5 !text-[12px]"
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

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-900/5 pt-3 dark:border-white/5">
          <input
            className="field !py-1.5 flex-1 min-w-[140px] !text-[12px]"
            placeholder="جستجوی نام تصویر…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
          {toPersianDigits(visible.length)} تصویر • {humanBytes(totalBytes)}
          {busy ? ` • ${busy}` : ""}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 rounded-3xl border border-dashed border-ink-900/15 py-12 text-center dark:border-white/15">
          <ImagePlus size={30} className="text-brand-400" />
          <p className="text-[13px] font-bold">این‌جا خالی است</p>
          <p className="max-w-sm text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
            تصویر بکشید و رها کنید، بچسبانید، یا «افزودن تصویر» را بزنید. با رها کردن روی نام یک پوشه،
            تصویر مستقیم همان‌جا می‌نشیند.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((img) => (
            <LibCard
              key={img.id}
              img={img}
              folders={(folders ?? []).filter((f) => f.id !== img.folderId)}
              onEdit={() => onEditInStudio(img)}
              onDownload={() => saveAs(img.blob, img.name)}
              onMove={async (folderId) => {
                await moveImage(img.id, folderId);
                toast.success(folderId ? "منتقل شد" : "به «سایر» منتقل شد");
              }}
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
    </div>
  );
}

/* ------------------------------ folder chip ------------------------------ */

function FolderChip({
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
  onDropFiles,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename?: (name: string) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onDropFiles?: (files: File[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const { hovering: over, dropHandlers } = useDropTarget(onDropFiles ?? (() => undefined));

  return (
    <span
      {...(onDropFiles ? dropHandlers : {})}
      className={`flex items-center gap-1 rounded-full px-1 transition-all ${over ? "ring-2 ring-brand-500" : ""}`}
    >
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            className="field !w-28 !py-1 !text-[11px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (draft.trim() && draft.trim() !== label) await onRename?.(draft);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
        </span>
      ) : (
        <button
          className={`chip !px-2.5 !py-1.5 !text-[11px] ${active ? "" : "chip-soft"}`}
          onClick={onClick}
          title={onRename ? "برای انتخاب بزنید — نام را از منوی ⋮ تغییر دهید" : undefined}
        >
          {label}
          <span className="num mr-1 text-[10px] opacity-70">{toPersianDigits(count)}</span>
        </button>
      )}
      {(onRename || onDelete) && !editing && (
        <Menu
          trigger={
            <button type="button" className="icon-btn !h-6 !w-6 !text-ink-400" aria-label="عملیات پوشه">
              <MoreVertical size={13} />
            </button>
          }
          items={[
            ...(onRename
              ? [
                  {
                    icon: Pencil,
                    label: "تغییر نام",
                    onClick: () => {
                      setDraft(label);
                      setEditing(true);
                    },
                  },
                ]
              : []),
            ...(onDelete
              ? [{ icon: Trash2, label: "حذف پوشه", danger: true, onClick: () => void onDelete?.() }]
              : []),
          ]}
        />
      )}
    </span>
  );
}

/* ------------------------------ library card ----------------------------- */

function LibCard({
  img,
  folders,
  onEdit,
  onDownload,
  onMove,
  onRename,
  onDelete,
}: {
  img: StudioImage;
  folders: { id: string; name: string }[];
  onEdit: () => void;
  onDownload: () => void;
  onMove: (folderId: string | null) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(img.name);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(img.blob);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [img]);

  return (
    <div className="glass flex flex-col gap-1.5 rounded-2xl p-2.5 text-[11px]">
      <div className="flex items-start justify-between gap-1">
        {editing ? (
          <input
            autoFocus
            className="field !py-1 !text-[11.5px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (draft.trim() && draft.trim() !== img.name) await onRename(draft);
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

      <button className="relative h-28 overflow-hidden rounded-xl bg-white/60 dark:bg-white/10" onClick={onEdit} title="باز کردن در ویرایشگر">
        {thumb && <img src={thumb} alt={img.name} className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center bg-ink-900/0 text-white opacity-0 transition-opacity hover:bg-ink-900/35 hover:opacity-100">
          <Wand2 size={22} />
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-1">
        <span className="num text-[10px] text-ink-400">{humanBytes(img.size)}</span>
        <span className="num text-[10px] text-ink-400">• {formatJalali(new Date(img.createdAt).toISOString().slice(0, 10))}</span>
        <span className="flex-1" />
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
            { icon: FolderInput, label: "انتقال به پوشه…", onClick: () => setMoving(true) },
            { icon: Trash2, label: "حذف", danger: true, onClick: () => void onDelete() },
          ]}
        />
      </div>

      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={() => setMoving(false)}>
          <div className="glass w-full max-w-xs rounded-3xl p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-[13px] font-extrabold">انتقال «{img.name}» به…</p>
            <div className="flex flex-col gap-1.5">
              <button
                className={`btn btn-sm ${img.folderId == null ? "btn-primary" : "btn-glass"} justify-start`}
                onClick={async () => {
                  setMoving(false);
                  if (img.folderId != null) await onMove(null);
                }}
              >
                سایر (بدون پوشه)
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  className={`btn btn-sm ${img.folderId === f.id ? "btn-primary" : "btn-glass"} justify-start`}
                  onClick={async () => {
                    setMoving(false);
                    if (img.folderId !== f.id) await onMove(f.id);
                  }}
                >
                  {f.name}
                </button>
              ))}
              {folders.length === 0 && (
                <p className="pt-1 text-center text-[11px] text-ink-400">پوشهٔ دیگری وجود ندارد.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
