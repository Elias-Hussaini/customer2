/**
 * Central AI Agent — protocol parsing + tolerant model-reply parsing +
 * a live registry integration test (real fake-IndexedDB, seeded data).
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

const memStore = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
}

import { db } from "../../../db/schema";
import { parseProtocol, normalizeToolName, looksLikeProtocolJson } from "../agent";
import { parseExtractionReply } from "../../ai/extract";
import { parseDocSortReply, type DocSlotOption } from "../../ai/docsort";
import { buildToolRegistry } from "../tools";
import type { Customer, Employer, ListFolder, Representative, VisaRequest } from "../../../types";

/* ------------------------------ protocol tests ----------------------------- */

describe("parseProtocol", () => {
  it("recognizes a bare tool_calls object", () => {
    const p = parseProtocol(`{"tool_calls":[{"id":"c1","name":"list_customers","args":{"limit":5}}]}`);
    expect(p.kind).toBe("tool_calls");
    if (p.kind === "tool_calls") {
      expect(p.calls).toHaveLength(1);
      expect(p.calls[0].name).toBe("list_customers");
      expect(p.calls[0].args).toEqual({ limit: 5 });
    }
  });

  it("recognizes a fenced tool_calls reply", () => {
    const p = parseProtocol("```json\n{\"tool_calls\":[{\"name\":\"db_stats\",\"args\":{}}]}\n```");
    expect(p.kind).toBe("tool_calls");
    if (p.kind === "tool_calls") expect(p.calls[0].name).toBe("db_stats");
  });

  it("accepts `arguments` as an alias for `args` and generates ids", () => {
    const p = parseProtocol(`{"tool_calls":[{"name":"x"},{"name":"y","arguments":{"a":1}}]}`);
    expect(p.kind).toBe("tool_calls");
    if (p.kind === "tool_calls") {
      expect(p.calls.map((c) => c.name)).toEqual(["x", "y"]);
      expect(p.calls[1].args).toEqual({ a: 1 });
      expect(p.calls.every((c) => c.id)).toBe(true);
    }
  });

  it("treats plain Persian prose as a final answer", () => {
    expect(parseProtocol("سلام! امروز چه کاری برایت انجام دهم؟").kind).toBe("final");
  });

  it("treats JSON WITHOUT tool_calls as final (user asked for JSON)", () => {
    expect(parseProtocol(`{"first_name":"احمد","last_name":"رحیمی"}`).kind).toBe("final");
  });

  it("treats an empty tool_calls array as final", () => {
    expect(parseProtocol(`{"tool_calls":[]}`).kind).toBe("final");
  });

  /* ---- the EXACT production failure reported by the user (regression) ---- */

  it("executes a `toolcalls` (no underscore) call buried in prose — the reported bug", () => {
    const reply = [
      "برای اطلاع از تعداد مشتریان، می‌توانم از ابزار count_customers استفاده کنم.",
      "",
      "ابزار count_customers را اجرا می‌کنم:",
      "",
      `{"toolcalls":[{"id":"c1","name":"countcustomers","args":{}}]}`,
      "",
      "منتظر نتیجه می‌مانم…",
    ].join("\n");
    const known = new Set(["count_customers", "list_customers", "db_stats"].map(normalizeToolName));
    const p = parseProtocol(reply, known);
    expect(p.kind).toBe("tool_calls");
    if (p.kind === "tool_calls") {
      expect(p.calls).toHaveLength(1);
      expect(p.calls[0].name).toBe("countcustomers"); // lenient name — registry resolves it
    }
  });

  it("executes a strong-key call even without a known-tools set", () => {
    const p = parseProtocol(`{"tool_calls":[{"name":"whatever_tool","args":{}}]}`);
    expect(p.kind).toBe("tool_calls");
  });

  it("unwraps a JSON-wrapped final answer {\"final\": \"...\"}", () => {
    const p = parseProtocol(`{"final":"شما ۳۴۶ مشتری دارید.","ask":false}`);
    expect(p.kind).toBe("final");
    if (p.kind === "final") expect(p.text).toBe("شما ۳۴۶ مشتری دارید.");
  });

  it("weak alias keys (`calls`) require a real tool match", () => {
    const known = new Set(["count_customers"].map(normalizeToolName));
    expect(parseProtocol(`{"calls":[{"name":"count_customers","args":{}}]}`, known).kind).toBe("tool_calls");
    expect(parseProtocol(`{"calls":[{"name":"pseudo_tool","args":{}}]}`, known).kind).toBe("final");
  });

  it("a bare array of calls with args counts; a JSON data array stays final", () => {
    const known = new Set(["count_customers", "db_stats"].map(normalizeToolName));
    expect(parseProtocol(`[{"name":"db_stats","args":{}},{"name":"count_customers","args":{}}]`, known).kind).toBe("tool_calls");
    // user asked for JSON data — must NOT be executed:
    expect(parseProtocol(`[{"name":"احمد رحیمی","passport":"FA123"},{"name":"زهرا کریمی","passport":"ZK777"}]`, known).kind).toBe("final");
    // tools listing (no args) must stay final too:
    expect(parseProtocol(`[{"name":"db_stats","description":"آمار"},{"name":"count_customers","description":"تعداد"}]`, known).kind).toBe("final");
  });

  it("finds the tool call in a fenced block inside prose", () => {
    const reply = "لحظه‌ای…\n```json\n{\"tool_calls\":[{\"name\":\"db_stats\",\"args\":{}}]}\n```\nبگذار ببینم.";
    expect(parseProtocol(reply).kind).toBe("tool_calls");
  });
});

