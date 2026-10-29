/**
 * Robot Companion (ربات همراه) — shared types.
 *
 * The robot is ONLY the visual/interaction layer; every intelligent answer
 * comes from the user's own AI workers through the existing agent runtime
 * (`lib/agent`). Nothing here fabricates AI replies.
 */

/* --------------------------------- states --------------------------------- */

/**
 * The robot's expressive state machine.
 *
 *  idle       — floating calmly, nothing happening
 *  attentive  — user is interacting (pointer near, panel open, typing)
 *  thinking   — AI request in flight, before any tool runs
 *  working    — a tool/action is executing (agent tool round)
 *  success    — something just succeeded (save, AI answer arrived)
 *  error      — something failed (AI error, failed save)
 *  waiting    — waiting for the user (confirmation dialog, missing info)
 *  speaking   — a reply is being presented (bubble visible)
 *  sleeping   — no user activity for a while (energy saving)
 *  hidden     — robot disabled in settings; canvas not rendered
 */
export type RobotState =
  | "idle"
  | "attentive"
  | "thinking"
  | "working"
  | "success"
  | "error"
  | "waiting"
  | "speaking"
  | "sleeping"
  | "hidden";

/** How long each transient state holds before falling back to the base. */
export const STATE_DURATION_MS: Record<RobotState, number> = {
  idle: 0,
  attentive: 0,
  thinking: 0, // ends when the AI request ends
  working: 0, // ends when the action ends
  success: 2200,
  error: 3000,
  waiting: 0, // ends when the user answers
  speaking: 4200,
  sleeping: 0,
  hidden: 0,
};

/** Higher priority wins while a transient state is active. */
export const STATE_PRIORITY: Record<RobotState, number> = {
  working: 60,
  thinking: 55,
  speaking: 50,
  success: 45,
  error: 45,
  waiting: 40,
  attentive: 30,
  idle: 20,
  sleeping: 10,
  hidden: 0,
};

/* --------------------------------- events --------------------------------- */

/** Application events the robot reacts to (centralized bus). */
export type RobotAppEvent =
  | { type: "nav:change"; to: string; title?: string }
  | { type: "app:save_success"; message?: string }
  | { type: "app:save_error"; message?: string }
  | { type: "app:upload_start"; name?: string }
  | { type: "app:upload_done"; name?: string }
  | { type: "app:upload_error"; name?: string }
  | { type: "app:search"; query?: string }
  | { type: "app:report_generated"; title?: string }
  | { type: "app:export_start"; what?: string }
  | { type: "app:export_done"; what?: string }
  | { type: "app:export_error"; what?: string }
  | { type: "app:import_start"; what?: string }
  | { type: "app:import_done"; what?: string }
  | { type: "app:import_error"; what?: string }
  /** User flipped the light/dark theme. */
  | { type: "app:theme_toggle"; dark: boolean }
  /** A launcher button was dragged (personalization). */
  | { type: "app:layout_change"; what: "pin_out" | "pin_in" | "move"; label?: string }
  | { type: "ai:request_start"; prompt?: string }
  | { type: "ai:tool_running"; name?: string }
  | { type: "ai:response_final"; text?: string }
  | { type: "ai:aborted" }
  | { type: "ai:error"; message?: string }
  | { type: "user:active" }
  | { type: "user:idle" };

export type RobotAppEventType = RobotAppEvent["type"];

/* ------------------------------ capabilities ------------------------------ */

/** JSON-schema-ish input descriptor for a capability parameter. */
export interface CapabilityParam {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}

/** Who is allowed to trigger a capability. */
export type CapabilityPermission =
  | "user" // only the human (button/menu)
  | "ai" // the AI model may propose it
  | "both";

export interface RobotCapability {
  /** Stable id, e.g. "navigate" / "create_representative". */
  id: string;
  /** Persian description shown in confirmations and to the AI. */
  description: string;
  params: CapabilityParam[];
  permission: CapabilityPermission;
  /** Needs an explicit user confirmation before running. */
  requiresConfirmation: boolean;
  /** Mutates or deletes user data. */
  destructive: boolean;
  /** Trusted execution — the ONLY place the action really happens. */
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface CapabilityCheck {
  ok: boolean;
  errors: string[];
  capability?: RobotCapability;
}

/* ------------------------------ action proposal ---------------------------- */

/** An action the AI (or UI) PROPOSED — never executed directly. */
export interface ActionProposal {
  capabilityId: string;
  args: Record<string, unknown>;
  /** Who asked for it. */
  source: "ai" | "user";
}

export type ActionOutcome =
  | { kind: "ok"; data: unknown; verified: boolean }
  | { kind: "rejected"; reason: "user_declined" | "validation" | "permission" | "unknown_capability"; errors: string[] }
  | { kind: "error"; message: string };

/* --------------------------------- settings -------------------------------- */

export interface RobotSettings {
  /** Robot rendered at all (settings toggle). */
  enabled: boolean;
  /** Transient message bubble allowed to pop. */
  bubble: boolean;
  /** Minutes of inactivity before sleeping. */
  sleepAfterMin: number;
}

export const DEFAULT_ROBOT_SETTINGS: RobotSettings = {
  enabled: true,
  bubble: true,
  sleepAfterMin: 3,
};

/* --------------------------------- messages -------------------------------- */

/** A bubble/chat message. `ai` content always originates from a real model. */
export interface RobotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  /** Which worker produced it (assistant messages only). */
  worker?: string;
}
