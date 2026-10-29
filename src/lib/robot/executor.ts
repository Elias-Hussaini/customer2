/**
 * Robot Companion — action execution pipeline.
 *
 * The AI (or a UI affordance) can only PROPOSE an action. The proposal then
 * flows through this trusted pipeline:
 *
 *   validate (registry schema + permission)
 *     → confirm (user dialog when the capability demands it)
 *       → execute (the capability's own trusted handler — never eval, never
 *         arbitrary JS/SQL from the model)
 *         → verify (the handler's output is sanity-checked)
 *           → report (structured outcome back to the AI / UI)
 *
 * A rejected or failed action NEVER throws raw — it returns a typed outcome
 * so the conversation can continue gracefully.
 */

import type { CapabilityRegistry } from "./capabilities";
import type { ActionOutcome, ActionProposal, RobotCapability } from "./types";

export interface ConfirmRequest {
  capability: RobotCapability;
  args: Record<string, unknown>;
}

/** UI hook: shows the confirmation dialog; resolves true when approved. */
export type ConfirmFn = (req: ConfirmRequest) => Promise<boolean>;

/** Optional sanity check on the handler output (e.g. created row has id). */
export type VerifyFn = (data: unknown) => boolean;

export interface ExecutorOptions {
  registry: CapabilityRegistry;
  confirm?: ConfirmFn;
  verify?: VerifyFn;
}

export class ActionExecutor {
  constructor(private opts: ExecutorOptions) {}

  setConfirm(confirm: ConfirmFn | undefined): void {
    this.opts.confirm = confirm;
  }

  async execute(proposal: ActionProposal): Promise<ActionOutcome> {
    const check = this.opts.registry.check(proposal);
    if (!check.ok || !check.capability) {
      return {
        kind: "rejected",
        reason: check.capability ? "validation" : "unknown_capability",
        errors: check.errors,
      };
    }
    const cap = check.capability;

    if (cap.requiresConfirmation) {
      const approved = this.opts.confirm
        ? await this.opts.confirm({ capability: cap, args: proposal.args })
        : false; // no UI hook → fail CLOSED, never silently execute
      if (!approved) {
        return { kind: "rejected", reason: "user_declined", errors: ["کاربر اجازه اجرا نداد."] };
      }
    }

    try {
      const data = await cap.run(proposal.args);
      const verified = this.opts.verify ? this.opts.verify(data) : true;
      return { kind: "ok", data, verified };
    } catch (e) {
      return {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
