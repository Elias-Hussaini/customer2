/**
 * CopyRow — a detail-page field row with a tiny copy chip that only appears
 * when the mouse is over the row (exactly like the user asked). Touch users
 * see it as soon as they tap-and-hold / focus the row; a tap on the chip
 * copies the value and toasts «کپی شد».
 *
 * `copy` is the raw value that should hit the clipboard (a masked display
 * may hide it). Pass null/empty to render a muted «—» without the chip.
 */

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "../../hooks/useToast";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyRow({
  label,
  display,
  copy,
  copyLabel,
  className,
}: {
  label: ReactNode;
  /** What is shown as the value (may be a link, masked text…). */
  display?: ReactNode;
  /** Raw string that goes to the clipboard. Empty/undefined = no chip. */
  copy?: string | null;
  /** Optional description in the toast, e.g. «شماره تماس کپی شد». */
  copyLabel?: string;
  className?: string;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const hasCopy = Boolean(copy && copy.trim());

  const onCopy = async () => {
    if (!copy || !hasCopy) return;
    const ok = await copyText(copy);
    if (ok) {
      setDone(true);
      toast.success(copyLabel ? `${copyLabel} کپی شد` : "کپی شد");
      setTimeout(() => setDone(false), 1200);
    } else {
      toast.error("کپی در کلیپ‌بورد ممکن نشد");
    }
  };

  return (
    <div
      className={`group/copy relative flex items-center justify-between gap-3 border-b border-ink-900/5 py-2.5 text-[13px] last:border-0 dark:border-white/5 ${className ?? ""}`}
    >
      <span className="shrink-0 text-ink-500 dark:text-ink-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate">{display ?? <span className="text-ink-400">—</span>}</span>
        {hasCopy && (
          <button
            type="button"
            onClick={onCopy}
            title={copyLabel ? `کپی ${copyLabel}` : "کپی"}
            aria-label={copyLabel ? `کپی ${copyLabel}` : "کپی"}
            className={`h-6 w-6 shrink-0 rounded-lg transition-all ${
              done
                ? "bg-[#10b981] text-white"
                : "bg-brand-500/10 text-brand-600 opacity-0 hover:bg-brand-500 hover:text-white focus-visible:opacity-100 group-hover/copy:opacity-100 dark:text-brand-300 dark:hover:text-white"
            }`}
          >
            {done ? <Check size={13} className="mx-auto" /> : <Copy size={12} className="mx-auto" />}
          </button>
        )}
      </span>
    </div>
  );
}
