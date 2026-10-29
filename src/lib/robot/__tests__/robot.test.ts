/**
 * Robot Companion — unit tests for the framework layer:
 * event bus (dedup + cooldown), state controller (priority, transient
 * fallback, epoch race protection), capability registry (validation,
 * permissions) and the action executor (confirmation gate, verification).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { RobotEventBus } from "../eventBus";
import { RobotStateController, stateForEvent } from "../stateController";
import { CapabilityRegistry } from "../capabilities";
import { ActionExecutor } from "../executor";
import type { ActionProposal, RobotCapability } from "../types";

/* --------------------------------- bus ------------------------------------ */

describe("RobotEventBus", () => {
  it("delivers events to subscribers and unsubscribes cleanly", () => {
    const bus = new RobotEventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.emit({ type: "app:save_success" });
    bus.emit({ type: "ai:error", message: "x" });
    off();
    bus.emit({ type: "app:save_success" });
    expect(seen).toEqual(["app:save_success", "ai:error"]);
    expect(bus.listenerCount()).toBe(0);
  });

  it("drops identical events inside the cooldown window", () => {
    let t = 1000;
    const bus = new RobotEventBus(() => t);
    let hits = 0;
    bus.subscribe(() => hits++);
    expect(bus.emit({ type: "app:save_success" })).toBe(true);
    expect(bus.emit({ type: "app:save_success" })).toBe(false); // inside cooldown
    t += 2000;
    expect(bus.emit({ type: "app:save_success" })).toBe(true); // window passed
    expect(hits).toBe(2);
  });

  it("distinguishes subjects with different signatures (nav)", () => {
    let t = 0;
    const bus = new RobotEventBus(() => t);
    let hits = 0;
    bus.subscribe(() => hits++);
    bus.emit({ type: "nav:change", to: "/a" });
    bus.emit({ type: "nav:change", to: "/b" }); // different route → NOT deduped
    bus.emit({ type: "nav:change", to: "/b" }); // same route → deduped
    expect(hits).toBe(2);
  });

  it("never dedups AI lifecycle events (order matters)", () => {
    const bus = new RobotEventBus();
    let hits = 0;
    bus.subscribe(() => hits++);
    bus.emit({ type: "ai:request_start" });
    bus.emit({ type: "ai:tool_running", name: "db_stats" });
    bus.emit({ type: "ai:tool_running", name: "db_stats" });
    bus.emit({ type: "ai:response_final" });
    expect(hits).toBe(4);
  });
});

/* ----------------------------- state machine ------------------------------ */

describe("RobotStateController", () => {
  it("reverts transient states back to the base after their duration", () => {
    vi.useFakeTimers();
    const c = new RobotStateController();
    c.enter("success");
    expect(c.current).toBe("success");
    vi.advanceTimersByTime(2300);
    expect(c.current).toBe("idle");
    vi.useRealTimers();
  });

  it("keeps long-running states until ended explicitly", () => {
    vi.useFakeTimers();
    const c = new RobotStateController();
    c.enter("thinking");
    vi.advanceTimersByTime(60_000);
    expect(c.current).toBe("thinking"); // no auto-revert
    c.endTransient();
    expect(c.current).toBe("idle");
    vi.useRealTimers();
  });

  it("a working round is never interrupted by a lower-priority event", () => {
    const c = new RobotStateController();
    c.enter("working");
    stateForEvent({ type: "nav:change", to: "/x" }, c);
    expect(c.current).toBe("working"); // nav (attentive) loses
    stateForEvent({ type: "app:save_success" }, c);
    expect(c.current).toBe("working"); // success loses too
    c.endTransient();
    expect(c.current).toBe("idle");
  });

  it("stale epochs cannot overwrite a newer session (race protection)", () => {
    const c = new RobotStateController();
    const oldEpoch = c.beginSession();
    c.enter("thinking", { epoch: oldEpoch });
    expect(c.current).toBe("thinking");
    const newEpoch = c.beginSession(); // user asked something newer
    c.enter("success", { epoch: oldEpoch }); // old response arrives late
    expect(c.current).toBe("thinking"); // ignored!
    c.enter("error", { epoch: newEpoch });
    expect(c.current).toBe("error"); // new session wins
  });

  it("cancelAll invalidates pending writes and scheduled reverts", () => {
    vi.useFakeTimers();
    const c = new RobotStateController();
    const e1 = c.beginSession();
    c.enter("success", { epoch: e1 });
    c.cancelAll();
    expect(c.current).toBe("idle");
    vi.advanceTimersByTime(5000);
    expect(c.current).toBe("idle");
    // Old epoch is dead: even explicit writes are refused.
    expect(c.enter("speaking", { epoch: e1 })).toBe(false);
    vi.useRealTimers();
  });

  it("sleeps on user:idle and wakes on user:active", () => {
    const c = new RobotStateController();
    stateForEvent({ type: "user:idle" }, c);
    expect(c.current).toBe("sleeping");
    stateForEvent({ type: "user:active" }, c);
    expect(c.current).toBe("idle");
  });

  it("hidden is a base state and overrides everything", () => {
    const c = new RobotStateController();
    c.enter("working");
    c.enter("hidden");
    expect(c.current).toBe("hidden");
  });
});

