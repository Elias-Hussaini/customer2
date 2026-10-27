/**
 * Dependency-free SVG charts for the monthly statistics page (آمار ماهانه).
 *
 * RTL-native: time flows right → left (oldest month on the right), the way
 * Persian readers expect. All values are computed at the call site — these
 * components only render. Theme-aware, glass-friendly, animated on mount.
 */

import { useEffect, useId, useState } from "react";
import { toPersianDigits } from "../../utils/jalali";
import { compactMoney } from "../../services/monthlyStats";
import type { Currency } from "../../types";

/* --------------------------- grow-in animation ---------------------------- */

/** Flip to true one frame after mount → CSS transitions play once. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return mounted;
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-dashed border-ink-300/60 text-[11.5px] font-medium text-ink-400 dark:border-ink-700"
      style={{ height }}
    >
      هنوز داده‌ای برای نمایش وجود ندارد
    </div>
  );
}

/* ------------------------- grouped monthly bars ---------------------------- */

export interface BarMonth {
  key: string;
  label: string;
  /** Primary series (e.g. new requests). */
  a: number;
  /** Secondary series (e.g. issued visas). */
  b: number;
}

export function MonthlyBars({
  months,
  aLabel = "درخواست جدید",
  bLabel = "ویزای صادر شده",
  selectedKey,
  onSelect,
  height = 200,
}: {
  months: BarMonth[];
  aLabel?: string;
  bLabel?: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const mounted = useMounted();
  if (months.length === 0 || months.every((m) => m.a === 0 && m.b === 0)) {
    return <ChartEmpty height={height} />;
  }

  const max = Math.max(1, ...months.map((m) => Math.max(m.a, m.b)));
  const labelH = 26;
  const plotH = height - labelH;
  const groupW = 46;
  const barW = 13;
  const width = Math.max(320, months.length * groupW + 16);
  const scale = (v: number) => (v / max) * (plotH - 14);

  // RTL: index 0 (oldest) renders at the RIGHT edge.
  const xOf = (i: number) => width - 8 - (i + 1) * groupW + (groupW - barW * 2 - 6) / 2;

  return (
    <div className="w-full overflow-x-auto" dir="rtl">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block select-none"
        role="img"
        aria-label={`نمودار ${aLabel} و ${bLabel}`}
      >
        <defs>
          <linearGradient id={`ba-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b85ff" />
            <stop offset="100%" stopColor="#635BFF" />
          </linearGradient>
          <linearGradient id={`bb-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={plotH - f * (plotH - 14)}
            y2={plotH - f * (plotH - 14)}
            className="stroke-ink-900/8 dark:stroke-white/8"
            strokeDasharray="3 5"
            strokeWidth={1}
          />
        ))}
        {months.map((m, i) => {
          const x = xOf(i);
          const aH = Math.max(m.a > 0 ? 4 : 0, scale(m.a));
          const bH = Math.max(m.b > 0 ? 4 : 0, scale(m.b));
          const active = selectedKey === m.key;
          return (
            <g
              key={m.key}
              className="cursor-pointer transition-opacity"
              opacity={selectedKey && !active ? 0.45 : 1}
              onClick={() => onSelect?.(m.key)}
            >
              <title>{`${m.label}\n${aLabel}: ${toPersianDigits(m.a)}\n${bLabel}: ${toPersianDigits(m.b)}`}</title>
              {active && (
                <rect
                  x={x - 8}
                  y={2}
                  width={groupW - 4}
                  height={height - 6}
                  rx={10}
                  className="fill-brand-500/10"
                />
              )}
              <rect
                x={x}
                y={plotH - (mounted ? aH : 0)}
                width={barW}
                height={mounted ? aH : 0}
                rx={4}
                fill={`url(#ba-${gid})`}
                style={{
                  transition: `y .55s cubic-bezier(.22,1,.36,1) ${i * 28}ms, height .55s cubic-bezier(.22,1,.36,1) ${i * 28}ms`,
                }}
              />
              <rect
                x={x + barW + 6}
                y={plotH - (mounted ? bH : 0)}
                width={barW}
                height={mounted ? bH : 0}
                rx={4}
                fill={`url(#bb-${gid})`}
                style={{
                  transition: `y .55s cubic-bezier(.22,1,.36,1) ${i * 28 + 70}ms, height .55s cubic-bezier(.22,1,.36,1) ${i * 28 + 70}ms`,
                }}
              />
              <text
                x={x + barW + 3}
                y={height - 9}
                textAnchor="middle"
                className={active ? "fill-brand-600 dark:fill-brand-300" : "fill-ink-500 dark:fill-ink-400"}
                fontSize={9.5}
                fontWeight={active ? 800 : 600}
              >
                {m.label}
              </text>
            </g>
          );
        })}
        {/* baseline */}
        <line x1={0} x2={width} y1={plotH} y2={plotH} className="stroke-ink-900/15 dark:stroke-white/15" />
      </svg>
      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] font-bold">
        <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-300">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          {aLabel}
        </span>
        <span className="flex items-center gap-1.5 text-[#0b9e6e] dark:text-[#3ddc9a]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
          {bLabel}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ money area -------------------------------- */