/* --------------------------- tolerant reply parsing ------------------------- */

describe("tolerant model replies", () => {
  it("repairs a truncated extraction reply (token limit cut)", () => {
    const truncated = `{"first_name":"احمد","last_name":"رحیمی","passport_number":"FA123456","date_of_birth":"1990-0`;
    const payload = parseExtractionReply(truncated);
    expect(payload.first_name).toBe("احمد");
    expect(payload.last_name).toBe("رحیمی");
    expect(payload.passport_number).toBe("FA123456");
  });

  it("salvages key-value pairs from a broken prose reply", () => {
    const broken = 'بر اساس مدرک: "first_name": "زهرا", "last_name": "کریمی", "passport_number": "ZK777';
    const payload = parseExtractionReply(broken);
    expect(payload.first_name).toBe("زهرا");
    expect(payload.last_name).toBe("کریمی");
  });

  const slots: DocSlotOption[] = [
    { id: "dt-pass", label: "عکس پاسپورت" },
    { id: "dt-back", label: "پشت تذکره" },
  ];

  it("maps a Persian LABEL answer onto the real slot (not «سایر»)", () => {
    const r = parseDocSortReply(`[{"index":1,"slot":"پشت تذکره"},{"index":2,"slot":"عکس پاسپورت"}]`, slots, 2);
    expect(r[0].target.kind).toBe("slot");
    if (r[0].target.kind === "slot") expect(r[0].target.slotId).toBe("dt-back");
    expect(r[1].target.kind).toBe("slot");
    if (r[1].target.kind === "slot") expect(r[1].target.slotId).toBe("dt-pass");
  });

  it("understands Persian special targets «سایر» and «عکس»", () => {
    const r = parseDocSortReply(`[{"index":1,"slot":"سایر"},{"index":2,"slot":"عکس"}]`, slots, 2);
    expect(r[0].target.kind).toBe("other");
    expect(r[1].target.kind).toBe("photo");
  });

  it("regex-salvages per-image entries out of a corrupted list reply", () => {
    const messy = 'خب نتیجه: {"index":1,"slot":"dt-pass"} سپس {"index":2,"slot":"photo"} و بقیه نامشخص.';
    const r = parseDocSortReply(messy, slots, 2);
    expect(r[0].target.kind).toBe("slot");
    expect(r[1].target.kind).toBe("photo");
  });
});

/* --------------------------- registry integration --------------------------- */

const T = Date.now();

function seedRow<O extends object>(patch: O): O {
  return { createdAt: T, updatedAt: T, ...patch } as O;
}