/* ------------------------------- registry --------------------------------- */

function cap(partial: Partial<RobotCapability> & Pick<RobotCapability, "id">): RobotCapability {
  return {
    description: "توضیح",
    params: [],
    permission: "both",
    requiresConfirmation: false,
    destructive: false,
    run: async () => ({ ok: true }),
    ...partial,
  };
}

describe("CapabilityRegistry", () => {
  it("validates required params and types", () => {
    const r = new CapabilityRegistry();
    r.register(
      cap({
        id: "create_thing",
        params: [
          { name: "name", type: "string", description: "", required: true },
          { name: "count", type: "number", description: "", required: false },
        ],
      }),
    );
    const missing = r.check({ capabilityId: "create_thing", args: {}, source: "ai" });
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((e) => e.includes("name"))).toBe(true);

    const badType = r.check({
      capabilityId: "create_thing",
      args: { name: "x", count: "not-a-number" },
      source: "ai",
    });
    expect(badType.ok).toBe(false);

    const good = r.check({
      capabilityId: "create_thing",
      args: { name: "x", count: "۱۲۳" }, // Persian digits coerce fine
      source: "ai",
    });
    expect(good.ok).toBe(true);
  });

  it("enforces permissions (ai-only and user-only capabilities)", () => {
    const r = new CapabilityRegistry();
    r.register(cap({ id: "user_only", permission: "user" }));
    r.register(cap({ id: "ai_only", permission: "ai" }));
    expect(r.check({ capabilityId: "user_only", args: {}, source: "ai" }).ok).toBe(false);
    expect(r.check({ capabilityId: "ai_only", args: {}, source: "user" }).ok).toBe(false);
    expect(r.check({ capabilityId: "user_only", args: {}, source: "user" }).ok).toBe(true);
  });

  it("rejects unknown capabilities", () => {
    const r = new CapabilityRegistry();
    const res = r.check({ capabilityId: "nope", args: {}, source: "ai" });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("ناشناخته");
  });

  it("prevents duplicate registration", () => {
    const r = new CapabilityRegistry();
    r.register(cap({ id: "dup" }));
    expect(() => r.register(cap({ id: "dup" }))).toThrow();
  });

  it("enum params only accept listed values", () => {
    const r = new CapabilityRegistry();
    r.register(
      cap({
        id: "pick",
        params: [{ name: "color", type: "string", description: "", required: true, enum: ["red", "green"] }],
      }),
    );
    expect(r.check({ capabilityId: "pick", args: { color: "blue" }, source: "ai" }).ok).toBe(false);
    expect(r.check({ capabilityId: "pick", args: { color: "red" }, source: "ai" }).ok).toBe(true);
  });
});

/* ------------------------------- executor --------------------------------- */

