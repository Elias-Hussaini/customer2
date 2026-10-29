/**
 * Robot Companion — capability registry.
 *
 * A TYPED registry of what the robot can do on behalf of the user. The AI can
 * only PROPOSE registry entries; execution always goes through the
 * ActionExecutor (validation → permission → confirmation → trusted run →
 * verification). Registering a new capability requires NO change to the robot
 * components — register() is the only touchpoint.
 */

import type {
  ActionProposal,
  CapabilityCheck,
  CapabilityParam,
  RobotCapability,
} from "./types";
import { toLatinDigits } from "../../utils/jalali";

export class CapabilityRegistry {
  private byId = new Map<string, RobotCapability>();

  register(cap: RobotCapability): () => void {
    if (this.byId.has(cap.id)) {
      throw new Error(`capability already registered: ${cap.id}`);
    }
    this.byId.set(cap.id, cap);
    return () => this.byId.delete(cap.id);
  }

  get(id: string): RobotCapability | undefined {
    return this.byId.get(id);
  }

  list(): RobotCapability[] {
    return [...this.byId.values()];
  }

  /** Runtime validation of a proposal against the declared schema. */
  check(proposal: ActionProposal): CapabilityCheck {
    const cap = this.byId.get(proposal.capabilityId);
    if (!cap) {
      return { ok: false, errors: [`قابلیت ناشناخته: ${proposal.capabilityId}`] };
    }
    // Permission: the AI may only propose ai/both capabilities.
    if (proposal.source === "ai" && cap.permission === "user") {
      return {
        ok: false,
        errors: [`قابلیت «${cap.id}» فقط با دستور مستقیم کاربر اجرا می‌شود.`],
        capability: cap,
      };
    }
    if (proposal.source === "user" && cap.permission === "ai") {
      return {
        ok: false,
        errors: [`قابلیت «${cap.id}» فقط از طریق هوش مصنوعی پیشنهاد می‌شود.`],
        capability: cap,
      };
    }
    const errors: string[] = [];
    const args = proposal.args ?? {};
    for (const p of cap.params) {
      const v = args[p.name];
      if (v == null || (typeof v === "string" && v.trim() === "")) {
        if (p.required) errors.push(`پارامتر «${p.name}» الزامی است.`);
        continue;
      }
      if (!typeMatches(v, p)) {
        errors.push(
          `پارامتر «${p.name}» باید ${typeName(p.type)} باشد.`,
        );
        continue;
      }
      if (p.enum && !p.enum.includes(String(v))) {
        errors.push(`پارامتر «${p.name}» باید یکی از ${p.enum.join(" / ")} باشد.`);
      }
    }
    return { ok: errors.length === 0, errors, capability: cap };
  }
}

function typeMatches(v: unknown, p: CapabilityParam): boolean {
  switch (p.type) {
    case "string":
      return typeof v === "string" || typeof v === "number";
    case "number":
      if (typeof v === "number") return Number.isFinite(v);
      if (typeof v !== "string") return false;
      // Persian/Arabic digits + thousand separators coerce fine: "۱٬۲۳۴" → 1234
      return Number.isFinite(Number(toLatinDigits(v).replace(/[,_٬\s]/g, "")));
    case "boolean":
      return typeof v === "boolean" || typeof v === "string";
  }
}

function typeName(t: CapabilityParam["type"]): string {
  return t === "string" ? "متن" : t === "number" ? "عدد" : "بله/خیر";
}

/** App-wide singleton registry. */
export const robotCapabilities = new CapabilityRegistry();
