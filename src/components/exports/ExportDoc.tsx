import { forwardRef } from "react";
import type { ExportColumn, ExportRow } from "../../utils/export/tabular";
import { formatJalali, formatTimestamp, todayIso } from "../../utils/jalali";

const BRAND = "#635bff";
const INK = "#1b2138";
const MUTED = "#7a829c";
const BORDER = "#e4e6f0";
const ZEBRA = "#f8f8fe";

/**
 * Print-styled export document — RTL, Vazirmatn, pure inline styles with
 * hex/rgb colors only (html2canvas-safe).
 */
export const ExportDoc = forwardRef<
  HTMLDivElement,
  {
    title: string;
    subtitle?: string;
    columns: ExportColumn[];
    rows: ExportRow[];
    summary?: { label: string; value: string }[];
  }
>(function ExportDoc({ title, subtitle, columns, rows, summary }, ref) {
  const cell = (v: unknown): string => {
    if (v == null || v === "") return "—";
    return String(v);
  };

  return (
    <div
      ref={ref}
      dir="rtl"
      style={{
        width: "794px",
        padding: "36px 40px 44px",
        backgroundColor: "#ffffff",
        color: INK,
        fontFamily: "Vazirmatn, Tahoma, sans-serif",
        fontSize: "12px",
        lineHeight: "1.7",
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
          paddingBottom: "14px",
          borderBottom: `2px solid ${BRAND}`,
          marginBottom: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "13px",
              background: `linear-gradient(135deg, #837aff, #5344d6)`,
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "15px",
            }}
          >
            2C
          </div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: "11px", color: MUTED, marginTop: "2px" }}>{subtitle}</div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "left", fontSize: "10.5px", color: MUTED }}>
          <div>۲کاستومر — مدیریت ویزا</div>
          <div>تاریخ گزارش: {formatJalali(todayIso(), "long")}</div>
        </div>
      </div>

      {/* Summary chips */}
      {summary && summary.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
          {summary.map((s) => (
            <div
              key={s.label}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: "10px",
                padding: "5px 12px",
                fontSize: "11px",
                backgroundColor: ZEBRA,
              }}
            >
              <span style={{ color: MUTED }}>{s.label}: </span>
              <span style={{ fontWeight: 700 }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  backgroundColor: "#f3f1ff",
                  color: BRAND,
                  fontSize: "11px",
                  fontWeight: 700,
                  textAlign: "right",
                  padding: "8px 10px",
                  border: `1px solid ${BORDER}`,
                  wordBreak: "break-word",
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 1 ? ZEBRA : "#ffffff" }}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    padding: "7px 10px",
                    border: `1px solid ${BORDER}`,
                    fontSize: "11px",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {cell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: "24px", textAlign: "center", color: MUTED, border: `1px solid ${BORDER}` }}
              >
                رکوردی برای نمایش وجود ندارد
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div
        style={{
          marginTop: "16px",
          paddingTop: "10px",
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
