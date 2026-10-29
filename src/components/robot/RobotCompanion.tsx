/**
 * Robot Companion — the persistent top-right companion (ربات همراه).
 *
 * Wires together:
 *  - settings (on/off, persisted per device)
 *  - the app event bus (navigation, saves, uploads, AI lifecycle…)
 *  - the state controller (priority state machine)
 *  - the 3D canvas (GLB when shipped, procedural fallback otherwise)
 *  - the transient bubble (real AI replies / typing only)
 *  - the expandable chat panel (full agent runtime)
 *
 * Performance: the canvas pauses (frameloop never) when the tab is hidden
 * and the whole tree unmounts when disabled in settings.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { RobotBubble } from "./RobotBubble";
import { RobotChatPanel } from "./RobotChatPanel";

/**
 * The 3D layer (three + R3F, ~1 MB) is code-split: it loads after first
 * paint and never blocks the app. Falls back to nothing while loading.
 */
const RobotCanvas = lazy(() =>
  import("./RobotCanvas").then((m) => ({ default: m.RobotCanvas })),
);
import { robotBus } from "../../lib/robot/eventBus";
import { stateForEvent, RobotStateController } from "../../lib/robot/stateController";
import {
  getRobotSettings,
  subscribeRobotSettings,
} from "../../lib/robot/settings";
import type { RobotMessage, RobotState } from "../../lib/robot/types";
import { uid } from "../../utils/id";

/** Screen-reader friendly Persian label per state. */
const STATE_ANNOUNCEMENT: Record<RobotState, string> = {
  idle: "ربات آماده است",
  attentive: "ربات در حال توجه به شماست",
  thinking: "ربات در حال فکر کردن است",
  working: "ربات در حال کار است",
  success: "کار با موفقیت انجام شد",
  error: "خطایی رخ داد",
  waiting: "ربات منتظر پاسخ شماست",
  speaking: "ربات در حال نمایش پاسخ است",
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [bubble, setBubble] = useState<RobotMessage | null>(null);
  const [typing, setTyping] = useState(false);
  const [statusLine, setStatusLine] = useState<string | undefined>(undefined);
  const [tabVisible, setTabVisible] = useState(true);

  /* --------------------------- state subscriptions -------------------------- */

  useEffect(() => controller.subscribe((s) => setState(s)), [controller]);

  // App events → robot reactions.
  useEffect(() => {
    return robotBus.subscribe((event) => {
      stateForEvent(event, controller);
      // Typing indicator follows the AI lifecycle while the panel is closed.
      if (event.type === "ai:request_start") {
        setTyping(true);
        setStatusLine(undefined);
      } else if (event.type === "ai:tool_running") {
        setStatusLine(event.name ? `در حال اجرای ${event.name}…` : "در حال اجرای ابزار…");
      } else if (
        event.type === "ai:response_final" ||
        event.type === "ai:error" ||
        event.type === "ai:aborted"
      ) {
        setTyping(false);
        setStatusLine(undefined);
      }
    });
  }, [controller]);

  // Navigation → attentive + close the panel on route change.
  useEffect(() => {
    robotBus.emit({ type: "nav:change", to: location.pathname });
    setPanelOpen(false);
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

  // Panel open → attentive.
  useEffect(() => {
    if (panelOpen) controller.enter("attentive");
  }, [panelOpen, controller]);

  /* ------------------------------ bubble feed ------------------------------- */

  /** Real AI text → bubble preview (only when the panel is closed). */
  const onAssistantText = useCallback(
    (text: string, worker?: string) => {
      if (!settings.bubble || panelOpen) return;
      setBubble({ id: uid(), role: "assistant", text, ts: Date.now(), worker });
    },
    [settings.bubble, panelOpen],
  );

  /* ------------------------------- rendering -------------------------------- */

  if (!settings.enabled) return null;

  const paused = !tabVisible;

  return (
    <div className="no-print fixed top-3 right-3 z-50 select-none sm:top-4 sm:right-4">
      <div className="relative">
        {/* transient bubble */}
        {settings.bubble && !panelOpen ? (
          <RobotBubble
            message={bubble}
            typing={typing}
            status={statusLine}
            onDismiss={() => setBubble(null)}
          />
        ) : null}

        {/* the robot badge itself */}
        <button
          className={`robot-in group relative block h-[5.25rem] w-[4.5rem] cursor-pointer rounded-3xl transition-transform duration-200 hover:scale-[1.06] active:scale-95 ${
            state === "sleeping" ? "robot-sleep" : ""
          }`}
          style={{
            maskImage: "radial-gradient(ellipse 78% 88% at 50% 52%, #000 72%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 78% 88% at 50% 52%, #000 72%, transparent 100%)",
          }}
          onClick={() => setPanelOpen((o) => !o)}
          title={panelOpen ? "بستن گفتگو" : "گفتگو با ربات همراه"}
          aria-label={STATE_ANNOUNCEMENT[state]}
          aria-pressed={panelOpen}
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
              boxShadow: "0 0 22px 4px rgb(99 91 255 / 0.35)",
            }}
          />
        </button>
      </div>

      {/* expandable conversation panel */}
      {panelOpen ? (
        <RobotChatPanel onClose={() => setPanelOpen(false)} onAssistantText={onAssistantText} />
      ) : null}
    </div>
  );
}