async function seedBase() {
  await db.representatives.add(seedRow({ id: "rep1", name: "رضا محمدی", phone: "070" }) as unknown as Representative);
  await db.lists.add(seedRow({ id: "list1", name: "لیست کابل" }) as unknown as ListFolder);
  await db.employers.add(seedRow({ id: "emp1", name: "شرکت الف" }) as unknown as Employer);
  await db.customers.add(seedRow({
    id: "c1", firstName: "احمد", lastName: "رحیمی", passportNo: "FA123456",
    representativeId: "rep1", listId: "list1", employerId: "emp1", registrationDate: "2026-10-01",
  }) as unknown as Customer);
  await db.customers.add(seedRow({
    id: "c2", firstName: "زهرا", lastName: "کریمی", passportNo: "ZK777",
    representativeId: "rep1", listId: "list1", employerId: null, registrationDate: "2026-10-02",
  }) as unknown as Customer);
  await db.requests.add(seedRow({
    id: "r1", customerId: "c1", representativeId: "rep1", listId: "list1",
    visaType: "کار", tags: [], registrationDate: "2026-10-03", issued: true, issuedAt: "2026-10-20",
  }) as unknown as VisaRequest);
  await db.requests.add(seedRow({
    id: "r2", customerId: "c2", representativeId: "rep1", listId: "list1",
    visaType: "تحصیلی", tags: [], registrationDate: "2026-10-04", issued: false, issuedAt: null,
  }) as unknown as VisaRequest);
}

const noopCtx = { navigate: () => {} };

type Registry = Awaited<ReturnType<typeof buildToolRegistry>>;

async function freshRegistry(): Promise<Registry> {
  return buildToolRegistry(noopCtx);
}

async function call(reg: Registry, name: string, args: Record<string, unknown> = {}) {
  return reg.execute({ id: "t1", name, args });
}

beforeEach(async () => {
  await Promise.all([
    db.representatives.clear(), db.customers.clear(), db.requests.clear(), db.lists.clear(),
    db.employers.clear(), db.payments.clear(), db.tags.clear(), db.visaTypes.clear(),
    db.customFields.clear(), db.activities.clear(), db.attachments.clear(), db.docTypes.clear(),
    db.preferences.clear(), db.accParties.clear(), db.accAccounts.clear(), db.accTransactions.clear(),
    db.accOutstanding.clear(), db.accDocs.clear(), db.accMeta.clear(), db.aiChats.clear(),
  ]);
  await seedBase();
});

