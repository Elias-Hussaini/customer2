import type { ReactNode } from "react";
import { Clock3, Flame, Tag as TagIcon } from "lucide-react";
import type { Tag as TagType } from "../../types";
import { formatMoney } from "../../utils/num";
import { toPersianDigits } from "../../utils/jalali";

export function TagBadge({ tag, onRemove }: { tag: TagType; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
      style={{ background: `${tag.color}1f`, color: tag.color }}
    >
      {tag.isUrgent && <Flame size={11} />}
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="mr-0.5 rounded-full p-0.5 hover:bg-black/10"
          aria-label={`حذف تگ ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function StatusPill({ issued }: { issued: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold ${
        issued
          ? "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]"
          : "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${issued ? "bg-[#10b981]" : "bg-[#f59e0b]"}`} />
      {issued ? "صادر شده" : "در حال کار"}
    </span>
  );
}

export function Chip({
  children,
  tone = "brand",
  icon,
}: {
  children: ReactNode;
  tone?: "brand" | "soft";
  icon?: ReactNode;
}) {
  return (
    <span className={tone === "brand" ? "chip" : "chip chip-soft"}>
      {icon}
      {children}
    </span>
  );
}

export function MoneyChip({
  amount,
  currency,
}: {
  amount: number | null | undefined;
  currency: "USD" | "IRT" | undefined;
}) {
  if (amount == null || !currency) return <span className="text-ink-400">—</span>;
  return <span className="num">{formatMoney(amount, currency)}</span>;
}

export function DateChip({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-ink-400">—</span>;
  return (
    <span className="num inline-flex items-center gap-1">
      <Clock3 size={12} className="text-ink-400" />
      {toPersianDigits(iso)}
    </span>
  );
}

export function TagsRow({
  tags,
  max = 3,
}: {
  tags: TagType[];
  max?: number;
}) {
  if (tags.length === 0) return <span className="text-ink-400 text-xs">—</span>;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <TagBadge key={t.id} tag={t} />
      ))}
      {rest > 0 && (
        <span className="chip-soft inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px]">
          <TagIcon size={10} />+{toPersianDigits(rest)}
        </span>
      )}
    </span>
  );
}
