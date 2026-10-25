import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  Banknote,
  CirclePlus,
  FilePlus2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  UserPlus,
  DatabaseBackup,
  History,
  type LucideIcon,
} from "lucide-react";
import type { Activity } from "../../types";
import { relativeTime } from "../../utils/jalali";

const TYPE_META: Record<string, { icon: LucideIcon; className: string }> = {
  create: { icon: CirclePlus, className: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]" },
  update: { icon: Pencil, className: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]" },
  delete: { icon: Trash2, className: "bg-[#ef4444]/12 text-[#dc3535] dark:text-[#f87b7b]" },
  archive: { icon: Archive, className: "bg-ink-500/10 text-ink-500" },
  restore: { icon: ArchiveRestore, className: "bg-[#3b82f6]/12 text-[#2563eb]" },
  issue: { icon: BadgeCheck, className: "bg-[#10b981]/12 text-[#0b9e6e]" },
  unissue: { icon: RotateCcw, className: "bg-[#f59e0b]/14 text-[#c77d0a]" },
  payment: { icon: Banknote, className: "bg-[#10b981]/12 text-[#0b9e6e]" },
  backup: { icon: DatabaseBackup, className: "bg-brand-500/12 text-brand-600 dark:text-brand-300" },
  settings: { icon: Settings2, className: "bg-brand-500/12 text-brand-600 dark:text-brand-300" },
};

/** Timeline of recent operations. */
export function ActivityFeed({
  activities,
  emptyLabel = "فعالیتی ثبت نشده است",
}: {
  activities: Activity[] | undefined;
  emptyLabel?: string;
}) {
  if (activities === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-xl bg-ink-900/5 dark:bg-white/5" />
        ))}
      </div>
    );
  }
  if (activities.length === 0) {
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-xs text-ink-400">
        <History size={14} />
        {emptyLabel}
      </p>
    );
  }
  return (
    <ol className="relative flex flex-col">
      {activities.map((a) => {
        const meta = TYPE_META[a.type] ?? TYPE_META.update;
        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span
              className={`z-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.className}`}
            >
              <meta.icon size={14} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] font-medium leading-5">{a.title}</p>
              {a.detail && (
                <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">{a.detail}</p>
              )}
              <p className="text-[10.5px] text-ink-400">{relativeTime(a.ts)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
