/**
 * Dependency-free SVG charts for the accounting dashboard.
 * All values are computed from real stored data at the call site — these
 * components only render. RTL-friendly, theme-aware, glass-styled.
 */

import { useId } from "react";
import { formatMoney } from "../../utils/num";
import type { Currency } from "../../types";

/* ------------------------- Grouped bar comparison -------------------------- */

export interface BarGroup {
  label: string;
  /** Positive value for the first (in) bar. */
  in: number;
  /** Positive value for the second (out) bar. */
  out: number;
}

export function GroupedBarsChart({
  groups,
  currency,
  inLabel = "دریافت",
  outLabel = "پرداخت",
  height = 190,
}: {
  groups: BarGroup[];
  currency: Currency;
  inLabel?: string;
  outLabel?: string;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  if (groups.length === 0) {
    return <ChartEmpty height={height} />;
  }
  const max = Math.max(1, ...groups.map((g) => Math.max(g.in, g.out)));
  const barW = 10;
  const groupGap = 18;
  const width = Math.max(280, groups.length * (barW * 2 + 8 + groupGap));
  const plotH = height - 34;
  const scale = (v: number) => (v / max) * (plotH - 8);

  return (
    <div className="w-full overflow-x-auto" dir="rtl">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block"
        role="img"
        aria-label={`نمودار ${inLabel} و ${outLabel}`}
      >
        <defs>
          <linearGradient id={`in-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id={`out-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={plotH - f * (plotH - 8)}
            y2={plotH - f * (plotH - 8)}
            className="stroke-ink-900/8 dark:stroke-white/8"
            strokeDasharray="3 5"
            strokeWidth={1}
          />
        ))}
        {groups.map((g, i) => {
          const x = i * (barW * 2 + 8 + groupGap) + groupGap / 2 + 4;
          const inH = Math.max(g.in > 0 ? 3 : 0, scale(g.in));
          const outH = Math.max(g.out > 0 ? 3 : 0, scale(g.out));
          return (
            <g key={g.label}>
              <rect
                x={x}
                y={plotH - inH}
                width={barW}
                height={inH}
                rx={3.5}
                fill={`url(#in-${gid})`}
                opacity={0.92}
              >
                <title>{`${inLabel}: ${formatMoney(g.in, currency)}`}</title>
              </rect>
              <rect
                x={x + barW + 8}
                y={plotH - outH}
                width={barW}
                height={outH}
                rx={3.5}
                fill={`url(#out-${gid})`}
                opacity={0.92}
              >
                <title>{`${outLabel}: ${formatMoney(g.out, currency)}`}</title>
              </rect>
              <text
                x={x + barW + 4}
                y={height - 10}
                textAnchor="middle"
                className="fill-ink-500 dark:fill-ink-400"
                fontSize={9.5}
                fontWeight={600}
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] font-bold">
        <span className="flex items-center gap-1.5 text-[#0b9e6e] dark:text-[#3ddc9a]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
          {inLabel}
        </span>
        <span className="flex items-center gap-1.5 text-[#dc3535] dark:text-[#f87b7b]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
          {outLabel}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------- Donut ----------------------------------- */

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  size = 168,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <ChartEmpty height={size} />;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  // RTL reading order — start from the top, go clockwise.
  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const arc = { ...s, frac, dash: frac * c, offset };
    offset += frac * c;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="توزیع انواع تراکنش">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={16}
              strokeDasharray={`${a.dash} ${c - a.dash}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
            >
              <title>{`${a.label}: ${Math.round(a.frac * 100)}٪`}</title>
            </circle>
          ))}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 6}
          textAnchor="middle"
          className="fill-ink-500 dark:fill-ink-400"
          fontSize={10}
          fontWeight={600}
        >
          {centerLabel ?? ""}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          className="fill-ink-700 dark:fill-ink-100"
          fontSize={17}
          fontWeight={800}
        >
          {centerValue ?? ""}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {arcs.map((a) => (
          <span key={a.label} className="flex items-center gap-2 text-[11.5px] font-semibold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
            {a.label}
            <span className="num text-ink-500 dark:text-ink-400">{Math.round(a.frac * 100)}٪</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Sparkline -------------------------------- */

export function TrendChart({
  points,
  height = 64,
  color = "#635BFF",
}: {
  points: number[];
  height?: number;
  color?: string;
}) {
  const gid = useId().replace(/:/g, "");
  if (points.length < 2) return <ChartEmpty height={height} compact />;
  const width = 300;
  const max = Math.max(1, ...points);
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - 6 - (p / max) * (height - 14)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="روند"
    >
      <defs>
        <linearGradient id={`trend-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#trend-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChartEmpty({ height, compact }: { height: number; compact?: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-dashed border-ink-300/60 text-[11.5px] font-medium text-ink-400 dark:border-ink-700"
      style={{ height }}
    >
      {compact ? "داده کافی برای نمودار نیست" : "هنوز داده‌ای برای نمایش وجود ندارد"}
    </div>
  );
}
