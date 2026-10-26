import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  brand: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  success: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
  warning: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
  danger: "bg-[#ef4444]/12 text-[#dc3535] dark:text-[#f87b7b]",
  info: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
  neutral: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="glass flex items-center gap-3.5 rounded-3xl p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${TONE_CLASS[tone]}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-ink-500 dark:text-ink-400">{label}</p>
        <p className="num truncate text-[19px] font-bold leading-7">{value}</p>
        {hint && <p className="truncate text-[11px] text-ink-400">{hint}</p>}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  icon: Icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  icon?: LucideIcon;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {back && (
          <button className="icon-btn glass" onClick={() => navigate(-1)} aria-label="بازگشت">
            <ChevronRight size={18} />
          </button>
        )}
        {Icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${TONE_CLASS.brand}`}>
            <Icon size={19} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
