/**
 * Robot Companion — the persistent in-page companion (ربات همراه).
 *
 * A pure visual/entertainment layer — NO chat anymore:
 *  - it watches what you do (navigation, saves, searches, personalization…)
 *    through the app event bus and reacts in real time with animation + a
 *    short fun line (the reaction engine guarantees no repetition)
 *  - its eyes follow your cursor anywhere on the page (RobotModel)
 *  - a tap makes it jump and answer — that is the whole interaction model
 *
 * Performance: the canvas pauses when the tab is hidden and the whole tree
 * unmounts when the robot is turned off in settings.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { RobotBubble } from "./RobotBubble";

/**
 * The 3D layer (three + R3F, ~1 MB) is code-split: it loads after first
 * paint and never blocks the app. Falls back to nothing while loading.
 */
const RobotCanvas = lazy(() =>
  import("./RobotCanvas").then((m) => ({ default: m.RobotCanvas })),
);
import { robotBus } from "../../lib/robot/eventBus";
import { stateForEvent, RobotStateController } from "../../lib/robot/stateController";
import { robotReactions } from "../../lib/robot/reactions";
import {
  getRobotSettings,
  subscribeRobotSettings,
} from "../../lib/robot/settings";
import { SECTION_TITLES } from "../layout/TopBar";
import type { RobotMessage, RobotState } from "../../lib/robot/types";
import { uid } from "../../utils/id";

/** Screen-reader friendly Persian label per state. */
const STATE_ANNOUNCEMENT: Record<RobotState, string> = {
  idle: "ربات آماده است",
  attentive: "ربات در حال توجه به شماست",
  thinking: "ربات در حال فکر کردن است",
  working: "ربات در حال کار است",
  success: "ربات خوشحال است",
  error: "ربات ناراحت است",
  waiting: "ربات منتظر است",
  speaking: "ربات دارد واکنش نشان می‌دهد",
  sleeping: "ربات خوابیده است",
  hidden: "ربات پنهان است",
};

export function RobotCompanion() {
  const settings = useSyncExternalStore(subscribeRobotSettings, getRobotSettings, getRobotSettings);
  const location = useLocation();

  const controllerRef = useRef<RobotStateController | null>(null);
  if (controllerRef.current == null) controllerRef.current = new RobotStateController();
  const controller = controllerRef.current;

  const [state, setState] = useState<RobotState>("idle");
  const [bubble, setBubble] = useState<RobotMessage | null>(null);
  const [bubbleMs, setBubbleMs] = useState<number | undefined>(undefined);
  const [tabVisible, setTabVisible] = useState(true);

  /* --------------------------- state subscriptions -------------------------- */

  useEffect(() => controller.subscribe((s) => setState(s)), [controller]);

  // App events → animation state + (sometimes) a fun line.
  useEffect(() => {
    return robotBus.subscribe((event) => {
      stateForEvent(event, controller);
      const r = robotReactions.react(event);
      if (r.line && settings.bubble) {
        setBubble({ id: uid(), role: "system", text: r.line, ts: Date.now() });
        setBubbleMs(r.ms);
      }
    });
  }, [controller, settings.bubble]);

  // Navigation → attentive + page-aware line.
  useEffect(() => {
    const title = SECTION_TITLES.find((s) => s.match(location.pathname))?.title;
    robotBus.emit({ type: "nav:change", to: location.pathname, title });
  }, [location.pathname]);

  // User activity → wake from sleep + idle timer.
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        robotBus.emit({ type: "user:idle" });
      }, Math.max(1, settings.sleepAfterMin) * 60_000);
    };
    const onActive = () => {
      robotBus.emit({ type: "user:active" });
      armIdle();
    };
    const events: (keyof DocumentEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => document.addEventListener(e, onActive, { passive: true }));
    armIdle();
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((e) => document.removeEventListener(e, onActive));
    };
  }, [settings.sleepAfterMin]);

  // Tab visibility → pause rendering when hidden.
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Teardown: no stale writes after unmount.
  useEffect(() => () => controller.cancelAll(), [controller]);

  /* ------------------------------- interaction ------------------------------ */

  /** A tap on the robot → happy jump + always an answer. */
  const onTap = useCallback(() => {
    controller.enter("success");
    const r = robotReactions.tap();
    if (r.line && settings.bubble) {
      setBubble({ id: uid(), role: "system", text: r.line, ts: Date.now() });
      setBubbleMs(r.ms);
    }
  }, [controller, settings.bubble]);

  /* ------------------------------- rendering -------------------------------- */

  if (!settings.enabled) return null;

  const paused = !tabVisible;

  return (
    <div className="no-print fixed top-20 right-6 z-50 select-none sm:top-24 sm:right-12">
      <div className="relative">
        {/* transient reaction bubble */}
        {settings.bubble ? (
          <RobotBubble
            message={bubble}
            ms={bubbleMs}
            onDismiss={() => setBubble(null)}
          />
        ) : null}

        {/* the robot itself — bigger, lower, a touch more to the left */}
        <button
          className={`robot-in group relative block h-[6.75rem] w-[5.75rem] cursor-pointer rounded-3xl transition-transform duration-200 hover:scale-[1.05] active:scale-95 sm:h-[7.75rem] sm:w-[6.75rem] ${
            state === "sleeping" ? "robot-sleep" : ""
          }`}
          style={{
            maskImage: "radial-gradient(ellipse 78% 88% at 50% 52%, #000 72%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 78% 88% at 50% 52%, #000 72%, transparent 100%)",
          }}
          onClick={onTap}
          title="ربات همراه — برای واکنش، کلیک کنید"
          aria-label={STATE_ANNOUNCEMENT[state]}
        >
          <Suspense fallback={null}>
            <RobotCanvas state={state} paused={paused} />
          </Suspense>
          {/* soft glow ring on activity */}
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-500 ${
              state === "working" || state === "thinking"
                ? "opacity-100"
                : "opacity-0"
            }`}
            style={{
              boxShadow: "0 0 26px 5px rgb(99 91 255 / 0.35)",
            }}
          />
        </button>
      </div>
    </div>
  );
}