export interface MoneyPoint {
  key: string;
  label: string;
  value: number;
}

export function MoneyAreaChart({
  points,
  currency,
  selectedKey,
  onSelect,
  height = 190,
}: {
  points: MoneyPoint[];
  currency: Currency;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const mounted = useMounted();
  const nonzero = points.some((p) => p.value > 0);
  if (points.length < 2 || !nonzero) return <ChartEmpty height={height} />;

  const width = Math.max(320, points.length * 46 + 16);
  const labelH = 24;
  const plotH = height - labelH;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = (width - 24) / (points.length - 1);
  // RTL: oldest (index 0) on the right.
  const xOf = (i: number) => width - 12 - i * stepX;
  const yOf = (v: number) => plotH - 10 - (v / max) * (plotH - 26);

  const coords = points.map((p, i) => [xOf(i), yOf(p.value)] as const);

  // Smooth curve (Catmull-Rom → cubic beziers).
  let line = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[Math.max(0, i - 1)];
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const [x3, y3] = coords[Math.min(coords.length - 1, i + 2)];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    line += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${plotH} L${coords[0][0].toFixed(1)},${plotH} Z`;

  return (
    <div className="w-full overflow-x-auto" dir="rtl">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block select-none"
        role="img"
        aria-label="نمودار دریافتی ماهانه"
      >
        <defs>
          <linearGradient id={`ma-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={plotH - 10 - f * (plotH - 26)}
            y2={plotH - 10 - f * (plotH - 26)}
            className="stroke-ink-900/8 dark:stroke-white/8"
            strokeDasharray="3 5"
            strokeWidth={1}
          />
        ))}
        <path
          d={area}
          fill={`url(#ma-${gid})`}
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity .7s ease .15s",
          }}
        />
        <path
          d={line}
          fill="none"
          stroke="#10b981"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 2000,
            strokeDashoffset: mounted ? 0 : 2000,
            transition: "stroke-dashoffset 1s cubic-bezier(.22,1,.36,1)",
          }}
        />
        {coords.map(([x, y], i) => {
          const p = points[i];
          const active = selectedKey === p.key;
          return (
            <g key={p.key} className="cursor-pointer" onClick={() => onSelect?.(p.key)}>
              <title>{`${p.label}: ${compactMoney(p.value, currency)}`}</title>
              <circle cx={x} cy={y} r={active ? 5.5 : 3.5} fill="#10b981" stroke="#fff" strokeWidth={active ? 2 : 1.2} />
              <rect x={x - stepX / 2} y={0} width={stepX} height={height} fill="transparent" />
              <text
                x={x}
                y={height - 7}
                textAnchor="middle"
                className={active ? "fill-[#0b9e6e]" : "fill-ink-500 dark:fill-ink-400"}
                fontSize={9.5}
                fontWeight={active ? 800 : 600}
              >
                {p.label}
              </text>
            </g>
          );
        })}
        {/* max label */}
        <text x={12} y={yOf(max) + 3} className="fill-ink-400" fontSize={9} fontWeight={600}>
          {compactMoney(max, currency)}
        </text>
      </svg>
    </div>
  );
}

/* --------------------------------- donut ----------------------------------- */

export interface DonutSliceData {
  label: string;
  value: number;
  color: string;
}

export function StatsDonut({
  slices,
  centerLabel,
  centerValue,
  size = 172,
}: {
  slices: DonutSliceData[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}) {
  const mounted = useMounted();
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <ChartEmpty height={size} />;

  const r = size / 2 - 15;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const arc = { ...s, frac, dash: frac * c, offset };
    offset += frac * c;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="توزیع">
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
              strokeDasharray={`${mounted ? a.dash : 0} ${c}`}
              strokeDashoffset={-a.offset}
              style={{ transition: "stroke-dasharray .8s cubic-bezier(.22,1,.36,1)" }}
            >
              <title>{`${a.label}: ${toPersianDigits(a.value)} (${Math.round(a.frac * 100)}٪)`}</title>
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
      <div className="flex max-w-[190px] flex-col gap-1.5">
        {arcs.map((a) => (
          <span key={a.label} className="flex items-center gap-2 text-[11.5px] font-semibold">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="num shrink-0 text-ink-500 dark:text-ink-400">
              {toPersianDigits(a.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
