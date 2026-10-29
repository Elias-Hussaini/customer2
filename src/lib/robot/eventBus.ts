/**
 * Robot Companion — centralized application event bus.
 *
 * Pages/components emit domain events here; the robot (and anything else)
 * subscribes. The bus deduplicates identical bursts and applies per-type
 * cooldowns so a rapid-fire of toasts cannot spam the robot's state machine.
 */

import type { RobotAppEvent, RobotAppEventType } from "./types";

type Listener = (event: RobotAppEvent) => void;

/**
 * Default cooldown per event type (ms) — identical events inside the window
 * are dropped. `ai:*` lifecycle events carry no cooldown because their order
 * matters (request_start → tool_running → response_final).
 */
const DEFAULT_COOLDOWN_MS: Partial<Record<RobotAppEventType, number>> = {
  "nav:change": 400,
  "app:save_success": 1500,
  "app:save_error": 1500,
  "app:upload_start": 800,
  "app:upload_done": 800,
  "app:upload_error": 800,
  "app:search": 1200,
  "app:report_generated": 2000,
  "app:export_start": 800,
  "app:export_done": 800,
  "app:export_error": 800,
  "app:import_start": 800,
  "app:import_done": 800,
  "app:import_error": 800,
  // Fun extras — rare enough that they never feel spammy.
  "app:theme_toggle": 4000,
  "app:layout_change": 600,
  // AI lifecycle: NEVER dedup — a request/tool/response sequence must keep
  // its exact order (the robot's typing indicator depends on it).
  "ai:request_start": 0,
  "ai:tool_running": 0,
  "ai:response_final": 0,
  "ai:aborted": 0,
  "ai:error": 0,
  "user:active": 0,
  "user:idle": 0,
};

export class RobotEventBus {
  private listeners = new Set<Listener>();
  /** type|signature → last emit ts (cooldown bookkeeping). */
  private lastEmit = new Map<string, number>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Visible for tests. */
  listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Emit an event. Identical events (same type AND same coarse signature)
   * fired within the cooldown window are dropped — e.g. three success toasts
   * in 300ms count as one reaction.
   */
  emit(event: RobotAppEvent): boolean {
    const cooldown = DEFAULT_COOLDOWN_MS[event.type] ?? 600;
    const signature = `${event.type}|${coarseSignature(event)}`;
    const t = this.now();
    if (cooldown > 0) {
      const last = this.lastEmit.get(signature);
      if (last != null && t - last < cooldown) return false;
      this.lastEmit.set(signature, t);
    }
    for (const l of [...this.listeners]) l(event);
    return true;
  }

  /** Drop all cooldown memory (tests). */
  reset(): void {
    this.lastEmit.clear();
    this.listeners.clear();
  }
}

/** Coarse dedup signature — only the identity of the subject, not the whole payload. */
function coarseSignature(event: RobotAppEvent): string {
  switch (event.type) {
    case "nav:change":
      return event.to;
    case "ai:tool_running":
      return event.name ?? "";
    default:
      return "";
  }
}

/** App-wide singleton — imported by emitters (toasts, navigation, chat). */
export const robotBus = new RobotEventBus();
