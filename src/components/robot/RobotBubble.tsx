/**
 * Robot Companion — transient reaction bubble.
 *
 * Shows the robot's short, fun reaction lines (from the reaction engine).
 * These are scripted companion feedback tied to REAL app events — they are
 * deliberately short, plain text and never presented as AI answers.
 */

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RobotMessage } from "../../lib/robot/types";

export interface RobotBubbleProps {
  message: RobotMessage | null;
  /** How long the line stays up (engine decides per mood). */
  ms?: number;
  onDismiss: () => void;
}

const DEFAULT_MS = 5200;

export function RobotBubble({ message, ms, onDismiss }: RobotBubbleProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    timer.current = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, Math.max(1600, ms ?? DEFAULT_MS));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, ms, onDismiss]);

  if (!message) return null;

  return (
    <div
      dir="rtl"
      className={`pointer-events-auto absolute top-2 left-0 z-10 w-64 -translate-x-3 transition-all duration-300 sm:w-80 ${
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
        <p className="pl-4 text-right text-[12.5px] leading-6 font-bold text-ink-700 dark:text-ink-200">
          {message.text}
        </p>
      </div>
    </div>
  );
}
