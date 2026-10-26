import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  JALALI_MONTHS,
  WEEKDAYS_SHORT,
  formatJalali,
  isoToJalali,
  type JalaliParts,
  jalaliToIso,
  monthGrid,
  parseJalaliInput,
  todayIso,
  toLatinDigits,
  toPersianDigits,
  compareIso,
} from "../../utils/jalali";
import { Floating, isFloatingPanel } from "./Floating";

interface JalaliDatePickerProps {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** Persian (Jalali) date input with a glass calendar popover. */
export function JalaliDatePicker({
  value,
  onChange,
  placeholder = "۱۴۰۳/۰۱/۰۱",
  clearable = true,
  disabled,
  className = "",
  id,
}: JalaliDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<JalaliParts>(() =>
    isoToJalali(value) ?? isoToJalali(todayIso()) ?? { jy: 1404, jm: 1, jd: 1 },
  );
  const [text, setText] = useState(() => (value ? formatJalali(value) : ""));
  const [textFocused, setTextFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipNextOutside = useRef(false);

  useEffect(() => {
    if (!textFocused) setText(value ? formatJalali(value) : "");
  }, [value, textFocused]);

  useEffect(() => {
    if (value) {
      const j = isoToJalali(value);
      if (j) setView(j);
    }
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(t) && !isFloatingPanel(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const grid = useMemo(() => monthGrid(view.jy, view.jm), [view]);
  const today = todayIso();

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const base = v ?? { jy: 1404, jm: 1, jd: 1 };
      let jm = base.jm + delta;
      let jy = base.jy;
      if (jm > 12) {
        jm = 1;
        jy++;
      }
      if (jm < 1) {
        jm = 12;
        jy--;
      }
      return { jy, jm, jd: 1 };
    });
  };

  const commitText = () => {
    setTextFocused(false);
    if (!text.trim()) {
      if (clearable) onChange(null);
      return;
    }
    const iso = parseJalaliInput(text);
    if (iso) {
      onChange(iso);
    } else {
      setText(value ? formatJalali(value) : "");
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

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <div className="relative">
        <input
          id={id}
          dir="ltr"
          className={`field num pl-9 text-right ${open ? "border-brand-500" : ""}`}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          inputMode="numeric"
          onFocus={() => {
            setTextFocused(true);
            skipNextOutside.current = false;
            setOpen(true);
          }}
          onBlur={commitText}
          onChange={(e) => setText(toPersianDigits(toLatinDigits(e.target.value)))}
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
              <span className="text-[13px] font-bold">{JALALI_MONTHS[view.jm - 1]}</span>
              <div className="flex items-center">
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7"
                  onClick={() => setView((v) => ({ ...(v ?? { jy: 1404, jm: 1, jd: 1 }), jy: (v?.jy ?? 1404) - 1 }))}
                  aria-label="سال قبل"
                >
                  <ChevronRight size={13} />
                </button>
                <span className="num min-w-[46px] text-center text-[13px] font-bold">
                  {toPersianDigits(view.jy)}
                </span>
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7"
                  onClick={() => setView((v) => ({ ...(v ?? { jy: 1404, jm: 1, jd: 1 }), jy: (v?.jy ?? 1404) + 1 }))}
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
            {WEEKDAYS_SHORT.map((d, i) => (
              <span key={i} className="py-1">
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
                {iso ? toPersianDigits(isoToJalali(iso)!.jd) : ""}
              </button>
            ))}
          </div>
          {/* footer */}
          <div className="mt-2.5 flex items-center justify-between border-t border-ink-900/5 pt-2.5 dark:border-white/5">
            <button
              type="button"
              className="rounded-xl px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-500/10 dark:text-brand-300"
              onClick={() => {
                onChange(today);
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