describe("ActionExecutor", () => {
  const proposal = (id: string, source: ActionProposal["source"] = "ai"): ActionProposal => ({
    capabilityId: id,
    args: {},
    source,
  });

  it("runs unconfirmed capabilities directly and verifies output", async () => {
    const r = new CapabilityRegistry();
    const run = vi.fn(async () => ({ id: "new-1" }));
    r.register(cap({ id: "safe", run }));
    const ex = new ActionExecutor({ registry: r, verify: (d) => !!(d as { id?: string }).id });
    const out = await ex.execute(proposal("safe"));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.verified).toBe(true);
      expect(out.data).toEqual({ id: "new-1" });
    }
    expect(run).toHaveBeenCalledOnce();
  });

  it("requires the user's approval for confirm-gated capabilities", async () => {
    const r = new CapabilityRegistry();
    const run = vi.fn(async () => ({ ok: true }));
    r.register(cap({ id: "risky", requiresConfirmation: true, run }));
    const confirm = vi.fn(async () => true);
    const ex = new ActionExecutor({ registry: r, confirm });
    const out = await ex.execute(proposal("risky"));
    expect(out.kind).toBe("ok");
    expect(confirm).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("declined confirmation blocks execution (fail closed)", async () => {
    const r = new CapabilityRegistry();
    const run = vi.fn(async () => ({}));
    r.register(cap({ id: "risky", requiresConfirmation: true, run }));
    const ex = new ActionExecutor({ registry: r, confirm: async () => false });
    const out = await ex.execute(proposal("risky"));
    expect(out.kind).toBe("rejected");
    if (out.kind === "rejected") expect(out.reason).toBe("user_declined");
    expect(run).not.toHaveBeenCalled();
  });

  it("fails CLOSED when no confirm hook is wired for a gated capability", async () => {
    const r = new CapabilityRegistry();
    const run = vi.fn(async () => ({}));
    r.register(cap({ id: "risky", requiresConfirmation: true, run }));
    const ex = new ActionExecutor({ registry: r }); // no confirm
    const out = await ex.execute(proposal("risky"));
    expect(out.kind).toBe("rejected");
    expect(run).not.toHaveBeenCalled();
  });

  it("surfaces handler errors as typed outcomes (no throw)", async () => {
    const r = new CapabilityRegistry();
    r.register(cap({ id: "boom", run: async () => { throw new Error("خطای شبیه‌سازی‌شده"); } }));
    const ex = new ActionExecutor({ registry: r });
    const out = await ex.execute(proposal("boom"));
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.message).toContain("خطای");
  });

  it("unknown capability → rejected with reason", async () => {
    const r = new CapabilityRegistry();
    const ex = new ActionExecutor({ registry: r });
    const out = await ex.execute(proposal("ghost"));
    expect(out.kind).toBe("rejected");
    if (out.kind === "rejected") expect(out.reason).toBe("unknown_capability");
  });
});

/* -------------------------- event → state mapping -------------------------- */

describe("stateForEvent", () => {
  const cases: Array<[string, string]> = [
    ["app:save_success", "success"],
    ["app:save_error", "error"],
    ["app:upload_start", "working"],
    ["ai:response_final", "speaking"],
    ["ai:error", "error"],
    ["app:search", "attentive"],
  ];
  for (const [type, expected] of cases) {
    it(`${type} → ${expected}`, () => {
      const c = new RobotStateController();
      stateForEvent({ type } as never, c);
      expect(c.current).toBe(expected);
    });
  }

  it("full AI session lifecycle: request → tools → final answer", () => {
    const c = new RobotStateController();
    stateForEvent({ type: "ai:request_start" } as never, c);
    expect(c.current).toBe("thinking");
    stateForEvent({ type: "ai:tool_running", name: "db_stats" } as never, c);
    expect(c.current).toBe("working");
    // nav noise during the round must not interrupt it
    stateForEvent({ type: "nav:change", to: "/x" } as never, c);
    expect(c.current).toBe("working");
    // the final answer ends the session and speaks
    stateForEvent({ type: "ai:response_final", text: "x" } as never, c);
    expect(c.current).toBe("speaking");
  });

  it("abort ends the round without leaving the robot stuck in working", () => {
    const c = new RobotStateController();
    stateForEvent({ type: "ai:request_start" } as never, c);
    stateForEvent({ type: "ai:tool_running", name: "x" } as never, c);
    expect(c.current).toBe("working");
    stateForEvent({ type: "ai:aborted" } as never, c);
    expect(c.current).toBe("idle");
  });

  it("an AI error while working is surfaced (session end wins)", () => {
    const c = new RobotStateController();
    stateForEvent({ type: "ai:tool_running", name: "x" } as never, c);
    stateForEvent({ type: "ai:error", message: "boom" } as never, c);
    expect(c.current).toBe("error");
  });
});
