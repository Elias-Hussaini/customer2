import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import type { ExportColumn, ExportRow } from "../../utils/export/tabular";
import { formatJalali, formatTimestamp, todayIso } from "../../utils/jalali";

const BRAND = "#635bff";
const BRAND_DARK = "#5344d6";
const INK = "#1b2138";
const MUTED = "#7a829c";
const BORDER = "#e4e6f0";
const ROW_BORDER = "#ececf5";
const ZEBRA = "#f8f8fe";
const HEAD_FONT = "700 12px Vazirmatn";
const CELL_FONT = "400 12.5px Vazirmatn";
const PAGE_PAD = 44;
const MIN_DOC_WIDTH = 900;
const MAX_DOC_WIDTH = 2400;
const CELL_HPAD = 13;
/** Columns rendered bold (money figures). */
const BOLD_KEYS = new Set(["amount", "quoted", "paid", "balance", "total", "issued"]);

/* ------------------------- text measuring (canvas) ------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  const c = document.createElement("canvas");
  measureCtx = c.getContext("2d");
  return measureCtx;
}
function textWidth(text: string, font: string): number {
  const ctx = ctx2d();
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}
/** Trim with ellipsis so the string fits maxPx on a single line. */
function fitToWidth(text: string, font: string, max: number): string {
  if (max <= 8) return "…";
  if (textWidth(text, font) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid).trimEnd() + "…", font) <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

/* --------------------------------- layout -------------------------------- */

interface Layout {
  docWidth: number;
  widths: number[];
  /** display[i][j] — truncated single-line string for row i, column j */
  display: string[][];
  headers: string[];
}

function buildLayout(columns: ExportColumn[], rows: ExportRow[]): Layout {
  // Natural width of every column = widest content (header or any cell).
  const natural = columns.map((c) => {
    let w = textWidth(c.header, HEAD_FONT);
    for (const row of rows) {
      const v = row[c.key];
      if (v != null && v !== "") w = Math.max(w, textWidth(String(v), CELL_FONT));
    }
    return Math.max(72, Math.ceil(w) + CELL_HPAD * 2 + 6);
  });

  let widths = natural.slice();
  let docWidth = widths.reduce((a, b) => a + b, 0) + PAGE_PAD * 2;
  if (docWidth < MIN_DOC_WIDTH) {
    // Stretch so small tables still look full-width and airy.
    const extra = (MIN_DOC_WIDTH - docWidth) / widths.length;
    widths = widths.map((w) => w + extra);
    docWidth = MIN_DOC_WIDTH;
  } else if (docWidth > MAX_DOC_WIDTH) {
    const target = MAX_DOC_WIDTH - PAGE_PAD * 2;
    const scale = target / widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => w * scale);
    docWidth = MAX_DOC_WIDTH;
  }

  const headers = columns.map((c, i) =>
    fitToWidth(c.header, HEAD_FONT, widths[i] - CELL_HPAD * 2),
  );
  const display = rows.map((row) =>
    columns.map((c, i) => {
      const v = row[c.key];
      const s = v == null || v === "" ? "—" : String(v);
      return fitToWidth(s, CELL_FONT, widths[i] - CELL_HPAD * 2);
    }),
  );
  return { docWidth, widths, display, headers };
}

/* --------------------------------- tones ---------------------------------- */

function statusTone(v: string): { bg: string; fg: string } | null {
  if (v.includes("صادر")) return { bg: "#e5f6ec", fg: "#0b7a55" };
  if (v.includes("در حال")) return { bg: "#fdf2dd", fg: "#a56a06" };
  if (v.includes("رد ") || v.includes("لغو")) return { bg: "#fdeaea", fg: "#c0392b" };
  return null;
}

/* -------------------------------- component ------------------------------- */

/**
 * Print-styled export document — RTL, Vazirmatn, pure inline styles with
 * hex/rgb colors only (html2canvas-safe).
 *
 * The page width auto-fits the content so every cell stays on ONE centered
 * line — no wrapping, no cramped columns. Long notes are trimmed with "…".
 */
export const ExportDoc = forwardRef<
  HTMLDivElement,
  {
    title: string;
    subtitle?: string;
    columns: ExportColumn[];
    rows: ExportRow[];
    summary?: { label: string; value: string }[];
    /** Fired once the auto-width layout is measured and rendered. */
    onReady?: () => void;
  }
