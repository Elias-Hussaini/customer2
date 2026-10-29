/**
 * Robot Companion — transient reaction bubble.
 *
 * Shows the robot's short, fun reaction lines (from the reaction engine).
 * These are scripted companion feedback tied to REAL app events — they are
 * deliberately short, plain text and never presented as AI answers.
 *
 * Placement is MEASURED, not guessed: the bubble anchors to the robot
 * button, sits to its left (or below it on very narrow screens) and is
 * clamped inside the viewport. The previous version was absolutely
 * positioned inside the robot's fixed corner box — with the robot hugging
 * the right edge of the screen, half the bubble sat off-screen, and since
 * Persian text is right-aligned the ENTIRE text lived on the invisible
 * half. Hence: "the bubble is cut in half and I never see any text".
 */

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RobotMessage } from "../../lib/robot/types";

export interface RobotBubbleProps {
  message: RobotMessage | null;
  /** The robot button the bubble hugs (measured via getBoundingClientRect). */
  anchorRef: { current: HTMLElement | null };
  /** How long the line stays up (engine decides per mood). */
  ms?: number;
  onDismiss: () => void;
}

const DEFAULT_MS = 5200;
/** Gap between the bubble and the robot (px). */
const GAP = 12;
/** Minimum distance between the bubble and the viewport edges (px). */
const MARGIN = 10;
/** Below this much free space at the robot's left, the bubble goes UNDER it. */
const MIN_SIDE_W = 216;
const MAX_W = 320;

interface Placement {
  side: "left" | "below";
  left: number;
  top: number;
  width: number;
}

/**
 * Compute a fully-visible placement. `el` must already have its final width
 * applied so offsetHeight is the real height.
 */
function placeBubble(el: HTMLElement, anchor: DOMRect, width: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = el.offsetHeight || 64;
  const clampTop = (t: number) =>
    Math.min(Math.max(MARGIN, t), Math.max(MARGIN, vh - height - MARGIN));

  if (anchor.left - GAP - MARGIN >= MIN_SIDE_W) {
    // Side placement: bubble's right edge at the robot's left edge,
    // vertically centered on it — the tail points at the robot.
    return {
      side: "left",
      width,
      left: anchor.left - GAP - width,
      top: clampTop(anchor.top + anchor.height / 2 - height / 2),
    };
  }
  // Very narrow screens: under the robot, right-aligned with it.
  return {
    side: "below",
    width,
    left: Math.min(
      Math.max(MARGIN, anchor.right - width),
      Math.max(MARGIN, vw - width - MARGIN),
    ),
    top: clampTop(anchor.bottom + GAP),
  };
}

export function RobotBubble({ message, anchorRef, ms, onDismiss }: RobotBubbleProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Placement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide after the mood-specific duration.
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

  // Measure the anchor and place the bubble fully on-screen — in a layout
  // effect, i.e. before the browser paints (no off-screen flash). Re-placed
  // on resize while a message is showing.
  useLayoutEffect(() => {
    if (!message) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = boxRef.current;
      const anchor = anchorRef.current;
      if (!el || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // anchor hidden
      const sideSpace = rect.left - GAP - MARGIN;
      const width =
        sideSpace >= MIN_SIDE_W
          ? Math.min(MAX_W, sideSpace)
          : Math.min(MAX_W, window.innerWidth - 2 * MARGIN);
      // Fix the width BEFORE measuring so the height is the real one.
      el.style.width = `${width}px`;
      setPos(placeBubble(el, rect, width));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [message, anchorRef]);

  if (!message) return null;

  return (
    <div
      dir="rtl"
      ref={boxRef}
      role="status"
      className={`pointer-events-auto fixed z-[60] transition-all duration-300 ${
        visible && pos ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }`}
      style={{
        left: pos ? `${pos.left}px` : "-9999px",
        top: pos ? `${pos.top}px` : "-9999px",
        width: pos ? `${pos.width}px` : undefined,
      }}
    >
      <div className="glass relative rounded-3xl p-3.5 pr-4 shadow-xl shadow-ink-950/10">
        {/* tail pointing at the robot */}
        <span
          aria-hidden
          className={`glass absolute h-3 w-3 rotate-45 rounded-[3px] ${
            pos?.side === "below"
              ? "-top-1.5 right-7"
              : "-right-1.5 top-1/2 -translate-y-1/2"
          }`}
        />
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
        <p className="pl-4 text-right text-[13px] leading-6 font-bold text-ink-700 dark:text-ink-200">
          {message.text}
        </p>
      </div>
    </div>
  );
}
