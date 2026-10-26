import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-3xl border border-dashed border-ink-300/70 dark:border-ink-700 text-center ${
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14"
      }`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500 dark:text-brand-300">
        <Icon size={26} />
      </span>
      <h3 className="text-sm font-bold">{title}</h3>
      {description && (
        <p className="max-w-xs text-xs leading-6 text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-ink-900/5 dark:bg-white/5 ${className}`}
      aria-hidden
    />
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
