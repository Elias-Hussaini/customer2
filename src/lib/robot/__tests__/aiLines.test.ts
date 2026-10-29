/**
 * AI line generator tests — the contract between the robot and the MAIN AI:
 *  1. every app event is described to the model in Persian
 *  2. model replies are sanitized down to ONE clean short sentence
 *  3. the prompt carries the DICTIONARY (character sheet) + anti-repeat list
 *  4. generation fails soft: unusable/repeated replies and transport errors
 *     resolve null so the caller can fall back to the local dictionary
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRobotLineMemoryForTests,
  buildRobotLineMessages,
  describeRobotEvent,
  generateRobotLine,
  recentRobotLines,
  sanitizeRobotLine,
  type RobotLineChat,
} from "../aiLines";
import type { RobotAppEvent } from "../types";

const ev = (e: RobotAppEvent) => e;

function fakeChat(text: string, label = "اکانت تست"): RobotLineChat {
  return vi.fn(async () => ({ text, worker: { label, url: "https://x" } }));
}

const failingChat: RobotLineChat = vi.fn(async () => {
  throw new Error("boom");
});

beforeEach(() => {
  __resetRobotLineMemoryForTests();
});

describe("describeRobotEvent — every event becomes Persian context", () => {
  it("tap asks for a fun line", () => {
    const d = describeRobotEvent({ type: "user:tap" });
    expect(d).toContain("کلیک");
  });

  it("nav uses the page title", () => {
    const d = describeRobotEvent(ev({ type: "nav:change", to: "/customers", title: "مشتریان" }));
    expect(d).toContain("مشتریان");
  });

  it("search carries the query", () => {
    const d = describeRobotEvent(ev({ type: "app:search", query: "علی رضایی" }));
    expect(d).toContain("علی رضایی");
  });

  it("theme toggle says which mode", () => {
    expect(describeRobotEvent(ev({ type: "app:theme_toggle", dark: true }))).toContain("تاریک");
    expect(describeRobotEvent(ev({ type: "app:theme_toggle", dark: false }))).toContain("روشن");
  });

  it("save success and error are distinguishable", () => {
    expect(describeRobotEvent(ev({ type: "app:save_success" }))).toContain("موفقیت");
    expect(describeRobotEvent(ev({ type: "app:save_error" }))).toContain("خطا");
  });
});

describe("sanitizeRobotLine — one clean sentence only", () => {
  it("keeps a normal line as-is", () => {
    expect(sanitizeRobotLine("ایول! ثبت شد.")).toBe("ایول! ثبت شد.");
  });

  it("strips wrapping quotes, fences and labels", () => {
    expect(sanitizeRobotLine("«سلام رفیق!»")).toBe("سلام رفیق!");
    expect(sanitizeRobotLine("```json\nسلام\n```")).toBe("سلام");
    expect(sanitizeRobotLine("ربات: سلام!")).toBe("سلام!");
  });

  it("collapses newlines into one paragraph", () => {
    expect(sanitizeRobotLine("سلام\nبه\nروزی!")).toBe("سلام به روزی!");
  });

  it("removes emoji", () => {
    expect(sanitizeRobotLine("سلام ✨🤖")).toBe("سلام");
  });

  it("rejects too short / too long / empty", () => {
    expect(sanitizeRobotLine("")).toBeNull();
    expect(sanitizeRobotLine("خ")).toBeNull();
    expect(sanitizeRobotLine("ا".repeat(91))).toBeNull();
  });
});

describe("buildRobotLineMessages — dictionary-aware prompt", () => {
  it("system prompt carries the dictionary as the character sheet", () => {
    const [sys] = buildRobotLineMessages({ source: { type: "user:tap" } });
    expect(sys.role).toBe("system");
    const text = sys.content as string;
    expect(text).toContain("دیکشنری");
    // real dictionary lines must be present (the AI has to learn the tone)
    expect(text).toContain("ایول! ثبت شد.");
    expect(text).toContain("وای! غافلگیری کردی!");
    expect(text).toContain("تکرار نکن");
  });

  it("user message describes the event + page", () => {
    const messages = buildRobotLineMessages({
      source: ev({ type: "app:search", query: "پاسپورت" }),
      page: "جستجو",
    });
    const user = messages[1];
    expect(user.role).toBe("user");
    expect(user.content as string).toContain("پاسپورت");
    expect(user.content as string).toContain("جستجو");
  });

  it("recent lines are listed as forbidden repeats", () => {
    const messages = buildRobotLineMessages({
      source: { type: "user:tap" },
      recent: ["جملهٔ قدیمی"],
    });
    expect(messages[0].content as string).toContain("جملهٔ قدیمی");
  });
});

describe("generateRobotLine — transport + guards", () => {
  it("returns the sanitized line + worker label", async () => {
    const chat = fakeChat("«این یک جملهٔ تازه است!»");
    const res = await generateRobotLine({ type: "user:tap" }, { chat });
    expect(res?.text).toBe("این یک جملهٔ تازه است!");
    expect(res?.worker).toBe("اکانت تست");
    expect(recentRobotLines()).toContain("این یک جملهٔ تازه است!");
  });

  it("null when the reply is unusable (too long / empty)", async () => {
    expect(await generateRobotLine({ type: "user:tap" }, { chat: fakeChat("") })).toBeNull();
    expect(await generateRobotLine({ type: "user:tap" }, { chat: fakeChat("ا".repeat(200)) })).toBeNull();
  });

  it("null when the model repeats a line it just said", async () => {
    const chat = fakeChat("جملهٔ تکراری");
    await generateRobotLine({ type: "user:tap" }, { chat });
    const again = await generateRobotLine({ type: "user:tap" }, { chat });
    expect(again).toBeNull();
  });

  it("null when the transport fails (no workers / network)", async () => {
    expect(await generateRobotLine({ type: "user:tap" }, { chat: failingChat })).toBeNull();
  });

  it("null when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await generateRobotLine({ type: "user:tap" }, { chat: fakeChat("سلام"), signal: controller.signal }),
    ).toBeNull();
  });
});
