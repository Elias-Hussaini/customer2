/**
 * Robot Companion — the persistent in-page companion (ربات همراه).
 *
 * A visual + personality layer:
 *  - it watches what you do (navigation, saves, searches, personalization…)
 *    through the app event bus and reacts in real time with animation + a
 *    short fun line
 *  - the lines come from the MAIN AI (the user's AI workers, the same ones
 *    that power the agent chat) — the model gets the robot's pre-defined
 *    DICTIONARY as its character sheet and must invent fresh lines in that
 *    voice. Whenever the AI is unavailable (offline, no workers, timeout)
 *    the local dictionary lines are read instead — the robot never goes
 *    silent (aiLines.ts).
 *  - its whole HEAD follows your cursor anywhere on the page (RobotModel)
 *  - a tap makes it think for a moment, then jump and answer
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
import { generateRobotLine, type RobotLineSource } from "../../lib/robot/aiLines";
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
  /** The robot button — the bubble anchors to it by measurement. */
  const btnRef = useRef<HTMLButtonElement>(null);

  /* ------------------------- AI line plumbing ------------------------------- */

  /** Latest speak() wins: a stale AI reply may never overwrite a newer bubble. */
  const seqRef = useRef(0);
  /** Abort the in-flight AI request when a newer one starts / on unmount. */
  const abortRef = useRef<AbortController | null>(null);
  /** Passive events share one rate limit so navigation bursts don't burn quota. */
  const lastAiAtRef = useRef(0);

  /** How long a passive reaction waits for the AI before reading the local line. */
  const AI_PASSIVE_BUDGET_MS = 3200;
  /** A tap holds a "thinking" pose, so it may wait a little longer. */
  const AI_TAP_BUDGET_MS = 6000;
  /** Minimum gap between two AI line requests for PASSIVE events. */
  const AI_MIN_INTERVAL_MS = 10_000;

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  /**
   * Say something about `source`: ask the MAIN AI (when enabled) and fall
   * back to the local dictionary line. The local gates stay in charge — the
   * robot remains lively but never chatty, and quota is respected.
   */
  const speak = useCallback(
    (source: RobotLineSource) => {
      if (!settings.bubble) return;
      const local = source.type === "user:tap" ? robotReactions.tap() : robotReactions.react(source);
      const localLine = local.line;
      if (!localLine) return; // the gate said: animate only, stay silent

      const isTap = source.type === "user:tap";
      const seq = ++seqRef.current;
      const myAbort = new AbortController();
      abortRef.current?.abort();
      abortRef.current = myAbort;

      const show = (text: string, role: "assistant" | "system", worker?: string) => {
        if (seq !== seqRef.current) return; // stale — a newer line owns the bubble
        if (isTap) controller.enter("success"); // the promised happy jump
        // AI lines can be a touch longer — give the reader a bit more time.
        const ms = role === "assistant" ? Math.max(local.ms ?? 5200, 6400) : local.ms;
        setBubble({ id: uid(), role, text, ts: Date.now(), ...(worker ? { worker } : {}) });
        setBubbleMs(ms);
      };

      const aiAllowed =
        settings.aiLines && (isTap || Date.now() - lastAiAtRef.current >= AI_MIN_INTERVAL_MS);
      if (!aiAllowed) {
        show(localLine, "system");
        return;
      }
      lastAiAtRef.current = Date.now();

      let settled = false;
      const budget = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), isTap ? AI_TAP_BUDGET_MS : AI_PASSIVE_BUDGET_MS);
      });
      void (async () => {
        try {
          const ai = await Promise.race([
            generateRobotLine(source, {
              signal: myAbort.signal,
              page: document.title,
            }),
            budget,
          ]);
          if (settled || seq !== seqRef.current || myAbort.signal.aborted) return;
          settled = true;
          if (ai) show(ai.text, "assistant", ai.worker);
          else {
            myAbort.abort(); // budget over — kill the background request
            show(localLine, "system");
          }
        } catch {
          if (settled || seq !== seqRef.current) return;
          settled = true;
          show(localLine, "system");
        }
      })();
    },
    [controller, settings.aiLines, settings.bubble],
  );

  /* --------------------------- state subscriptions -------------------------- */

  useEffect(() => controller.subscribe((s) => setState(s)), [controller]);

  // App events → animation state + (sometimes) a fun line from the MAIN AI
  // (dictionary fallback when the AI is unavailable).
  useEffect(() => {
    return robotBus.subscribe((event) => {
      stateForEvent(event, controller);
      speak(event);
    });
  }, [controller, speak]);

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

  /** A tap on the robot → think for a beat (the AI is being asked), then a
   *  happy jump + always an answer — from the main AI when possible. */
  const onTap = useCallback(() => {
    if (settings.bubble) controller.enter("thinking");
    else controller.enter("success");
    speak({ type: "user:tap" });
  }, [controller, settings.bubble, speak]);

  /* ------------------------------- rendering -------------------------------- */

  if (!settings.enabled) return null;

  const paused = !tabVisible;

  return (
    <>
      {/* transient reaction bubble — a fixed, viewport-clamped SIBLING
          anchored to the robot by measurement. It used to render inside the
          robot's corner box, which pushed half of it (the RTL text half!)
          off-screen — invisible text, bubble "cut in half". */}
      {settings.bubble ? (
        <RobotBubble
          message={bubble}
          ms={bubbleMs}
          anchorRef={btnRef}
          onDismiss={() => setBubble(null)}
        />
      ) : null}

      <div className="no-print fixed top-20 right-6 z-50 select-none sm:top-24 sm:right-12">
        {/* the robot itself — bigger, lower, a touch more to the left */}
        <button
          ref={btnRef}
          className={`robot-in group relative block h-[6.75rem] w-[5.75rem] cursor-pointer rounded-3xl transition-transform duration-200 hover:scale-[1.05] active:scale-95 sm:h-[7.75rem] sm:w-[6.75rem] ${
            state === "sleeping" ? "robot-sleep" : ""
          }`}
          style={{
            // Soft fade at the very EDGE of the canvas only. The previous
            // tight ellipse (78%/88%, fade from 72%) reached into the model:
            // a turned head or swinging eye landed in the fade zone and
            // "disappeared". This one clears the whole silhouette.
            maskImage:
              "radial-gradient(ellipse 95% 102% at 50% 52%, #000 82%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 95% 102% at 50% 52%, #000 82%, transparent 100%)",
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
    </>
  );
}