>(function ExportDoc({ title, subtitle, columns, rows, summary, onReady }, ref) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Measure in a layout effect (after Vazirmatn is guaranteed loaded) so the
  // captured pixels exactly match the measured widths.
  useLayoutEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await Promise.all([
          document.fonts.load(CELL_FONT),
          document.fonts.load(HEAD_FONT),
          document.fonts.load("800 17px Vazirmatn"),
        ]);
      } catch {
        /* fall back to system metrics */
      }
      if (!alive) return;
      setLayout(buildLayout(columns, rows));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (layout) onReadyRef.current?.();
  }, [layout]);

  return (
    <div
      ref={ref}
      dir="rtl"
      style={{
        width: `${layout?.docWidth ?? MIN_DOC_WIDTH}px`,
        padding: `40px ${PAGE_PAD}px 48px`,
        backgroundColor: "#ffffff",
        color: INK,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: "12.5px",
        lineHeight: "1.6",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          paddingBottom: "15px",
          borderBottom: `2px solid ${BRAND}`,
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "13px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "14px",
              background: `linear-gradient(135deg, #837aff, #5344d6)`,
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "16px",
            }}
          >
            EM
          </div>
          <div>
            <div style={{ fontSize: "17px", fontWeight: 800 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: "11.5px", color: MUTED, marginTop: "2px" }}>{subtitle}</div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "left", fontSize: "10.5px", color: MUTED }}>
          <div dir="ltr">E-managment — Visa Management</div>
          <div>تاریخ گزارش: {formatJalali(todayIso(), "long")}</div>
        </div>
      </div>

      {/* Summary chips */}
      {summary && summary.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
          {summary.map((s) => (
            <div
              key={s.label}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: "999px",
                padding: "6px 14px",
                fontSize: "11.5px",
                backgroundColor: "#f3f1ff",
              }}
            >
              <span style={{ color: MUTED }}>{s.label}: </span>
              <span style={{ fontWeight: 700 }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Table — auto width, single-line centered cells */}
      {layout && (
        <div
          style={{
            borderRadius: "14px",
            overflow: "hidden",
            border: "1px solid #d9d6f2",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {layout.widths.map((w, i) => (
                <col key={i} style={{ width: `${Math.floor(w)}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: `linear-gradient(180deg, ${BRAND}, ${BRAND_DARK})` }}>
                {layout.headers.map((h, i) => (
                  <th
                    key={columns[i].key}
                    style={{
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 700,
                      textAlign: "center",
                      padding: "12px 10px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      ...(i > 0 ? { borderRight: "1px solid rgba(255,255,255,0.28)" } : {}),
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layout.display.map((cells, r) => (
                <tr
                  key={r}
                  style={{
                    backgroundColor: r % 2 === 1 ? ZEBRA : "#ffffff",
                  }}
                >
                  {cells.map((s, i) => {
                    const key = columns[i].key;
                    const tone = key === "status" ? statusTone(s) : null;
                    return (
                      <td
                        key={key}
                        style={{
                          padding: "10px 10px",
                          fontSize: "12.5px",
                          textAlign: "center",
                          verticalAlign: "middle",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          color: s === "—" ? "#b6bbcd" : INK,
                          ...(i > 0 ? { borderRight: `1px solid ${ROW_BORDER}` } : {}),
                          ...(r < layout.display.length - 1
                            ? { borderBottom: `1px solid ${ROW_BORDER}` }
                            : {}),
                        }}
                      >
                        {tone ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 11px",
                              borderRadius: "999px",
                              backgroundColor: tone.bg,
                              color: tone.fg,
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            {s}
                          </span>
                        ) : (
                          <span style={BOLD_KEYS.has(key) ? { fontWeight: 700 } : undefined}>{s}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    style={{
                      padding: "28px",
                      textAlign: "center",
                      color: MUTED,
                      backgroundColor: "#ffffff",
                    }}
                  >
                    رکوردی برای نمایش وجود ندارد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          marginTop: "18px",
          paddingTop: "11px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          justifyContent: "space-between",
          fontSize: "10px",
          color: MUTED,
        }}
      >
        <span>تعداد ردیف‌ها: {String(rows.length).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])}</span>
        <span>ساخته‌شده در {formatTimestamp(Date.now())}</span>
      </div>
    </div>
  );
});
