import { useRef, type DragEvent } from "react";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Paperclip,
  PenLine,
  RotateCcw,
} from "lucide-react";
import { Input } from "../ui/fields";
import { toPersianDigits } from "../../utils/jalali";
import { formatBytes, type PlanItem, type PlanOverride } from "../../utils/smartArchive/engine";

/* ------------------------------ tree model ------------------------------- */

export interface TreeNode {
  /** display segment name ("" for the ZIP root) */
  name: string;
  /** full folder path ("" = root) */
  path: string;
  files: PlanItem[];
  children: TreeNode[];
}

/** Build a real nested tree out of the flat plan (files + empty folders). */
export function buildTree(items: PlanItem[], emptyFolders: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", files: [], children: [] };
  const ensure = (path: string): TreeNode => {
    if (path === "") return root;
    let node = root;
    let acc = "";
    for (const seg of path.split("/")) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.children.find((c) => c.path === acc);
      if (!next) {
        next = { name: seg, path: acc, files: [], children: [] };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const it of items) ensure(it.folder).files.push(it);
  for (const f of emptyFolders) ensure(f);
  const sortRec = (n: TreeNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, "fa"));
    n.files.sort((a, b) => a.fileName.localeCompare(b.fileName, "fa"));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** Total files inside a subtree (the chip number on each folder row). */
export function countFiles(n: TreeNode): number {
  return n.files.length + n.children.reduce((s, c) => s + countFiles(c), 0);
}

/* ------------------------------- actions --------------------------------- */

export interface ArchiveTreeActions {
  overrides: Record<string, PlanOverride>;
  collapsed: Set<string>;
  onToggleCollapse(path: string): void;
  /** bulk folder rename (moves every file inside, incl. nested folders) */
  renamingFolder: string | null;
  folderRenameValue: string;
  onFolderRenameStart(path: string): void;
  onFolderRenameChange(value: string): void;
  onFolderRenameCommit(): void;
  onFolderRenameCancel(): void;
  /** per-file inline rename */
  renamingId: string | null;
  fileRenameValue: string;
  onFileRenameStart(id: string, currentName: string): void;
  onFileRenameChange(value: string): void;
  onFileRenameCommit(): void;
  onFileRenameCancel(): void;
  /** multi-select + bulk actions */
  selection: Set<string>;
  onToggleSelect(id: string): void;
  onMoveEntries(ids: string[], folder: string): void;
  onExclude(id: string, excluded: boolean): void;
}

/* -------------------------------- tree ----------------------------------- */

/** The live folder-tree preview: nested folders, drag & drop file moves,
 *  inline renames, per-file exclusion and multi-select bulk moves. */
export function ArchiveTree({ tree, actions }: { tree: TreeNode; actions: ArchiveTreeActions }) {
  const dragging = useRef<string[]>([]);

  const onFileDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    // dragging a selected file carries the WHOLE selection with it
    const ids = actions.selection.has(id) ? [...actions.selection] : [id];
    dragging.current = ids;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
  };

  const onFolderDrop = (e: DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    const ids =
      dragging.current.length > 0
        ? dragging.current
        : e.dataTransfer.getData("text/plain").split(",").filter(Boolean);
    dragging.current = [];
    if (ids.length > 0) actions.onMoveEntries(ids, folder);
  };

  return (
    <div className="max-h-[30rem] overflow-y-auto rounded-2xl border border-ink-900/8 dark:border-white/10">
      <Level node={tree} depth={0} actions={actions} onFileDragStart={onFileDragStart} onFolderDrop={onFolderDrop} />
    </div>
  );
}

/* --------------------------- recursive level ----------------------------- */

interface LevelProps {
  node: TreeNode;
  depth: number;
  actions: ArchiveTreeActions;
  onFileDragStart: (e: DragEvent<HTMLLIElement>, id: string) => void;
  onFolderDrop: (e: DragEvent, folder: string) => void;
}

