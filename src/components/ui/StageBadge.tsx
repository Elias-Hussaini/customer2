import { BadgeCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { CustomerStage } from "../../types";
import {
  CUSTOMER_STAGE_LABELS,
  customerStageColor,
  customerStageLabel,
} from "../../types";
import { usePrefs } from "../../hooks/useData";

/**
 * Stage visuals («مرحله‌های ویزا") — the small colored ring, the labeled pill
 * and the green «کد اختصاصی» tick shown next to every customer, everywhere.
 *
 * Colors resolve from Settings → مراحل و رنگ‌ها (prefs overrides) with the
 * built-in progressive palette as the default.
 */

/** prefs-aware stage colors (overrides only). */
export function useStageColors(): Partial<Record<CustomerStage, string>> {
  const prefs = usePrefs();
  return prefs.stageColors ?? {};
}

/** The tiny colored circle — hover shows the stage name. */
export function StageDot({
  stage,
  size = 10,
  withRing = true,
  className = "",
  overrides,
  title,
}: {
  stage: CustomerStage | null | undefined;
  size?: number;
  withRing?: boolean;
  className?: string;
  /** Pass explicitly when rendering outside a prefs-aware component. */
  overrides?: Partial<Record<CustomerStage, string>> | null;
  title?: string;
}) {
  const prefsOverrides = useStageColors();
  const color = customerStageColor(stage, overrides ?? prefsOverrides);
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: color,
    boxShadow: withRing ? `0 0 0 3px ${color}26` : undefined,
  };
  return (
    <span
      className={`inline-block shrink-0 rounded-full align-middle ${className}`}
      style={style}
      aria-hidden={title ? undefined : true}
      title={title ?? (stage ? customerStageLabel(stage) : undefined)}
    />
  );
}

/** The labeled pill — dot + stage name in the stage's own color. */
export function StageBadge({
  stage,
  overrides,
  className = "",
  size = "md",
}: {
  stage: CustomerStage | null | undefined;
  overrides?: Partial<Record<CustomerStage, string>> | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const prefsOverrides = useStageColors();
  const color = customerStageColor(stage, overrides ?? prefsOverrides);
  const label = stage ? customerStageLabel(stage) : CUSTOMER_STAGE_LABELS.stage1;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-bold ${
        size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1 text-[11px]"
      } ${className}`}
      style={{ backgroundColor: `${color}1f`, color }}
      title={label}
    >
      <StageDot stage={stage} size={7} withRing={false} />
      {label}
    </span>
  );
}

/** Green tick shown when the customer HAS a کد اختصاصی (special code). */
export function CodeTick({
  has,
  size = 14,
  className = "",
}: {
  has: boolean | undefined;
  size?: number;
  className?: string;
}) {
  if (!has) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center align-middle text-[#10b981] dark:text-[#3ddc9a] ${className}`}
      title="دارای کد اختصاصی"
      aria-label="دارای کد اختصاصی"
    >
      <BadgeCheck size={size} strokeWidth={2.4} />
    </span>
  );
}

/**
 * The pair shown next to a customer's name everywhere: green tick (code) +
 * colored stage ring. Tooltips explain both on hover.
 */
export function StageIndicators({
  stage,
  hasCode,
  overrides,
  dotSize = 10,
  className = "",
}: {
  stage: CustomerStage | null | undefined;
  hasCode: boolean | undefined;
  overrides?: Partial<Record<CustomerStage, string>> | null;
  dotSize?: number;
  className?: string;
}) {
  const prefsOverrides = useStageColors();
  return (
    <span className={`inline-flex items-center gap-1.5 align-middle ${className}`}>
      <CodeTick has={hasCode} />
      <StageDot stage={stage} size={dotSize} overrides={overrides ?? prefsOverrides} />
    </span>
  );
}
