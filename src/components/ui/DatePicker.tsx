import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  GREGORIAN_MONTHS,
  GREGORIAN_WEEKDAYS_SHORT,
  JALALI_MONTHS,
  WEEKDAYS_SHORT,
  compareIso,
  formatGregorian,
  formatJalali,
  gregorianMonthGrid,
  isoToGregorianParts,
  isoToJalali,
  monthGrid,
  parseGregorianInput,
  parseJalaliInput,
  todayIso,
  toLatinDigits,
  toPersianDigits,
} from "../../utils/jalali";
import type { CalendarMode } from "../../types";
import { Floating, isFloatingPanel } from "./Floating";

interface DatePickerProps {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  /** Which calendar the picker & text input use. Defaults to Jalali. */
  calendar?: CalendarMode;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

interface MonthView {
  year: number;
  month: number;
}

/**
 * Dual-calendar glass date picker — renders a Jalali or Gregorian month grid
 * depending on `calendar`. Value is always ISO yyyy-mm-dd (Gregorian) internally.
 */
export function DatePicker({
  value,
  onChange,
  calendar = "jalali",
  placeholder,
  clearable = true,
  disabled,
  className = "",
  id,
}: DatePickerProps) {
  const isGregorian = calendar === "gregorian";

  const initialView = (): MonthView => {
    if (isGregorian) {
      const g = isoToGregorianParts(value) ?? isoToGregorianParts(todayIso());
      return g ? { year: g.gy, month: g.gm } : { year: 2024, month: 1 };
    }
    const j = isoToJalali(value) ?? isoToJalali(todayIso());
    return j ? { year: j.jy, month: j.jm } : { year: 1404, month: 1 };
  };

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MonthView>(initialView);
  const [text, setText] = useState(() => (value ? formatValue(value) : ""));
  const [textFocused, setTextFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipNextOutside = useRef(false);

  function formatValue(iso: string | null): string {
    return isGregorian ? formatGregorian(iso) : formatJalali(iso);
  }

  useEffect(() => {
    if (!textFocused) setText(value ? formatValue(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, textFocused, calendar]);

  useEffect(() => {
    if (value) {
      const v = isGregorian
        ? (() => {
            const g = isoToGregorianParts(value);
            return g ? { year: g.gy, month: g.gm } : null;
          })()
        : (() => {
            const j = isoToJalali(value);
            return j ? { year: j.jy, month: j.jm } : null;
          })();
      if (v) setView(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open]);

  // Switch view when calendar mode changes (e.g. setting toggled while open).
  useEffect(() => {
    setView(initialView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(t) && !isFloatingPanel(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const grid = useMemo(
    () =>
      isGregorian
        ? gregorianMonthGrid(view.year, view.month)
        : monthGrid(view.year, view.month),
    [view, isGregorian],
  );
  const today = todayIso();

  const dayNumberOf = (iso: string): string => {
    if (isGregorian) {
      return String(isoToGregorianParts(iso)?.gd ?? "");
    }
    return toPersianDigits(isoToJalali(iso)?.jd ?? "");
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      let month = v.month + delta;
      let year = v.year;
      if (month > 12) {
        month = 1;
        year++;
      }
      if (month < 1) {
        month = 12;
        year--;
      }
      return { year, month };
    });
  };

  const commitText = () => {
    setTextFocused(false);
    if (!text.trim()) {
      if (clearable) onChange(null);
      return;
    }
    const iso = isGregorian ? parseGregorianInput(text) : parseJalaliInput(text);
    if (iso) {
      onChange(iso);
    } else {
      setText(value ? formatValue(value) : "");
    }
  };

  const dayClass = (iso: string | null) => {
    if (!iso) return "pointer-events-none";
    const isToday = iso === today;
    const isSelected = value != null && iso === value;
    const isFuture = compareIso(iso, today) > 0;
    if (isSelected) {
      return "bg-brand-500 text-white font-bold shadow-[0_6px_16px_-4px_rgba(99,91,255,0.55)] scale-[1.06]";
    }
    if (isToday) {
      return "text-brand-600 dark:text-brand-300 font-bold ring-[1.5px] ring-brand-500/45";
    }
    if (isFuture) {
      return "text-ink-500 dark:text-ink-400 hover:bg-brand-500/10";
    }
    return "hover:bg-brand-500/10";
  };

  const weekdays = isGregorian ? GREGORIAN_WEEKDAYS_SHORT : WEEKDAYS_SHORT;
  const monthLabel = isGregorian
    ? GREGORIAN_MONTHS[view.month - 1]
    : JALALI_MONTHS[view.month - 1];
  const yearLabel = isGregorian
    ? String(view.year)
    : toPersianDigits(view.year);
  const defaultPlaceholder = isGregorian ? "2024/05/13" : "۱۴۰۳/۰۱/۰۱";

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <div className="relative">
        <input
          id={id}
          dir="ltr"
          className={`field num pl-9 text-right ${open ? "border-brand-500" : ""}`}
          value={text}
          placeholder={placeholder ?? defaultPlaceholder}
          disabled={disabled}
          inputMode="numeric"
          onFocus={() => {
            setTextFocused(true);
            skipNextOutside.current = false;
            setOpen(true);
          }}
          onBlur={commitText}
          onChange={(e) =>
            setText(
              isGregorian ? toLatinDigits(e.target.value) : toPersianDigits(toLatinDigits(e.target.value)),
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-brand-500"
          onClick={() => {
            if (skipNextOutside.current) {
              skipNextOutside.current = false;
              return;
            }
            setOpen((o) => !o);
          }}
          aria-label="تقویم"
        >
          <CalendarDays size={16} />
        </button>
      </div>

      {open && (
        <Floating
          open={open && !disabled}
          anchorRef={wrapRef}
          width={286}
          placement="bottom"
          align="right"
          className="rounded-3xl p-3.5"
          onClose={() => setOpen(false)}
        >
          {/* header */}
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="icon-btn !h-8 !w-8" onClick={() => shiftMonth(-1)} aria-label="ماه قبل">
              <ChevronRight size={16} />
            </button>
            <div className="flex items-center gap-1">
              <span className="text-[13px] font-bold">{monthLabel}</span>
              <div className="flex items-center">
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7"
                  onClick={() => setView((v) => ({ ...v, year: v.year - 1 }))}
                  aria-label="سال قبل"
                >
                  <ChevronRight size={13} />
                </button>
                <span className="num min-w-[46px] text-center text-[13px] font-bold">{yearLabel}</span>
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7"
                  onClick={() => setView((v) => ({ ...v, year: v.year + 1 }))}
                  aria-label="سال بعد"
                >
                  <ChevronLeft size={13} />
                </button>
              </div>
            </div>
            <button type="button" className="icon-btn !h-8 !w-8" onClick={() => shiftMonth(1)} aria-label="ماه بعد">
              <ChevronLeft size={16} />
            </button>
          </div>
          {/* weekdays */}
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-bold text-ink-400">
            {weekdays.map((d, i) => (
              <span key={i} className={isGregorian ? "font-mono py-1" : "py-1"}>
                {d}
              </span>
            ))}
          </div>
          {/* days */}
          <div className="grid grid-cols-7 gap-px">
            {grid.map((iso, i) => (
              <button
                key={i}
                type="button"
                disabled={!iso}
                className={`num flex h-9 items-center justify-center rounded-xl text-[12.5px] transition-all duration-100 ${dayClass(
                  iso,
                )}`}
                onClick={() => {
                  if (iso) {
                    onChange(iso);
                    setOpen(false);
                  }
                }}
              >
                {iso ? dayNumberOf(iso) : ""}
              </button>
            ))}
          </div>
          {/* footer */}
          <div className="mt-2.5 flex items-center justify-between border-t border-ink-900/5 pt-2.5 dark:border-white/5">
            <button
              type="button"
              className="rounded-xl px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-500/10 dark:text-brand-300"
              onClick={() => {
                onChange(todayIso());
                setOpen(false);
              }}
            >
              امروز
            </button>
            {clearable && (
              <button
                type="button"
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-500/10"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                پاک کردن
              </button>
            )}
          </div>
        </Floating>
      )}
    </div>
  );
}
