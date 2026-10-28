import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, FilePenLine, FolderPlus, ListChecks, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Menu } from "../components/ui/Menu";
import { ListFormModal } from "../components/domain/ListFormModal";
import { archiveList, deleteList } from "../db/lists";
import { useLists, useRequests } from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import type { ListFolder } from "../types";

export function ListsPage() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const lists = useLists();
  const requests = useRequests();

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ListFolder | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="لیست‌ها"
        subtitle="پوشه‌بندی درخواست‌ها — مثل «ویزای داخله» یا «درخواست‌های آبان»"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            <FolderPlus size={15} /> لیست جدید
          </button>
        }
      />

      {lists === undefined ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-3xl bg-ink-900/5 dark:bg-white/5" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="هنوز لیستی نساخته‌اید"
          description="لیست‌ها مثل پوشه عمل می‌کنند: درخواست‌ها را در بازه‌های زمانی یا دسته‌بندی‌های دلخواه سازمان‌دهی می‌کنند"
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <FolderPlus size={15} /> ساخت اولین لیست
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => {
            const stats = statsByList.get(list.id) ?? { total: 0, issued: 0, rejected: 0 };
            return (
              <div key={list.id} className="glass group relative rounded-3xl p-5 transition-transform duration-150 hover:-translate-y-0.5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <Link to={`/lists/${list.id}`} className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-extrabold group-hover:text-brand-600 dark:group-hover:text-brand-300">
                      {list.name}
                    </h3>
                    {list.category && <span className="chip mt-1.5 inline-flex">{list.category}</span>}
                  </Link>
                  <Menu
                    items={[
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
                          const ok = await confirm({ title: `بایگانی لیست «${list.name}»؟` });
                          if (ok) {
                            await archiveList(list.id, list.name);
                            toast.info("لیست بایگانی شد");
                          }
                        },
                      },
                      {
                        icon: Trash2,
                        label: "حذف",
                        danger: true,
                        onClick: async () => {
                          const ok = await confirm({
                            title: `حذف لیست «${list.name}»`,
                            message: `${stats.total} درخواست داخل این لیست حذف نمی‌شوند و بدون لیست باقی می‌مانند.`,
                            danger: true,
                            confirmLabel: "حذف قطعی",
                          });
                          if (ok) {
                            await deleteList(list.id, list.name);
                            toast.info("لیست حذف شد");
                          }
                        },
                      },
                    ]}
                    trigger={
                      <span className="icon-btn !h-8 !w-8" aria-label="عملیات لیست">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </span>
                    }
                  />
                </div>

                {list.description && (
                  <p className="line-clamp-2 mb-3 min-h-[36px] text-[12px] leading-6 text-ink-500 dark:text-ink-400">
                    {list.description}
                  </p>
                )}

                {(list.startDate || list.endDate) && (
                  <p className="num mb-3 text-[11px] text-ink-400">
                    {list.startDate ? formatJalali(list.startDate, "long") : "…"}
                    {" تا "}
                    {list.endDate ? formatJalali(list.endDate, "long") : "…"}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <span className="chip-soft num inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]">
                    {toPersianDigits(stats.total)} درخواست
                  </span>
                  {stats.issued > 0 && (
                    <span className="num inline-flex items-center gap-1 rounded-full bg-[#10b981]/12 px-2.5 py-1 text-[11px] font-semibold text-[#0b9e6e] dark:text-[#3ddc9a]">
                      {toPersianDigits(stats.issued)} صادر شده
                    </span>
                  )}
                  {stats.rejected > 0 && (
                    <span className="num inline-flex items-center gap-1 rounded-full bg-[#ef4444]/12 px-2.5 py-1 text-[11px] font-semibold text-[#dc3535] dark:text-[#f87b7b]">
                      {toPersianDigits(stats.rejected)} رد شده
                    </span>
                  )}
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
      />
    </div>
  );
}
