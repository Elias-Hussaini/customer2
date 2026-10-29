/**
 * Robot Companion — the local state controller.
 *
 * A tiny, dependency-free state machine with:
 *  - priorities (a `working` round is never interrupted by a nav event)
 *  - transient states that fall back to a stable base (idle/sleeping)
 *  - epoch-based race protection: an AI request owns an epoch; state writes
 *    from a STALE epoch (a newer request started, or the old one was
 *    cancelled/unmounted) are ignored — an old response can never overwrite
 *    the reaction to a newer one.
 *  - zero React imports: fully unit-testable.
 */

import {
  STATE_DURATION_MS,
  STATE_PRIORITY,
  type RobotState,
} from "./types";

export interface StateChange {
  from: RobotState;
  to: RobotState;
}

type StateListener = (state: RobotState, change: StateChange) => void;

/** Is this a state the machine sits in until something else happens? */
function isBase(s: RobotState): boolean {
  return s === "idle" || s === "attentive" || s === "sleeping" || s === "hidden";
}

export class RobotStateController {
  private state: RobotState = "idle";
  private base: RobotState = "idle";
  private transient = false;
  /** Epoch the active transient was entered under (zombie detection). */
  private transientEpoch: number | null = null;
  private revertTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<StateListener>();
  /** Monotonic epoch — bumped by beginSession()/cancelAll(). */
  private epoch = 0;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get current(): RobotState {
    return this.state;
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: RobotState): void {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    for (const l of [...this.listeners]) l(next, { from, to: next });
  }

  private clearRevert(): void {
    if (this.revertTimer != null) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }
  }

  private scheduleRevert(delay: number, epoch: number): void {
    this.clearRevert();
    this.revertTimer = setTimeout(() => {
      // A stale scheduled revert must not run after a newer session began.
      if (epoch !== this.epoch) return;
      this.transient = false;
      this.setState(this.base);
    }, delay);
  }

  /**
   * Enter a state. `epoch` (optional) tags the write with an AI session;
   * stale epochs are ignored. Transient states auto-revert to the base.
   *
   * Priority rules:
   *  - A LIVE transient (same epoch) only yields to equal-or-higher priority
   *    — a `working` round is never interrupted by `attentive` or `success`.
   *  - A ZOMBIE transient (entered under an older, now-dead session) always
   *    yields — its owner is gone, whatever comes next takes over.
   *  - Base states simply become the new resting point when nothing is live.
   */
  enter(next: RobotState, opts: { epoch?: number } = {}): boolean {
    if (opts.epoch != null && opts.epoch !== this.epoch) return false;
    if (next === "hidden") {
      this.clearRevert();
      this.transient = false;
      this.transientEpoch = null;
      this.base = "hidden";
      this.setState("hidden");
      return true;
    }

    if (this.transient) {
      const zombie = this.transientEpoch != null && this.transientEpoch !== this.epoch;
      if (!zombie && STATE_PRIORITY[next] < STATE_PRIORITY[this.state]) {
        return false; // a live higher-priority transient keeps the stage
      }
    }

    if (isBase(next)) {
      this.clearRevert();
      this.transient = false;
      this.transientEpoch = null;
      this.base = next;
      this.setState(next);
      return true;
    }

    this.clearRevert();
    this.transient = true;
    this.transientEpoch = this.epoch;
    this.setState(next);
    const dur = STATE_DURATION_MS[next];
    if (dur > 0) this.scheduleRevert(dur, this.epoch);
    return true;
  }

  /**
   * Start an AI session: bumps the epoch (all previous session writes become
   * stale) and returns the new epoch to tag writes with.
   */
  beginSession(): number {
    this.epoch++;
    return this.epoch;
  }

  /** Invalidate every pending write + scheduled revert (cancel/unmount). */
  cancelAll(): void {
    this.epoch++;
    this.clearRevert();
    this.transient = false;
    this.transientEpoch = null;
    this.setState(this.base);
  }

  /** Leave one transient state early (e.g. thinking → idle when done). */
  endTransient(epoch?: number): void {
    if (epoch != null && epoch !== this.epoch) return;
    if (!this.transient) return;
    this.clearRevert();
    this.transient = false;
    this.transientEpoch = null;
    this.setState(this.base);
  }

  /** Hidden/unmount cleanup for tests and teardown. */
  dispose(): void {
    this.clearRevert();
    this.listeners.clear();
  }
}

/* ------------------------- event → state mapping -------------------------- */

import type { RobotAppEvent } from "./types";

/**
 * How application events drive the robot. Long-running intents (thinking,
 * working, waiting) are entered via the AI adapter instead; this mapping
 * covers spontaneous app events only.
 */
export function stateForEvent(
  event: RobotAppEvent,
  controller: RobotStateController,
): void {
  switch (event.type) {
    case "nav:change":
      controller.enter("attentive");
      break;
    case "app:save_success":
    case "app:upload_done":
    case "app:export_done":
    case "app:import_done":
    case "app:report_generated":
      controller.enter("success");
      break;
    case "app:save_error":
    case "app:upload_error":
    case "app:export_error":
    case "app:import_error":
      controller.enter("error");
      break;
    case "app:upload_start":
    case "app:export_start":
    case "app:import_start":
      controller.enter("working");
      break;
    case "app:search":
      controller.enter("attentive");
      break;
    case "app:theme_toggle":
      // A playful "hm!" — the bubble line carries the fun.
      controller.enter("attentive");
      break;
    case "app:layout_change":
      // The user personalized their launcher — little celebration jump.
      controller.enter("success");
      break;
    case "ai:tool_running":
      controller.enter("working");
      break;
    case "ai:request_start":
      controller.enter("thinking");
      break;
    case "ai:response_final":
      // Session end: clear thinking/working FIRST, then celebrate.
      controller.endTransient();
      controller.enter("speaking");
      break;
    case "ai:error":
      controller.endTransient();
      controller.enter("error");
      break;
    case "ai:aborted":
      controller.endTransient();
      break;
    case "user:active":
      if (controller.current === "sleeping") controller.enter("idle");
      break;
    case "user:idle":
      controller.enter("sleeping");
      break;
  }
}
