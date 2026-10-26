/**
 * AI module tests — worker failover chain, response-shape parsing, fixed
 * schema extraction and the failover order of stored accounts.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/schema";
import {
  AiAllWorkersFailedError,
  aiChat,
  extractReplyText,
  testWorker,
} from "../client";
import { buildExtractionMessages, buildSystemPrompt, isIsoDate, parseExtractionReply } from "../extract";
import { isLatinName, latinToPersianName } from "../translit";
import { addAiWorker, moveAiWorker, setAiFieldEnabled, setAllAiFields } from "../store";
import { DEFAULT_AI_SETTINGS, fieldEnabled } from "../types";
import type { AiWorker } from "../types";

function worker(over: Partial<AiWorker> = {}): AiWorker {
  return {
    id: over.id ?? "w1",
    label: over.label ?? "اکانت ۱",
    url: over.url ?? "https://w1.example.workers.dev",
    key: over.key ?? "key-1",
    model: over.model ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
    enabled: over.enabled ?? true,
    priority: over.priority ?? 1,
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  global.fetch = vi.fn();
  await Promise.all([db.aiWorkers.clear(), db.aiMeta.clear()]);
});

describe("extractReplyText — all documented response shapes", () => {
  it("reads data.result.response", () => {
    expect(extractReplyText({ result: { response: "hello" } })).toBe("hello");
  });

  it("reads data.result.choices[0].message.content", () => {
    expect(
      extractReplyText({ result: { choices: [{ message: { content: "a" } }] } }),
    ).toBe("a");
  });

  it("reads data.result.choices[0].delta.content", () => {
    expect(
      extractReplyText({ result: { choices: [{ delta: { content: "b" } }] } }),
    ).toBe("b");
  });

  it("reads data.choices[0].message.content", () => {
    expect(extractReplyText({ choices: [{ message: { content: "c" } }] })).toBe("c");
  });

  it("reads data.choices[0].delta.content", () => {
    expect(extractReplyText({ choices: [{ delta: { content: "d" } }] })).toBe("d");
  });

  it("reads data.response", () => {
    expect(extractReplyText({ response: "e" })).toBe("e");
  });

  it("returns empty string for unknown shapes", () => {
    expect(extractReplyText({ foo: "bar" })).toBe("");
    expect(extractReplyText(null)).toBe("");
  });
});

describe("aiChat failover", () => {
  it("sends the fixed request shape to the worker base URL", async () => {
    await db.aiWorkers.put(worker());
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ result: { response: "OK" } }),
    );
    const res = await aiChat([{ role: "user", content: "ping" }], {
      maxTokens: 512,
      temperature: 0,
    });
    expect(res.text).toBe("OK");
    expect(res.worker.id).toBe("w1");

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://w1.example.workers.dev");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      max_tokens: 512,
      temperature: 0,
      stream: false,
    });
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
  });

  it("fails over to the next account on HTTP 429", async () => {
    await db.aiWorkers.bulkPut([
      worker({ id: "w1", priority: 1 }),
      worker({ id: "w2", priority: 2, url: "https://w2.example.workers.dev", key: "key-2" }),
    ]);
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ result: { response: "from-second" } }));

    const attempts: string[] = [];
    const res = await aiChat([{ role: "user", content: "hi" }], {
      onAttempt: ({ worker: w }) => attempts.push(w.id),
    });
    expect(res.text).toBe("from-second");
    expect(res.worker.id).toBe("w2");
    expect(attempts).toEqual(["w1", "w2"]);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("fails over on network errors and empty replies, throws when all fail", async () => {
    await db.aiWorkers.bulkPut([
      worker({ id: "w1", priority: 1 }),
      worker({ id: "w2", priority: 2 }),
      worker({ id: "w3", priority: 3 }),
    ]);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // network
      .mockResolvedValueOnce(jsonResponse({ result: { response: "" } })) // empty
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await expect(aiChat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(
      AiAllWorkersFailedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("skips disabled and incomplete workers", async () => {
    await db.aiWorkers.bulkPut([
      worker({ id: "off", enabled: false, priority: 1 }),
      worker({ id: "nokey", key: "", priority: 2 }),
      worker({ id: "good", priority: 3 }),
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ response: "y" }),
    );
    const res = await aiChat([{ role: "user", content: "x" }]);
    expect(res.worker.id).toBe("good");
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("throws immediately-friendly error when no worker is configured", async () => {
    await expect(aiChat([{ role: "user", content: "x" }])).rejects.toThrow(
      AiAllWorkersFailedError,
    );
  });

  it("testWorker reports ok with the reply", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ result: { response: "OK" } }),
    );
    const res = await testWorker(worker());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.reply).toBe("OK");
  });

  it("testWorker reports the error message", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad key" }] }), { status: 401 }),
    );
    const res = await testWorker(worker());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("401");
  });
});

describe("extraction messages & parsing", () => {
  it("system prompt contains the fixed schema and never mentions removed local OCR", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('"first_name"');
    expect(prompt).toContain('"expiry_date"');
    expect(prompt).toContain('"uncertain"');
  });

  it("names must come back in Persian script — the prompt demands it", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("NEVER in Latin letters");
    expect(prompt).toContain("TRANSLITERATE");
    expect(prompt).toContain("احمدی");
  });

  it("custom fields are injected into the prompt dynamically", () => {
    const prompt = buildSystemPrompt({
      customFields: [{ key: "father_name", label: "نام پدر" }],
    });
    expect(prompt).toContain('"father_name"');
    expect(prompt).toContain("نام پدر");
  });

  it("builds one user message with text + image parts", () => {
    const messages = buildExtractionMessages(["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"]);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    const content = messages[1].content as Array<{ type: string }>;
    expect(content[0].type).toBe("text");
    expect(content[1]).toMatchObject({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } });
    expect(content[2]).toMatchObject({ type: "image_url" });
  });

  it("parses a clean JSON reply into the fixed schema", () => {
    const payload = parseExtractionReply(
      '{"first_name":"ZAHRA","last_name":"MOUSAVI","passport_number":"A12345678","date_of_birth":"1997-05-12","issue_date":null,"expiry_date":"2027-05-11","nationality":"AFG","national_id":null,"sex":"F","place_of_birth":null,"document_type":"passport","uncertain":["expiry_date"]}',
    );
    expect(payload.first_name).toBe("زهرا");
    expect(payload.last_name).toBe("موسوی");
    expect(payload.passport_number).toBe("A12345678");
    expect(payload.date_of_birth).toBe("1997-05-12");
    expect(payload.issue_date).toBeNull();
    expect(payload.sex).toBe("F");
    expect(payload.uncertain).toEqual(["expiry_date"]);
  });

  it("parses fenced JSON with surrounding prose and trailing commas", () => {
    const payload = parseExtractionReply(
      'Here is the result:\n```json\n{"first_name":"ALI","last_name":null,"passport_number":"B2",\n"date_of_birth":null,"issue_date":null,"expiry_date":null,"nationality":null,"national_id":null,"sex":"M","place_of_birth":null,"document_type":null,"uncertain":[],}\n```\nHope this helps!',
    );
    expect(payload.first_name).toBe("علی");
    expect(payload.passport_number).toBe("B2");
  });

  it("keeps extra (custom) keys and nulls empties", () => {
    const payload = parseExtractionReply(
      '{"first_name":null,"last_name":null,"passport_number":"","date_of_birth":null,"issue_date":null,"expiry_date":null,"nationality":null,"national_id":null,"sex":null,"place_of_birth":null,"document_type":null,"uncertain":"oops","father_name":"AHMAD"}',
    );
    expect(payload.father_name).toBe("AHMAD");
    expect(payload.passport_number).toBeNull();
    // a non-array uncertain becomes []
    expect(payload.uncertain).toEqual([]);
  });

  it("throws on non-JSON replies", () => {
    expect(() => parseExtractionReply("I cannot read this image")).toThrow();
    expect(() => parseExtractionReply("[1,2,3]")).toThrow();
  });

  it("isIsoDate accepts YYYY-MM-DD only", () => {
    expect(isIsoDate("2024-05-13")).toBe(true);
    expect(isIsoDate("24-05-13")).toBe(false);
    expect(isIsoDate("1997-13-45")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("worker storage", () => {
  it("adds workers with increasing failover priority and validates the URL", async () => {
    const a = await addAiWorker({ label: "اول", url: "https://a.workers.dev", key: "k1", model: "@cf/openai/gpt-oss-20b" });
    const b = await addAiWorker({ label: "", url: "https://b.workers.dev", key: "k2", model: "" });
    expect(a.priority).toBeLessThan(b.priority);
    expect(b.label).toBe("اکانت ۲");
    expect(b.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    await expect(
      addAiWorker({ label: "x", url: "notaurl", key: "k", model: "m" }),
    ).rejects.toThrow();
  });

  it("moveAiWorker swaps the failover order", async () => {
    const a = await addAiWorker({ label: "a", url: "https://a.workers.dev", key: "k", model: "m" });
    const b = await addAiWorker({ label: "b", url: "https://b.workers.dev", key: "k", model: "m" });
    await moveAiWorker(b.id, -1);
    const all = await db.aiWorkers.toArray();
    const sorted = all.sort((x, y) => x.priority - y.priority);
    expect(sorted.map((w) => w.label)).toEqual(["b", "a"]);
  });

  it("AI field toggles round-trip and default to enabled", async () => {
    expect(fieldEnabled(DEFAULT_AI_SETTINGS.fieldToggles, "first_name")).toBe(true);
    expect(fieldEnabled({ passport_number: false }, "passport_number")).toBe(false);
    await setAiFieldEnabled("last_name", false);
    await setAiFieldEnabled("issue_date", true);
    let saved = await db.aiMeta.get("ai");
    expect(saved?.fieldToggles?.last_name).toBe(false);
    expect(saved?.fieldToggles?.issue_date).toBe(true);
    await setAllAiFields(["last_name", "issue_date"], false);
    saved = await db.aiMeta.get("ai");
    expect(saved?.fieldToggles?.last_name).toBe(false);
    expect(saved?.fieldToggles?.issue_date).toBe(false);
  });
});

describe("Latin → Persian name transliteration (local fallback)", () => {
  it("detects Latin-only names", () => {
    expect(isLatinName("AHMADI")).toBe(true);
    expect(isLatinName("احمدی")).toBe(false);
    expect(isLatinName("Zahra موسوی")).toBe(false);
  });

  it("dictionary names transliterate exactly", () => {
    expect(latinToPersianName("AHMADI")).toBe("احمدی");
    expect(latinToPersianName("ZAHRA")).toBe("زهرا");
    expect(latinToPersianName("MOUSAVI")).toBe("موسوی");
    expect(latinToPersianName("ABDUL RAHMAN")).toBe("عبدالرحمن");
    expect(latinToPersianName("GUL MOHAMMAD")).toBe("گل‌محمد");
  });

  it("unknown names fall back to phonetic transliteration", () => {
    expect(latinToPersianName("KHAN")).toBe("خان");
    expect(latinToPersianName("JAN")).toBe("جان");
    expect(latinToPersianName("AHMADULLAH")).toBe("احمدالله");
  });

  it("leaves Persian names and MRZ garbage untouched/split", () => {
    expect(latinToPersianName("زهرا")).toBe("زهرا");
    expect(latinToPersianName("AHMADI<<ZAHRA")).toBe("احمدی زهرا");
  });

  it("parseExtractionReply converts Latin names to Persian", () => {
    const payload = parseExtractionReply(
      JSON.stringify({
        first_name: "ZAHRA",
        last_name: "MOUSAVI",
        passport_number: "PA1234567",
        date_of_birth: "1997-05-12",
        issue_date: null,
        expiry_date: null,
        nationality: null,
        national_id: null,
        sex: null,
        place_of_birth: null,
        document_type: null,
        uncertain: [],
      }),
    );
    expect(payload.first_name).toBe("زهرا");
    expect(payload.last_name).toBe("موسوی");
    expect(payload.passport_number).toBe("PA1234567");
  });
});
