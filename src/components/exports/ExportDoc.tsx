import { forwardRef, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import type { ExportColumn, ExportGroup, ExportRow } from "../../utils/export/tabular";
import { computeExportStats, groupLabel } from "../../utils/export/tabular";
import { formatJalali, formatTimestamp, todayIso, toPersianDigits } from "../../utils/jalali";

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

/** A cell that IS a status value (short + starts with a status phrase) —
 *  never a long note that merely mentions one. */
function isStatusCell(s: string): boolean {
  const t = s.trim();
  if (t.length > 22) return false;
  return (
    (t.startsWith("صادر") || t.startsWith("در حال") || t.startsWith("رد ") || t.startsWith("لغو")) &&
    statusTone(t) != null
  );
}

/* -------------------------------- component ------------------------------- */

export interface ExportDocGroupMeta {
  /** group value → profile photo (data URL) shown small next to the name. */
  photos?: Record<string, string | undefined>;
  /** Persian word for what is grouped — «بدون …» label for empty cells. */
  what?: string;
}

/**
 * Print-styled export document — RTL, Vazirmatn, pure inline styles with
 * hex/rgb colors only (html2canvas-safe).
 *
 * The page width auto-fits the content so every cell stays on ONE centered
 * line — no wrapping, no cramped columns. Long notes are trimmed with "…".
 *
 * When `groups` is set, rows are rendered section-by-section — one
 * representative completely (with a small profile photo + name + row count
 * band), then the next representative below it.
 */
export const ExportDoc = forwardRef<
  HTMLDivElement,
  {
    title: string;
    subtitle?: string;
    columns: ExportColumn[];
    rows: ExportRow[];
    summary?: { label: string; value: string }[];
    /** Optional grouping (e.g. by representative) — see groupExportRows. */
    groups?: ExportGroup[];
    /** Photos + wording for the section bands. */
    groupMeta?: ExportDocGroupMeta;
    /** Fired once the auto-width layout is measured and rendered. */
    onReady?: () => void;
  }
>(function ExportDoc({ title, subtitle, columns, rows, summary, groups, groupMeta, onReady }, ref) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Smart scope statistics — computed from the actual exported rows so the
  // footer always describes exactly what this output contains (all reps vs.
  // one rep, issued vs. in-progress counts, list count).
  const stats = useMemo(() => computeExportStats(columns, rows), [columns, rows]);

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
              <tr data-export-head style={{ background: `linear-gradient(180deg, ${BRAND}, ${BRAND_DARK})` }}>
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
              {(() => {
                if (groups && groups.length > 0) {
                  // Sectioned layout: one representative fully, then the next.
                  let idx = 0;
                  return groups.map((g, gi) => {
                    const first = idx;
                    idx += g.rows.length;
                    return (
                      <Fragment key={`g-${gi}-${g.value}`}>
                        <SectionBand
                          label={groupLabel(g.value, groupMeta?.what ?? "نماینده")}
                          photo={groupMeta?.photos?.[g.value]}
                          count={g.rows.length}
                          colCount={columns.length}
                        />
                        {layout.display.slice(first, first + g.rows.length).map((cells, r) => (
                          <DataRow
                            key={`gr-${gi}-${r}`}
                            cells={cells}
                            columns={columns}
                            r={r}
                            last={first + r === layout.display.length - 1}
                          />
                        ))}
                      </Fragment>
                    );
                  });
                }
                return layout.display.map((cells, r) => (
                  <DataRow
                    key={r}
                    cells={cells}
                    columns={columns}
                    r={r}
                    last={r === layout.display.length - 1}
                  />
                ));
              })()}
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

      {/* Smart summary footer — describes exactly what this output contains:
          total rows, representative scope (one name vs. a count), list count,
          issued / in-progress / rejected counts. */}
      <div
        data-export-footer
        style={{
          marginTop: "18px",
          paddingTop: "13px",
          borderTop: `1.5px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 800, color: BRAND_DARK }}>جمع‌بندی:</span>
          <FooterChip label="کل رکوردها" value={toPersianDigits(stats.total)} />
          {stats.hasRepresentative &&
            (stats.representatives.length === 1 ? (
              <FooterChip label="نماینده" value={stats.representatives[0]} />
            ) : (
              <FooterChip label="نمایندگان" value={toPersianDigits(stats.representatives.length)} />
            ))}
          {stats.lists.length > 1 && (
            <FooterChip label="لیست‌ها" value={toPersianDigits(stats.lists.length)} />
          )}
          {stats.hasStatus && (
            <>
              <FooterChip
                label="صادر شده"
                value={toPersianDigits(stats.issued)}
                bg="#e5f6ec"
                fg="#0b7a55"
              />
              <FooterChip
                label="در حال کار"
                value={toPersianDigits(stats.inProgress)}
                bg="#fdf2dd"
                fg="#a56a06"
              />
              {stats.rejected > 0 && (
                <FooterChip
                  label="رد شده"
                  value={toPersianDigits(stats.rejected)}
                  bg="#fdeaea"
                  fg="#c0392b"
                />
              )}
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "10px",
            fontSize: "10px",
            color: MUTED,
          }}
        >
          <span>ساخته‌شده در {formatTimestamp(Date.now())}</span>
          <span dir="ltr">E-managment</span>
        </div>
      </div>
    </div>
  );
});

/** One data row of the export table (zebra + status pills). */
function DataRow({
  cells,
  columns,
  r,
  last,
}: {
  cells: string[];
  columns: ExportColumn[];
  r: number;
  last: boolean;
}) {
  return (
    <tr data-export-row style={{ backgroundColor: r % 2 === 1 ? ZEBRA : "#ffffff" }}>
      {cells.map((s, i) => {
        const key = columns[i].key;
        const tone = isStatusCell(s) ? statusTone(s) : null;
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
              ...(last ? {} : { borderBottom: `1px solid ${ROW_BORDER}` }),
            }}
          >
            {tone ? (
              /* html2canvas does not center inline-block children
               * via text-align — an explicit flex wrapper is the
               * reliable way to keep the pill centered in PDF/PNG. */
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    padding: "3px 11px",
                    borderRadius: "999px",
                    backgroundColor: tone.bg,
                    color: tone.fg,
                    fontSize: "11px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {s}
                </span>
              </div>
            ) : (
              <span style={BOLD_KEYS.has(key) ? { fontWeight: 700 } : undefined}>{s}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** Section band — [photo] نام نماینده + row count — starts a group. */
function SectionBand({
  label,
  photo,
  count,
  colCount,
}: {
  label: string;
  photo?: string;
  count: number;
  colCount: number;
}) {
  return (
    <tr data-export-section>
      <td
        colSpan={colCount}
        style={{
          padding: "9px 12px",
          backgroundColor: "#f3f1ff",
          borderBottom: `1.5px solid #d9d6f2`,
          borderTop: "1.5px solid #d9d6f2",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          {photo ? (
            <img
              src={photo}
              alt=""
              width={27}
              height={27}
              style={{
                width: "27px",
                height: "27px",
                borderRadius: "999px",
                objectFit: "cover",
                border: "1.5px solid #ffffff",
                boxShadow: "0 1px 4px rgba(27,33,56,0.25)",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: "27px",
                height: "27px",
                borderRadius: "999px",
                backgroundColor: "#837aff",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {label.trim().charAt(0) || "?"}
            </div>
          )}
          <span style={{ fontSize: "13px", fontWeight: 800, color: "#3d35a8" }}>{label}</span>
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              color: "#6f76c9",
              backgroundColor: "#ffffff",
              border: "1px solid #d9d6f2",
              borderRadius: "999px",
              padding: "2px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {toPersianDigits(count)} رکورد
          </span>
        </div>
      </td>
    </tr>
  );
}

/** A small summary chip for the smart footer. */
function FooterChip({
  label,
  value,
  bg = "#f3f1ff",
  fg,
}: {
  label: string;
  value: string;
  bg?: string;
  fg?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        border: `1px solid ${BORDER}`,
        borderRadius: "999px",
        padding: "4px 12px",
        fontSize: "11px",
        backgroundColor: bg,
        color: fg ?? INK,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: fg ? undefined : MUTED }}>{label}:</span>
      <span style={{ fontWeight: 800 }}>{value}</span>
    </span>
  );
}
