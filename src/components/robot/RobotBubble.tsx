/**
 * Robot Companion — transient message bubble.
 *
 * Shows ONLY real content: AI replies produced by the user's workers, or an
 * explicit typing/status indicator. App feedback (toasts, form validation)
 * deliberately never lands here — the robot reacts to those with animation
 * states instead of fabricated sentences.
 */

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../agent/Markdown";
import type { RobotMessage } from "../../lib/robot/types";

export interface RobotBubbleProps {
  message: RobotMessage | null;
  /** Typing indicator instead of content. */
  typing?: boolean;
  /** Status line under the typing dots ("در حال فکر کردن…"). */
  status?: string;
  onDismiss: () => void;
}

const BUBBLE_MS = 9000;

export function RobotBubble({ message, typing, status, onDismiss }: RobotBubbleProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!message && !typing) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (!typing) {
      timer.current = setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, BUBBLE_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, typing, onDismiss]);

  if (!message && !typing) return null;

  return (
    <div
      dir="rtl"
      className={`pointer-events-auto absolute top-1 left-0 w-72 -translate-x-2 transition-all duration-300 sm:w-80 ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }`}
      role="status"
    >
      <div className="glass relative rounded-3xl rounded-tr-lg p-3.5 shadow-xl shadow-ink-950/10">
        <button
          className="absolute top-2 left-2 rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-500/8 hover:text-ink-600"
          onClick={() => {
            setVisible(false);
            onDismiss();
          }}
          aria-label="بستن پیام"
        >
          <X size={13} />
        </button>

        {typing ? (
          <div className="flex flex-col items-start gap-2 py-1">
            <div className="flex items-center gap-1.5">
              <span className="dot-flash h-2 w-2 rounded-full bg-brand-500" />
              <span className="dot-flash h-2 w-2 rounded-full bg-brand-500 [animation-delay:180ms]" />
              <span className="dot-flash h-2 w-2 rounded-full bg-brand-500 [animation-delay:360ms]" />
            </div>
            {status ? (
              <p className="text-[11px] font-semibold text-ink-500 dark:text-ink-400">{status}</p>
            ) : null}
          </div>
        ) : message ? (
          <div className="max-h-64 overflow-y-auto pl-4 text-right">
            {message.role === "system" ? (
              <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">{message.text}</p>
            ) : (
              <div className="robot-md text-[12px] leading-6">
                <Markdown text={preview(message.text)} />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Bubble preview: first paragraph-ish chunk — the panel shows the full text. */
function preview(text: string): string {
  const t = text.trim();
  if (t.length <= 420) return t;
  return `${t.slice(0, 420)}…
\n*برای ادامه، روی ربات کلیک کنید.*`;
}