describe("tool registry (live db)", () => {
  it("db_stats sees the seeded rows", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "db_stats");
    expect(res.ok).toBe(true);
    const data = res.data as Record<string, number>;
    expect(data.customers).toBe(2);
    expect(data.requests).toBe(2);
    expect(data.employers).toBe(1);
  });

  /* ---- lenient tool names + calendar (the user's «خنگ» complaints) ---- */

  it("resolves `countcustomers` (underscores stripped by the model) → count_customers with the REAL count", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "countcustomers");
    expect(res.ok).toBe(true);
    expect(res.name).toBe("count_customers"); // canonical name reported back
    const data = res.data as Record<string, unknown>;
    expect(data.total).toBe(2); // never 0 — data comes from the live db
  });

  it("an unknown tool fails with a helpful hint (not a hallucinated result)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "delete_everything");
    expect(res.ok).toBe(false);
    const data = res.data as { hint?: string };
    expect(data.hint).toBeTruthy();
  });

  it("Jalali + Persian-digit date filters actually filter (۱۴۰۵/۰۷/۱۰ → 2026-10-02)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "count_customers", { registered_from: "۱۴۰۵/۰۷/۱۰" });
    expect(res.ok).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.total).toBe(1); // only زهرا (2026-10-02), not both
  });

  it("date_info converts a Jalali date to Gregorian + weekday (1403/05/12 → 2024-08-02 جمعه)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "date_info", { date: "۱۴۰۳/۰۵/۱۲" });
    expect(res.ok).toBe(true);
    const d = res.data as { gregorian: string; weekday: { fa: string }; jalali_text: string };
    expect(d.gregorian).toBe("2024-08-02");
    expect(d.weekday.fa).toBe("جمعه");
    expect(d.jalali_text).toContain("مرداد");
  });

  it("date_info computes the distance between two dates (Persian digits OK)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "date_info", { date: "2026-10-01", to: "۱۴۰۵/۰۷/۱۰" }); // ۱۴۰۵/۰۷/۱۰ = 2026-10-02
    expect(res.ok).toBe(true);
    const d = res.data as { days_between: number };
    expect(d.days_between).toBe(1); // 2026-10-01 → 2026-10-02
  });

  it("get_current_date answers with both calendars + weekday", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "get_current_date");
    expect(res.ok).toBe(true);
    const d = res.data as { gregorian: string; jalali_text: string; weekday: { fa: string }; clock: string };
    expect(d.gregorian).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.jalali_text).toBeTruthy();
    expect(d.weekday.fa).toBeTruthy();
    expect(d.clock).toMatch(/^\d{2}:\d{2}$/);
  });

  /* ---- the SECOND reported failure: nested `filters` args were silently
     dropped → counts came back unfiltered and WRONG (regression) ---- */

  it("count_requests with NESTED filters wrapper + issued_date (Persian digits) filters correctly — the «۳۵ در تاریخ ۶» bug", async () => {
    const reg = await freshRegistry();
    // exactly what the model sent in production: everything under `filters`,
    // singular `issued_date`, Persian digits.
    const res = await call(reg, "countrequests", { filters: { status: "issued", issued_date: "۱۴۰۵/۰۷/۲۸" } });
    expect(res.ok).toBe(true);
    expect(res.name).toBe("count_requests");
    const d = res.data as { total: number; issued: number; applied_filters: Record<string, string> };
    expect(d.total).toBe(1); // only r1 (issued 2026-10-20) — NOT both requests
    expect(d.applied_filters.issued_from).toBe("2026-10-20");
    expect(d.applied_filters.status).toBe("issued");
  });

  it("applied_filters is EMPTY when no filter was given (model can self-verify)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "count_requests", {});
    expect(res.ok).toBe(true);
    const d = res.data as { total: number; applied_filters: Record<string, unknown> };
    expect(d.total).toBe(2);
    expect(Object.keys(d.applied_filters)).toHaveLength(0);
  });

  it("alias `type` maps to visa_type when the tool has no `type` param", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "count_requests", { type: "تحصیلی" });
    expect(res.ok).toBe(true);
    const d = res.data as { total: number; applied_filters: Record<string, string> };
    expect(d.total).toBe(1); // r2 (تحصیلی)
    expect(d.applied_filters.visa_type).toBe("تحصیلی");
  });

  it("alias `count` maps to limit", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "list_customers", { count: 1 });
    expect(res.ok).toBe(true);
    const d = res.data as { returned: number; customers: unknown[] };
    expect(d.returned).toBe(1);
    expect(d.customers).toHaveLength(1);
  });

  it("order=newest returns the freshly created customer first (fixes «آخرین مشتری»)", async () => {
    const reg = await freshRegistry();
    const created = await call(reg, "create_customer", {
      first_name: "یوسف", last_name: "نوری", representative: "رضا محمدی", list: "لیست کابل", passport_number: "YN002",
    });
    expect(created.ok).toBe(true);
    const res = await call(reg, "list_customers", { order: "newest", limit: 3 });
    const d = res.data as { customers: { name: string }[]; order: string };
    expect(d.order).toBe("newest");
    expect(d.customers[0].name).toContain("یوسف"); // newest first (createdAt = now > seed T)
    const oldest = await call(reg, "list_customers", { order: "oldest", limit: 3 });
    const od = oldest.data as { customers: { name: string }[] };
    expect(od.customers[0].name).toContain("احمد"); // oldest first (seed)
  });

  it("default list order is newest", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "list_customers", {});
    const d = res.data as { order: string };
    expect(d.order).toBe("newest");
  });

  /* ---- raw protocol JSON must never reach the user as a message ---- */

  it("looksLikeProtocolJson detects raw tool-call JSON (with/without fences)", () => {
    expect(looksLikeProtocolJson(`{"toolcalls":[{"id":"c1","name":"countrequests","args":{}}]}`)).toBe(true);
    expect(looksLikeProtocolJson("```json\n{\"tool_calls\":[{\"name\":\"db_stats\"}]}\n```")).toBe(true);
    expect(looksLikeProtocolJson("سلام! امروز ۳۴۶ مشتری دارید.")).toBe(false);
    expect(looksLikeProtocolJson(`{"first_name":"احمد"}`)).toBe(false);
    expect(looksLikeProtocolJson("")).toBe(false);
  });

  it("resolve_names maps a Persian name to an id", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "resolve_names", { query: "شرکت", kind: "employer" });
    const data = res.data as { employers: { id: string; name: string }[] };
    expect(data.employers).toHaveLength(1);
    expect(data.employers[0].id).toBe("emp1");
  });

  it("list_customers with employer=none only returns the employerless", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "list_customers", { employer: "none" });
    const data = res.data as { customers: { name: string; employer: string }[] };
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].name).toContain("زهرا");
    expect(data.customers[0].employer).toBe("بدون کارفرما");
  });

  it("list_customers filters by employer name", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "list_customers", { employer: "شرکت الف" });
    const data = res.data as { customers: { name: string }[] };
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].name).toContain("احمد");
  });

  it("create_customer FAILS with a hint when the list is unknown (never guesses)", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "create_customer", { first_name: "یوسف", last_name: "نوری", representative: "رضا" });
    expect(res.ok).toBe(false);
    const data = res.data as { hint?: string };
    expect(data.hint).toContain("بپرس");
  });

  it("create_customer → get_customer round-trip with employer", async () => {
    const reg = await freshRegistry();
    const created = await call(reg, "create_customer", {
      first_name: "یوسف", last_name: "نوری", representative: "رضا محمدی", list: "لیست کابل",
      employer: "شرکت الف", passport_number: "YN001",
    });
    expect(created.ok).toBe(true);
    const id = (created.data as { id: string }).id;
    const got = await call(reg, "get_customer", { selector: "یوسف نوری" });
    const data = got.data as { id: string; employer: string; passport: string };
    expect(data.id).toBe(id);
    expect(data.employer).toBe("شرکت الف");
    expect(data.passport).toBe("YN001");
  });

  it("create_customer rejects a duplicate passport with the existing record", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "create_customer", {
      first_name: "دوباره", last_name: "تست", representative: "رضا", list: "کابل",
      passport_number: "FA123456",
    });
    expect(res.ok).toBe(false);
    expect((res.data as { error: string }).error).toContain("تکراری");
  });

  it("list_requests by issued-date range + status", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "list_requests", { status: "issued", issued_from: "2026-10-01", issued_to: "2026-10-31" });
    const data = res.data as { total: number; requests: { customer: string; status: string }[] };
    expect(data.total).toBe(1);
    expect(data.requests[0].customer).toContain("احمد");
    expect(data.requests[0].status).toBe("صادر شده");
  });

  it("create_request defaults the representative/list from the customer", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "create_request", { customer: "زهرا کریمی", visa_type: "کاری", quoted_amount: 500, currency: "USD" });
    expect(res.ok).toBe(true);
    const data = res.data as { representative: string; list: string; amount: string };
    expect(data.representative).toBe("رضا محمدی");
    expect(data.list).toBe("لیست کابل");
    expect(data.amount).toContain("دلار");
  });

  it("set_request_issued marks and then undoes", async () => {
    const reg = await freshRegistry();
    const on = await call(reg, "set_request_issued", { request: "r2", issued_date: "2026-10-25" });
    expect(on.ok).toBe(true);
    const check = await call(reg, "get_request", { id: "r2" });
    expect(((check.data as { status: string }).status)).toBe("صادر شده");
    const off = await call(reg, "set_request_issued", { request: "r2", undo: true });
    expect(off.ok).toBe(true);
    const recheck = await call(reg, "get_request", { id: "r2" });
    expect((recheck.data as { status: string }).status).toBe("در حال کار");
  });

  it("query_table filters boolean equality", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "query_table", { table: "requests", filters: { issued: true } });
    const data = res.data as { total: number; rows: { id: string }[] };
    expect(data.total).toBe(1);
    expect(data.rows[0].id).toBe("r1");
  });

  it("describe_schema lists fields for a known table", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "describe_schema", { table: "customers" });
    const data = res.data as { fields: Record<string, string>; row_count: number };
    expect(data.fields["employerId"]).toContain("کارفرما");
    expect(data.row_count).toBe(2);
  });

  it("unknown tools fail with guidance, never crash", async () => {
    const reg = await freshRegistry();
    const res = await call(reg, "does_not_exist", {});
    expect(res.ok).toBe(false);
    expect((res.data as { hint: string }).hint).toContain("ابزار");
  });
});
