/**
 * لیست‌ها — the folder explorer, Windows-style.
 *
 * • Toolbar: back button + clickable breadcrumb (خانه / پوشه / زیرپوشه)
 * • Two view modes: شبکه (folder tiles) and فهرست (details rows) — persisted
 * • Folders nest: create a folder INSIDE the open folder; the back button
 *   (and the browser/phone back) always climbs one level up
 * • Opening a folder goes to its file page (/lists/:id) where requests live
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Archive,
  ChevronLeft,
  FilePenLine,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  ListChecks,
  Trash2,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Menu } from "../components/ui/Menu";
import { ListFormModal } from "../components/domain/ListFormModal";
import { WinFolderIcon } from "../components/domain/FolderIcon";
import { archiveList, deleteList, childrenOf } from "../db/lists";
import { useLists, useRequests } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { toPersianDigits } from "../utils/jalali";
import type { ListFolder } from "../types";

const VIEW_KEY = "lists.view.v1";
type ViewMode = "grid" | "list";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function ListsPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const lists = useLists();
  const allLists = useLists(false);
  const requests = useRequests();

  const [params, setParams] = useSearchParams();
  const folderId = params.get("folder") || null;
  const [view, setView] = useState<ViewMode>(loadView);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ListFolder | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode — ignore */
    }
  }, [view]);

  /** The breadcrumb chain: root → … → current folder. */
  const path = useMemo(() => {
    if (!allLists || !folderId) return [] as ListFolder[];
    const byId = new Map(allLists.map((l) => [l.id, l]));
    const chain: ListFolder[] = [];
    let cursor: string | null = folderId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const f = byId.get(cursor);
      if (!f) break;
      chain.unshift(f);
      cursor = f.parentId ?? null;
    }
    return chain;
  }, [allLists, folderId]);

  const folders = useMemo(
    () => childrenOf(lists ?? [], folderId),
    [lists, folderId],
  );

  const statsByList = useMemo(() => {
    const map = new Map<string, { total: number; issued: number; rejected: number }>();
    for (const r of requests ?? []) {
      if (!r.listId) continue;
      const entry = map.get(r.listId) ?? { total: 0, issued: 0, rejected: 0 };
      entry.total++;
      if (r.issued) entry.issued++;
      else if (r.rejected) entry.rejected++;
      map.set(r.listId, entry);
    }
    return map;
  }, [requests]);

  /** Descendant folder count per folder (shown as «n زیرپوشه»). */
  const subCount = useMemo(() => {
    const kids = new Map<string, number>();
    for (const l of allLists ?? []) {
      if (l.parentId) kids.set(l.parentId, (kids.get(l.parentId) ?? 0) + 1);
    }
    return kids;
  }, [allLists]);

  const goFolder = (id: string | null) => {
    setParams(id ? { folder: id } : {}, { replace: false });
  };

  const openFolder = (id: string) => navigate(`/lists/${id}`);

  const menuItems = (list: ListFolder) => {
    const stats = statsByList.get(list.id) ?? { total: 0, issued: 0, rejected: 0 };
    return [
      {
        icon: FilePenLine,
        label: "ویرایش",
        onClick: () => {
          setEditing(list);
          setEditOpen(true);
        },
      },
      {
        icon: Archive,
        label: "بایگانی",
        onClick: async () => {
          const ok = await confirm({ title: `بایگانی پوشه «${list.name}»؟` });
          if (ok) {
            await archiveList(list.id, list.name);
            toast.info("پوشه بایگانی شد");
          }
        },
      },
      {
        icon: Trash2,
        label: "حذف",
        danger: true,
        onClick: async () => {
          const ok = await confirm({
            title: `حذف پوشه «${list.name}»`,
            message:
              "درخواست‌ها و زیرپوشه‌های داخل آن حذف نمی‌شوند — زیرپوشه‌ها یک سطح بالا می‌روند.",
            danger: true,
            confirmLabel: "حذف قطعی",
          });
          if (ok) {
            await deleteList(list.id, list.name);
            toast.info("پوشه حذف شد");
          }
        },
      },
    ];
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="لیست‌ها"
        subtitle="پوشه‌بندی درخواست‌ها — مثل پوشه ویندوز: بسازید، داخل هم بسازید، با بک برگردید"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            <FolderPlus size={15} /> پوشه جدید
          </button>
        }
      />

      {/* ------------------------- explorer toolbar ------------------------- */}
      <div className="glass flex flex-wrap items-center gap-1.5 rounded-2xl px-2.5 py-2">
        {/* back */}
        <button
          className="icon-btn glass !h-8 !w-8"
          aria-label="بازگشت"
          title="بازگشت به پوشه قبلی"
          disabled={!folderId}
          onClick={() => {
            const parent = path.length > 1 ? path[path.length - 2].id : null;
            goFolder(parent);
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-ink-900/10 dark:bg-white/10" />

        {/* breadcrumb */}
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="مسیر پوشه">
          <button
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-bold transition-colors hover:bg-brand-500/10"
            onClick={() => goFolder(null)}
          >
            <Home size={14} />
            خانه
          </button>
          {path.map((f, i) => (
            <span key={f.id} className="flex shrink-0 items-center gap-0.5">
              <ChevronLeft size={13} className="text-ink-400" />
              <button
                className={`rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-brand-500/10 ${
                  i === path.length - 1 ? "font-extrabold text-brand-600 dark:text-brand-300" : "font-medium text-ink-600 dark:text-ink-300"
                }`}
                onClick={() => goFolder(f.id)}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>

        {/* view toggle */}
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
            <List size={14} />
          </button>
        </div>
      </div>

      {/* ------------------------------ folders ---------------------------- */}
      {lists === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-3xl bg-ink-900/5 dark:bg-white/5" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={folderId ? "این پوشه خالی است" : "هنوز پوشه‌ای نساخته‌اید"}
          description={
            folderId
              ? "با دکمه «پوشه جدید» می‌توانید همین‌جا داخل این پوشه، زیرپوشه بسازید"
              : "پوشه‌ها مثل ویندوز کار می‌کنند: درخواست‌ها را در دسته‌های دلخواه سازمان‌دهی کنید و داخل هم پوشه بسازید"
          }
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <FolderPlus size={15} /> ساخت پوشه
            </button>
          }
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {folders.map((list) => {
            const stats = statsByList.get(list.id) ?? { total: 0, issued: 0, rejected: 0 };
            const subs = subCount.get(list.id) ?? 0;
            return (
              <div key={list.id} className="group relative">
                <button
                  type="button"
                  className="win-folder w-full"
                  onDoubleClick={() => openFolder(list.id)}
                  onClick={() => openFolder(list.id)}
                  aria-label={`باز کردن پوشه ${list.name}`}
                >
                  <WinFolderIcon size={62} />
                  <span className="win-folder-name">{list.name}</span>
                  <span className="win-folder-meta num">
                    {toPersianDigits(stats.total)} درخواست
                    {subs > 0 && ` • ${toPersianDigits(subs)} زیرپوشه`}
                  </span>
                </button>
                <div className="absolute left-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Menu
                    items={menuItems(list)}
                    trigger={
                      <span className="icon-btn !h-7 !w-7 glass" aria-label="عملیات پوشه">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </span>
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass flex flex-col gap-0.5 rounded-3xl p-2">
          <div className="flex items-center gap-3 px-3 pb-1.5 text-[10.5px] font-bold text-ink-400">
            <span className="w-6" />
            <span className="min-w-0 flex-1">نام پوشه</span>
            <span className="w-20 text-center">درخواست</span>
            <span className="hidden w-24 text-center sm:block">صادر شده</span>
            <span className="w-10" />
          </div>
          {folders.map((list) => {
            const stats = statsByList.get(list.id) ?? { total: 0, issued: 0, rejected: 0 };
            const subs = subCount.get(list.id) ?? 0;
            return (
              <div key={list.id} className="group relative">
                <button type="button" className="win-row w-full" onClick={() => openFolder(list.id)}>
                  <span className="w-6 shrink-0">
                    <WinFolderIcon size={26} />
                  </span>
                  <span className="min-w-0 flex-1 text-right">
                    <span className="block truncate text-[13px] font-bold">{list.name}</span>
                    {list.category && (
                      <span className="block truncate text-[10px] text-ink-400">
                        {list.category}
                        {subs > 0 && ` • ${toPersianDigits(subs)} زیرپوشه`}
                      </span>
                    )}
                  </span>
                  <span className="num w-20 text-center text-[12.5px] font-bold">
                    {toPersianDigits(stats.total)}
                  </span>
                  <span className="num hidden w-24 text-center text-[12.5px] font-bold text-[#0b9e6e] dark:text-[#3ddc9a] sm:block">
                    {toPersianDigits(stats.issued)}
                  </span>
                  <span className="flex w-10 justify-end" />
                </button>
                <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Menu
                    items={menuItems(list)}
                    trigger={
                      <span className="icon-btn !h-7 !w-7 glass" aria-label="عملیات پوشه">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </span>
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ListFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        list={editing ?? undefined}
        parentId={folderId}
      />
    </div>
  );
}