function Level({ node, depth, actions, onFileDragStart, onFolderDrop }: LevelProps) {
  const isRoot = node.path === "";
  const collapsedNow = actions.collapsed.has(node.path);
  const renamingNow = actions.renamingFolder === node.path;
  return (
    <div data-folder={node.path}>
      {/* folder header */}
      <div
        role="button"
        tabIndex={renamingNow ? -1 : 0}
        aria-expanded={!collapsedNow}
        aria-label={isRoot ? "ریشه ZIP" : node.path}
        onClick={renamingNow ? undefined : () => actions.onToggleCollapse(node.path)}
        onKeyDown={(e) => {
          if (renamingNow) return;
          if (e.key === "Enter" || e.key === " ") actions.onToggleCollapse(node.path);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          e.currentTarget.dataset.drop = "1";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) delete e.currentTarget.dataset.drop;
        }}
        onDrop={(e) => {
          delete e.currentTarget.dataset.drop;
          onFolderDrop(e, node.path);
        }}
        className={`group/f flex w-full cursor-pointer select-none items-center gap-2 border-b border-ink-900/6 bg-white/85 px-3 py-2 text-right backdrop-blur transition-colors dark:border-white/8 dark:bg-ink-950/80 ${
          depth > 0 ? "" : "sticky top-0 z-10"
        } [&[data-drop='1']]:bg-brand-500/15 [&[data-drop='1']]:ring-2 [&[data-drop='1']]:ring-brand-500/60`}
        style={{ paddingInlineStart: depth === 0 ? undefined : `${depth * 20 + 12}px` }}
      >
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-400 transition-transform ${collapsedNow ? "-rotate-90" : ""}`}
        />
        {collapsedNow ? (
          <Folder size={15} className="shrink-0 text-brand-500" />
        ) : (
          <FolderOpen size={15} className="shrink-0 text-brand-500" />
        )}
        {renamingNow ? (
          <Input
            dir="auto"
            className="min-w-0 flex-1 !py-1 text-[12px]"
            value={actions.folderRenameValue}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => actions.onFolderRenameChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") actions.onFolderRenameCommit();
              if (e.key === "Escape") actions.onFolderRenameCancel();
            }}
            onBlur={() => actions.onFolderRenameCommit()}
            placeholder="مسیر جدید پوشه (خالی = ریشه ZIP)"
            aria-label="نام جدید پوشه"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold" dir="auto" title={isRoot ? undefined : node.path}>
            {isRoot ? "ریشه ZIP (بدون پوشه)" : node.name}
          </span>
        )}
        <span className="chip-soft num mr-auto shrink-0 rounded-full px-2 py-0.5 text-[10px]">
          {toPersianDigits(countFiles(node))}
        </span>
        {!renamingNow && (
          <span
            role="button"
            tabIndex={0}
            aria-label="تغییر نام پوشه"
            title="تغییر نام پوشه — همه فایل‌های داخلش جابه‌جا می‌شوند"
            className="icon-btn !h-6 !w-6 shrink-0 opacity-0 transition-opacity group-hover/f:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              actions.onFolderRenameStart(node.path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                actions.onFolderRenameStart(node.path);
              }
            }}
          >
            <PenLine size={12} />
          </span>
        )}
      </div>

      {!collapsedNow && (
        <div>
          {/* files at this level */}
          {node.files.length > 0 && (
            <ul className="divide-y divide-ink-900/4 dark:divide-white/4">
              {node.files.map((it) => {
                const ov = actions.overrides[it.entry.id];
                const excluded = ov?.excluded === true;
                const selected = actions.selection.has(it.entry.id);
                const renamingFile = actions.renamingId === it.entry.id;
                return (
                  <li
                    key={it.entry.id}
                    draggable={!renamingFile}
                    onDragStart={(e) => onFileDragStart(e, it.entry.id)}
                    className={`group/file flex items-center gap-2 px-3 py-1.5 transition-colors ${
                      excluded ? "opacity-45" : ""
                    } ${selected ? "bg-brand-500/8" : "hover:bg-brand-500/4"}`}
                    style={{ paddingInlineStart: `${depth * 20 + 12}px` }}
                  >
                    {/* selection checkbox */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={`انتخاب ${it.fileName}`}
                      onClick={() => actions.onToggleSelect(it.entry.id)}
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-2 transition-all ${
                        selected
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-ink-900/15 opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 dark:border-white/20"
                      }`}
                    >
                      {selected && <Check size={11} strokeWidth={3.5} />}
                    </button>

                    <GripVertical
                      size={13}
                      className="shrink-0 cursor-grab text-ink-300 opacity-40 group-hover/file:opacity-90 active:cursor-grabbing dark:text-ink-500"
                      aria-hidden
                    />

                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                      {it.entry.kind === "external" ? (
                        <Paperclip size={14} />
                      ) : it.entry.kind === "issuedVisa" ? (
                        <BadgeCheck size={14} />
                      ) : it.entry.mime.startsWith("image/") ? (
                        <FileImage size={14} />
                      ) : (
                        <FileText size={14} />
                      )}
                    </span>

                    {renamingFile ? (
                      <Input
                        dir="auto"
                        className="min-w-0 flex-1 !py-1 text-[12px]"
                        value={actions.fileRenameValue}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => actions.onFileRenameChange(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") actions.onFileRenameCommit();
                          if (e.key === "Escape") actions.onFileRenameCancel();
                        }}
                        onBlur={() => actions.onFileRenameCommit()}
                        aria-label="نام جدید فایل"
                      />
                    ) : (
                      <button
                        type="button"
                        dir="auto"
                        title="برای تغییر نام کلیک کنید"
                        className="min-w-0 max-w-[46%] flex-1 truncate rounded-md px-1 text-right text-[12px] font-medium hover:bg-brand-500/10"
                        onClick={() => actions.onFileRenameStart(it.entry.id, ov?.fileName ?? it.fileName)}
                      >
                        {ov?.fileName ?? it.fileName}
                      </button>
                    )}

                    <span
                      className="hidden shrink-0 text-[10.5px] text-ink-400 sm:inline"
                      title={
                        it.entry.kind === "external"
                          ? `فایل اضافی — ${it.entry.originalName}`
                          : `${it.entry.customerName}${it.entry.repName ? ` — ${it.entry.repName}` : ""}`
                      }
                    >
                      {it.entry.kind === "external" ? "فایل اضافی" : it.entry.customerName}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-400">
                      {formatBytes(it.entry.size)}
                    </span>
                    <button
                      type="button"
                      className={`icon-btn !h-7 !w-7 shrink-0 ${excluded ? "" : "opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 hover:!text-[#ef4444]"}`}
                      title={excluded ? "بازگرداندن به بایگانی" : "حذف از بایگانی"}
                      aria-label={excluded ? "بازگرداندن" : "حذف"}
                      onClick={() => actions.onExclude(it.entry.id, !excluded)}
                    >
                      {excluded ? <RotateCcw size={13} /> : <span className="text-[13px] leading-none">×</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* empty folder note */}
          {node.files.length === 0 && node.children.length === 0 && (
            <p className="flex items-center gap-1.5 px-3 py-2.5 text-[11px] text-ink-400" style={{ paddingInlineStart: `${depth * 20 + 12}px` }}>
              <FileArchive size={12} /> پوشه خالی — در ZIP ساخته می‌شود
            </p>
          )}

          {/* nested folders */}
          {node.children.map((child) => (
            <Level
              key={child.path}
              node={child}
              depth={depth + 1}
              actions={actions}
              onFileDragStart={onFileDragStart}
              onFolderDrop={onFolderDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}
