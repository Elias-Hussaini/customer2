/**
 * Central AI Agent — TOOL REGISTRY (دستیار هوشمند).
 *
 * Every capability of the app is exposed to the model as a tool. The registry
 * is built against the LIVE database, so data added by future features is
 * visible automatically through the generic tools (db_stats / describe_schema /
 * query_table iterate `db.tables` dynamically and never hard-code a list).
 *
 * Design rules:
 *  - Tools return COMPACT JSON for the model + a Persian one-line `summary`
 *    for the chat UI chip.
 *  - Write tools NEVER guess: when a required input is missing they fail with
 *    a `hint` telling the model to ask the user first.
 *  - Blobs (document images) never leak into JSON — rows are sanitized.
 */

import { db } from "../../db/schema";
import type { ToolDef, ToolCallRequest, ToolCallResult } from "./types";
import { testWorker } from "../ai/client";
import type { AiWorker as AiWorkerType } from "../ai/types";
import { setThemeGlobal } from "../../hooks/useTheme";
import {
  isLeapJalaaliYear as jalaliIsLeap,
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian as jalaliToGregorian,
  toJalaali,
} from "jalaali-js";
import { todayIso, formatJalali, toLatinDigits, isoFromDate, dateFromIso } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import { customerFullName, findDuplicatePassport, createCustomer } from "../../db/customers";
import { createRequest, setRequestIssued } from "../../db/requests";
import { createEmployer } from "../../db/employers";
import { createPayment } from "../../db/payments";
import { getAttachmentsFor } from "../../db/attachments";
import { logActivity } from "../../db/activities";
import { downloadBlob } from "../../utils/export/tabular";
import {
  computeAllAccountBalances,
  totalCashBalances,
} from "../../accounting/engine";
import type { Customer, Representative, ListFolder, Employer } from "../../types";
import type { FinTransaction } from "../../accounting/types";

/* ------------------------------ small helpers ----------------------------- */

type Args = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : undefined;
const strAll = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : undefined;
/** Numbers accept Persian/Arabic digits and thousand separators: "۱٬۲۳۴" → 1234 */
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(toLatinDigits(v).replace(/[,_٬\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};
const bool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = toLatinDigits(v).trim().toLowerCase();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
  }
  return undefined;
};

const norm = (s: string): string => s.replace(/[\s\u200c]+/g, " ").trim().toLowerCase();
const normPassport = (s: string): string => s.replace(/[\s\-_.]/g, "").toUpperCase();

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Parse a model-supplied date FLEXIBLY → ISO yyyy-mm-dd:
 *  "2026-01-05" ✓  "۱۴۰۴/۱۰/۱۵" ✓  "1404-10-15" (Jalali) ✓
 * Persian digits are normalized, and a 1300–1500 year is auto-detected as
 * Jalali and converted — a 1900–2100 year passes through as Gregorian.
 * Anything unparseable returns undefined (the filter is then ignored loudly
 * upstream, instead of silently mismatching).
 */
const isoDate = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  const s = toLatinDigits(v).trim().replace(/[.\\/-]+/g, "/");
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (!m) return undefined;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y >= 1900 && y <= 2100) return `${y}-${pad2(mo)}-${pad2(d)}`;
  if (y >= 1300 && y <= 1500 && isValidJalaaliDate(y, mo, d)) {
    const g = jalaliToGregorian(y, mo, d);
    return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`;
  }
  return undefined;
};

function between(v: string | undefined | null, from?: string, to?: string): boolean {
  if (!v) return !from && !to;
  if (from && v < from) return false;
  if (to && v > to) return false;
  return true;
}

const LIMIT_DEF = 20;
const LIMIT_MAX = 100;
function pageArgs(args: Args): { limit: number; offset: number } {
  const limit = Math.min(Math.max(1, Math.round(num(args.limit) ?? LIMIT_DEF)), LIMIT_MAX);
  const offset = Math.max(0, Math.round(num(args.offset) ?? 0));
  return { limit, offset };
}

/** Persian short date for summaries. */
const jdate = (iso?: string | null): string => (iso ? formatJalali(iso) : "—");

/** Replace Blobs (document images) with a size marker — JSON stays small. */
function sanitizeRow<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Blob) out[k] = `«blob ${(v.size / 1024).toFixed(0)}KB»`;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        inner[k2] = v2 instanceof Blob ? `«blob ${(v2.size / 1024).toFixed(0)}KB»` : v2;
      }
      out[k] = inner;
    } else out[k] = v;
  }
  return out as T;
}

/** Result builders. */
function ok(data: unknown, summary: string, extra?: Partial<ToolCallResult>): ToolCallResult {
  return { id: "", name: "", ok: true, data, summary, ms: 0, ...extra };
}
function fail(message: string, hint?: string): ToolCallResult {
  return { id: "", name: "", ok: false, data: { error: message, hint }, summary: `خطا: ${message}`, ms: 0 };
}

/* --------------------------- name → entity lookup -------------------------- */

async function allReps(): Promise<Representative[]> {
  return (await db.representatives.toArray()).filter((r) => !r.archivedAt);
}
async function allLists(): Promise<ListFolder[]> {
  return (await db.lists.toArray()).filter((l) => !l.archivedAt);
}
async function allEmployers(): Promise<Employer[]> {
  return (await db.employers.toArray()).filter((e) => !e.archivedAt);
}

async function findRep(q: string): Promise<Representative | undefined> {
  const list = await allReps();
  return (
    list.find((r) => r.id === q) ??
    list.find((r) => norm(r.name) === norm(q)) ??
    (q.trim() ? list.find((r) => norm(r.name).includes(norm(q))) : undefined)
  );
}
async function findList(q: string): Promise<ListFolder | undefined> {
  const list = await allLists();
  return (
    list.find((l) => l.id === q) ??
    list.find((l) => norm(l.name) === norm(q)) ??
    (q.trim() ? list.find((l) => norm(l.name).includes(norm(q))) : undefined)
  );
}
async function findEmployer(q: string): Promise<Employer | undefined> {
  const list = await allEmployers();
  return (
    list.find((e) => e.id === q) ??
    list.find((e) => norm(e.name) === norm(q)) ??
    (q.trim() ? list.find((e) => norm(e.name).includes(norm(q))) : undefined)
  );
}
async function findCustomers(q: string): Promise<Customer[]> {
  const all = (await db.customers.toArray()).filter((c) => !c.archivedAt);
  const byId = all.filter((c) => c.id === q);
  if (byId.length > 0) return byId;
  const byPassport = all.filter((c) => c.passportNo && normPassport(c.passportNo) === normPassport(q));
  if (byPassport.length > 0) return byPassport;
  const nq = norm(q);
  return nq ? all.filter((c) => norm(customerFullName(c)).includes(nq)) : [];
}

/* ------------------------------ data dictionary ---------------------------- */

/** Static Persian docs for the core tables (fields + purpose). */
const SCHEMA_DOCS: Record<string, { purpose: string; fields: Record<string, string> }> = {
  customers: {
    purpose: "مشتریان — پروندهٔ هر شخص (نام، پاسپورت، نماینده، لیست، کارفرما، تاریخ ثبت)",
    fields: {
      id: "شناسه یکتا", firstName: "نام", lastName: "نام خانوادگی", photo: "عکس پروفایل (dataURL)",
      birthDate: "تاریخ تولد (میلادی yyyy-mm-dd)", passportNo: "شماره پاسپورت",
      passportIssueDate: "تاریخ صدور پاسپورت", passportExpiryDate: "تاریخ انقضای پاسپورت",
      referrer: "معرف", notes: "یادداشت", representativeId: "نمایندهٔ ثبت‌کننده", listId: "لیست ثبت",
      employerId: "کارفرما (null = بدون کارفرما)", registrationDate: "تاریخ ثبت (yyyy-mm-dd)",
      customValues: "مقادیر فیلدهای سفارشی", createdAt: "زمان ایجاد", updatedAt: "زمان ویرایش", archivedAt: "زمان بایگانی",
    },
  },
  requests: {
    purpose: "درخواست‌های ویزا — یکی به ازای هر درخواست هر مشتری",
    fields: {
      id: "شناسه یکتا", customerId: "مشتریِ درخواست", representativeId: "نماینده", listId: "لیست",
      visaType: "نوع ویزا (متن آزاد)", tags: "برچسب‌ها (آرایه‌ای از id ها)",
      quotedAmount: "مبلغ توافقی (واحد اصلی)", currency: "IRT تومان | USD دلار | AFN افغانی",
      registrationDate: "تاریخ ثبت", issued: "صادر شده؟ (true/false)",
      issuedAt: "تاریخ صدور (وقتی issued=true)", notes: "یادداشت", createdAt: "زمان ایجاد",
    },
  },
  representatives: { purpose: "نمایندگان — ثبت‌کننده‌های مشتریان", fields: { id: "شناسه", name: "نام", phone: "تلفن", contactInfo: "اطلاعات تماس", notes: "یادداشت", photo: "عکس پروفایل" } },
  employers: { purpose: "کارفرمایان — شرکت/شخصی که مشتری برای او کار می‌کند", fields: { id: "شناسه", name: "نام", phone: "تلفن", contactInfo: "اطلاعات تماس", notes: "یادداشت" } },
  lists: { purpose: "لیست‌ها — گروه‌بندی ثبت مشتریان (مثلاً لیست کابل)", fields: { id: "شناسه", name: "نام لیست", description: "توضیح", category: "دسته", startDate: "شروع", endDate: "پایان" } },
  payments: { purpose: "پرداخت‌ها — مالی نمایندگان", fields: { id: "شناسه", representativeId: "نماینده", requestId: "درخواست مرتبط", amount: "مبلغ (واحد اصلی)", currency: "IRT | USD | AFN", date: "تاریخ", description: "توضیح" } },
  attachments: { purpose: "مدارک و تصاویر — فایل‌های هر مشتری (blob) و رسید پرداخت‌ها", fields: { id: "شناسه", customerId: "مشتری (null برای رسید)", paymentId: "رسید پرداخت", kind: "نوع سند (id بخش مدارک یا other/receipt)", name: "نام فایل", mime: "نوع فایل", size: "حجم بایت", blob: "خود فایل" } },
  docTypes: { purpose: "بخش‌های مدارک — اسلات‌های قابل انتخاب (پاسپورت، جلد تذکره، …)", fields: { id: "شناسه", label: "برچسب فارسی", order: "ترتیب", customerId: "مالک (null = سراسری)", archivedAt: "زمان بایگانی" } },
  visaTypes: { purpose: "انواع ویزا — متن آزاد نوع درخواست", fields: { id: "شناسه", name: "نام" } },
  tags: { purpose: "برچسب‌ها — وضعیت‌هایی مثل «فوری»", fields: { id: "شناسه", name: "نام", color: "رنگ", isUrgent: "فوری؟" } },
  customFields: { purpose: "فیلدهای سفارشی مشتری/درخواست", fields: { id: "شناسه", key: "کلید پایدار", label: "برچسب", type: "نوع", entity: "customer | request", options: "گزینه‌ها", required: "اجباری؟" } },
  activities: { purpose: "رویدادها — تاریخچهٔ تغییرات", fields: { id: "شناسه", ts: "زمان", type: "نوع", entity: "موجودیت", entityId: "شناسه موجودیت", title: "عنوان", detail: "جزئیات" } },
  accParties: { purpose: "حسابداری — طرف‌حساب‌ها (شخص/شرکت)", fields: { id: "شناسه", code: "کد", type: "individual | company", name: "نام", phone: "تلفن", idNumber: "شناسه/کد ملی" } },
  accAccounts: { purpose: "حسابداری — حساب‌های صندوق/بانک", fields: { id: "شناسه", name: "نام", type: "نوع", currency: "IRT | USD | AFN", active: "فعال؟" } },
  accTransactions: { purpose: "حسابداری — تراکنش‌های مالی", fields: { id: "شناسه", number: "شمارهً مرجع", type: "نوع تراکنش", partyId: "طرف‌حساب", amount: "مبلغ", currency: "ارز", date: "تاریخ", description: "توضیح", sourceAccountId: "حساب مبدأ", destAccountId: "حساب مقصد", status: "وضعیت", affectsBalance: "اثر بر مانده؟" } },
  accOutstanding: { purpose: "حسابداری — مطالبات/بدهی‌ها", fields: { id: "شناسه", kind: "نوع", partyId: "طرف‌حساب", amount: "مبلغ", currency: "ارز", dueDate: "سررسید", status: "وضعیت", settlements: "پرداخت‌های جزئی" } },
};

/** Tables the agent may read through query_table (secrets excluded). */
const READABLE_TABLES = [
  "representatives", "customers", "requests", "lists", "payments", "tags", "visaTypes",
  "customFields", "activities", "attachments", "docTypes", "employers",
  "accParties", "accAccounts", "accTransactions", "accOutstanding", "accDocs",
] as const;

function tableIsReadable(name: string): boolean {
  return (READABLE_TABLES as readonly string[]).includes(name);
}

/* ------------------------------- vision helpers ---------------------------- */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}

/** Document image → data URL, downscaled when huge so the model can see it. */
async function blobForVision(blob: Blob): Promise<string> {
  if (blob.size < 900_000) return blobToDataUrl(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/* =========================================================================
 * THE REGISTRY
 * ========================================================================= */

import { computePartyTotals } from "../../accounting/engine";
import type { ToolParam } from "./types";

/** What the page injects (navigation, toasts). */
export interface ToolCtx {
  navigate: (to: string) => void;
}

const P = (
  name: string,
  type: ToolParam["type"],
  description: string = "",
  required = false,
  extra?: Partial<ToolParam>,
): ToolParam => ({ name, type, description, required, ...extra });

export async function buildToolRegistry(ctx: ToolCtx): Promise<{
  tools: ToolDef[];
  execute: (call: ToolCallRequest) => Promise<ToolCallResult>;
}> {
  interface Entry { def: ToolDef; run: (a: Args) => Promise<ToolCallResult> }
  const entries: Entry[] = [];

  /* ------------------------------ meta / dictionary ---------------------- */

  entries.push({
    def: { name: "db_stats", description: "تعداد رکوردهای همهٔ جداول زنده (دیتابیس محلی). جدول‌های آینده خودشان ظاهر می‌شوند.", params: [], writes: false },
    run: async () => {
      const out: Record<string, number> = {};
      for (const table of db.tables) {
        if (table.name === "aiMeta") continue;
        out[table.name] = await table.count();
      }
      return ok(out, `آمار زنده — ${Object.keys(out).length} جدول`);
    },
  });

  entries.push({
    def: {
      name: "describe_schema",
      description: "دیکشنری داده در حداقل granularity: بدون table فهرست همهٔ جداول؛ با table همهٔ فیلدها + نوع + نمونهٔ واقعی + تعداد ردیف. جدول‌های ناشناخته از روی داده استنباط می‌شوند.",
      params: [P("table", "string", "نام جدول (اختیاری)")],
      writes: false,
    },
    run: async (a) => {
      const t = str(a.table);
      if (!t) {
        const tables: Record<string, string> = {};
        for (const name of READABLE_TABLES) tables[name] = SCHEMA_DOCS[name]?.purpose ?? "—";
        return ok({ readable_tables: READABLE_TABLES, tables, hint: "برای جزئیات هر جدول، همان table را بده" }, "دیکشنری داده");
      }
      if (!tableIsReadable(t)) return fail(`جدول «${t}» قابل خواندن نیست`, `جدول‌های مجاز: ${READABLE_TABLES.join("، ")}`);
      const doc = SCHEMA_DOCS[t];
      const first = await db.table(t).limit(1).toArray();
      let fields: Record<string, string> = doc?.fields ?? {};
      if (!doc && first.length > 0) {
        const s = sanitizeRow(first[0]) as Record<string, unknown>;
        fields = Object.fromEntries(Object.keys(s).map((k) => [k, `${typeof s[k]} (استنباط‌شده)`]));
      }
      return ok({
        table: t,
        purpose: doc?.purpose ?? "(ناشناخته — استنباط از داده)",
        fields,
        row_count: await db.table(t).count(),
        sample: first.length > 0 ? sanitizeRow(first[0]) : null,
      }, `شرح ${t}`);
    },
  });

  /* --------------------------------- calendar ----------------------------- */

  /** Shared: describe one ISO date in BOTH calendars (weekday, leap, month…). */
  function describeDate(iso: string): Record<string, unknown> {
    const d = dateFromIso(iso)!;
    const j = toJalaali(d);
    const today = todayIso();
    const t0 = dateFromIso(today)!;
    const diffDays = Math.round((d.getTime() - t0.getTime()) / 86_400_000);
    return {
      gregorian: iso,
      gregorian_text: `${iso} (${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })})`,
      jalali: { year: j.jy, month: j.jm, day: j.jd },
      jalali_text: formatJalali(iso, "long"),
      jalali_month_name: ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"][j.jm - 1],
      weekday: { fa: d.toLocaleDateString("fa-IR", { weekday: "long" }), en: d.toLocaleDateString("en-US", { weekday: "long" }) },
      jalali_leap_year: jalaliIsLeap(j.jy),
      jalali_month_length: jalaaliMonthLength(j.jy, j.jm),
      days_from_today: diffDays,
      relative: diffDays === 0 ? "امروز" : diffDays > 0 ? `${diffDays} روز آینده` : `${Math.abs(diffDays)} روز گذشته`,
      today,
    };
  }

  entries.push({
    def: {
      name: "get_current_date",
      description: "تاریخ و ساعت همین حالا به هر دو تقویم (شمسی + میلادی) + روز هفته. برای هر سؤال «امروز چندمه؟» / «حالا چه ساعتی است؟» / «چند شنبه است؟» اول این را صدا بزن — هرگز از حدس خودت استفاده نکن.",
      params: [],
      writes: false,
    },
    run: async () => {
      const now = new Date();
      const g = isoFromDate(now);
      const info = describeDate(g);
      return ok({
        ...info,
        clock: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
        clock_24h: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
        note: "تاریخ‌های ذخیره‌شدهٔ برنامه میلادی ISO هستند؛ شکل شمسی‌شان در نتایج ابزار با پسوند jalali آمده.",
      }, `امروز ${formatJalali(g)} — ${info.weekday && (info.weekday as { fa: string }).fa}`);
    },
  });

  entries.push({
    def: {
      name: "date_info",
      description: "تقویم کامل: هر تاریخ شمسی (مثل 1404/07/12 یا ۱۴۰۴/۰۷/۱۲) یا میلادی (2025-10-02 یا 2025/10/2) را به هر دو تقویم تبدیل می‌کند + روز هفته + کبیسه + طول ماه + فاصله تا امروز. با to، فاصلهٔ دقیق دو تاریخ را هم می‌دهد. برای هر محاسبه/تبدیل/مقایسهٔ تاریخ از این استفاده کن.",
      params: [
        P("date", "string", "تاریخ شمسی یا میلادی (ارقام فارسی هم OK)", true),
        P("to", "string", "تاریخ دوم برای محاسبهٔ فاصله (اختیاری، شمسی یا میلادی)"),
      ],
      writes: false,
    },
    run: async (a) => {
      const d1 = isoDate(str(a.date));
      if (!d1) return fail("تاریخ قابل فهم نبود", "فرمت‌های مجاز: 1404/07/12 یا 2025-10-02 یا 2025/10/2 (ارقام فارسی هم OK)");
      const out: Record<string, unknown> = { input: str(a.date), ...describeDate(d1) };
      const toRaw = str(a.to);
      if (toRaw) {
        const d2 = isoDate(toRaw);
        if (!d2) return fail(`تاریخ دوم «${toRaw}» قابل فهم نبود`, "همان فرمت‌های مجاز date");
        const a1 = dateFromIso(d1)!;
        const a2 = dateFromIso(d2)!;
        out.to = describeDate(d2);
        out.days_between = Math.round((a2.getTime() - a1.getTime()) / 86_400_000);
      }
      return ok(out, `${formatJalali(d1)}${out.days_between != null ? ` — فاصله ${toLatinDigits(String(out.days_between))} روز` : ""}`);
    },
  });

  entries.push({
    def: {
      name: "query_table",
      description: "کوئری عمومی روی هر جدول مجاز (escaped hatch برای هر چیزی که ابزار اختصاصی ندارد). filters: {فیلد: مقدار} یا {فیلد: {min,max}} برای بازهٔ عددی؛ رشته‌ها حساس-به-حروف نیستند.",
      params: [
        P("table", "string", "نام جدول", true),
        P("filters", "object", "مثل {\"listId\":\"l1\"} یا {\"quotedAmount\":{\"min\":100}}"),
        P("order_by", "string", "فیلد مرتب‌سازی"),
        P("desc", "boolean", "نزولی؟"),
        P("limit", "number", "پیش‌فرض ۲۰، حداکثر ۱۰۰"),
        P("offset", "number", "رد کردن ابتدای نتیجه"),
        P("include_archived", "boolean", "بایگانی‌شده‌ها هم بیایند؟ پیش‌فرض خیر"),
      ],
      writes: false,
    },
    run: async (a) => {
      const t = str(a.table);
      if (!t || !tableIsReadable(t)) return fail(`جدول «${t ?? "?"}» قابل خواندن نیست`, `جدول‌های مجاز: ${READABLE_TABLES.join("، ")}`);
      let rows: Record<string, unknown>[] = await db.table(t).toArray();
      if (!bool(a.include_archived)) rows = rows.filter((r) => !r.archivedAt);
      const filters = (a.filters && typeof a.filters === "object" && !Array.isArray(a.filters) ? a.filters : {}) as Record<string, unknown>;
      rows = rows.filter((row) => {
        for (const [k, want] of Object.entries(filters)) {
          const have = row[k];
          if (want != null && typeof want === "object" && !Array.isArray(want)) {
            const w = want as { min?: unknown; max?: unknown };
            const n = Number(have);
            if (w.min != null && !(n >= Number(w.min))) return false;
            if (w.max != null && !(n <= Number(w.max))) return false;
            continue;
          }
          if (have == null || want == null) { if (have !== want) return false; continue; }
          const hv = Array.isArray(have) ? have.map(String) : String(have).toLowerCase();
          const wv = String(want).toLowerCase();
          if (Array.isArray(hv) ? !hv.includes(wv) : hv !== wv) return false;
        }
        return true;
      });
      const ob = str(a.order_by);
      if (ob) {
        rows.sort((x, y) => {
          const xv = x[ob]; const yv = y[ob];
          const xn = Number(xv); const yn = Number(yv);
          const byNum = !Number.isNaN(xn) && !Number.isNaN(yn) && xv != null && yv != null;
          const c = byNum
            ? xn < yn ? -1 : xn > yn ? 1 : 0
            : String(xv ?? "") < String(yv ?? "") ? -1 : String(xv ?? "") > String(yv ?? "") ? 1 : 0;
          return bool(a.desc) ? -c : c;
        });
      }
      const { limit, offset } = pageArgs(a);
      const total = rows.length;
      const slice = rows.slice(offset, offset + limit).map(sanitizeRow);
      return ok({ table: t, total, offset, returned: slice.length, rows: slice }, `${t}: ${total.toLocaleString("fa-IR")} ردیف`);
    },
  });

  entries.push({
    def: {
      name: "resolve_names",
      description: "نام فارسی → id برای نماینده/لیست/کارفرما/نوع ویزا/برچسب/بخش مدرک. بدون query فهرست کامل می‌دهد. قبل از هر ثبت/فیلتر با نام، اول این را صدا بزن.",
      params: [
        P("query", "string", "نام جستجو (اختیاری)"),
        P("kind", "string", "representative | list | employer | visa_type | tag | doc_type | all", false, { enum: ["representative", "list", "employer", "visa_type", "tag", "doc_type", "all"] }),
      ],
      writes: false,
    },
    run: async (a) => {
      const kind = str(a.kind) ?? "all";
      const allowed = ["representative", "list", "employer", "visa_type", "tag", "doc_type", "all"];
      if (!allowed.includes(kind)) return fail(`kind نامعتبر: ${kind}`, `یکی از ${allowed.join("، ")}`);
      const q = str(a.query);
      const pick = <T extends { id: string }>(list: T[], label: (x: T) => string) => {
        let arr = list;
        if (q) arr = list.filter((x) => norm(label(x)).includes(norm(q)));
        return arr.slice(0, 12).map((x) => ({ id: x.id, name: label(x) }));
      };
      const reps = await allReps(); const lists = await allLists(); const emps = await allEmployers();
      const vt = (await db.visaTypes.toArray()).filter((v) => !v.archivedAt);
      const tags = (await db.tags.toArray()).filter((t) => !t.archivedAt);
      const dts = (await db.docTypes.toArray()).filter((d) => !d.archivedAt);
      const out: Record<string, unknown> = {};
      if (kind === "all" || kind === "representative") out.representatives = pick(reps, (r) => r.name);
      if (kind === "all" || kind === "list") out.lists = pick(lists, (l) => l.name);
      if (kind === "all" || kind === "employer") out.employers = pick(emps, (e) => e.name);
      if (kind === "all" || kind === "visa_type") out.visa_types = pick(vt, (v) => v.name);
      if (kind === "all" || kind === "tag") out.tags = pick(tags, (t) => t.name);
      if (kind === "all" || kind === "doc_type") out.doc_types = pick(dts, (d) => d.label);
      return ok(out, q ? `جستجوی «${q}»` : "فهرست نام‌ها");
    },
  });

  /* --------------------------------- customers --------------------------- */

  interface CustFilter { name?: string; passport?: string; rep?: string; list?: string; emp?: string; from?: string; to?: string }
  const customerFilterArgs: ToolParam[] = [
    P("name", "string", "بخشی از نام مشتری"),
    P("passport", "string", "شماره پاسپورت (دقیق)"),
    P("representative", "string", "نام یا id نماینده"),
    P("list", "string", "نام یا id لیست"),
    P("employer", "string", "نام/id کارفرما یا «none» برای بدون کارفرما"),
    P("registered_from", "string", "از تاریخ ثبت — میلادی 2026-01-05 یا شمسی 1404/10/15"),
    P("registered_to", "string", "تا تاریخ ثبت — میلادی یا شمسی"),
  ];

  async function filterCustomers(f: CustFilter): Promise<Customer[]> {
    let rows = (await db.customers.toArray()).filter((c) => !c.archivedAt);
    if (f.name) { const n = norm(f.name); rows = rows.filter((c) => norm(customerFullName(c)).includes(n)); }
    if (f.passport) { const p = normPassport(f.passport); rows = rows.filter((c) => c.passportNo && normPassport(c.passportNo) === p); }
    if (f.rep) { const r = await findRep(f.rep); rows = rows.filter((c) => c.representativeId === (r?.id ?? "__none__")); }
    if (f.list) { const l = await findList(f.list); rows = rows.filter((c) => c.listId === (l?.id ?? "__none__")); }
    if (f.emp) {
      if (f.emp === "none") rows = rows.filter((c) => !c.employerId);
      else { const e = await findEmployer(f.emp); rows = rows.filter((c) => c.employerId === (e?.id ?? "__none__")); }
    }
    if (f.from || f.to) rows = rows.filter((c) => between(c.registrationDate, f.from, f.to));
    return rows;
  }

  function custRow(c: Customer, rep?: string, list?: string, emp?: string | null, stats?: { total: number; issued: number }) {
    return {
      id: c.id,
      name: customerFullName(c),
      passport: c.passportNo ?? "—",
      representative: rep ?? "—",
      list: list ?? "—",
      employer: c.employerId ? emp ?? "—" : "بدون کارفرما",
      registered: c.registrationDate,
      registered_jalali: jdate(c.registrationDate),
      requests: stats ?? undefined,
    };
  }

  entries.push({
    def: { name: "list_customers", description: "جستجو/فهرست مشتریان با فیلترها. پاسخ فشرده برای ادامهٔ کار.", params: [...customerFilterArgs, P("limit", "number", "پیش‌فرض ۲۰"), P("offset", "number")], writes: false },
    run: async (a) => {
      const rows = await filterCustomers({
        name: str(a.name), passport: str(a.passport), rep: str(a.representative), list: str(a.list),
        emp: str(a.employer), from: isoDate(str(a.registered_from)), to: isoDate(str(a.registered_to)),
      });
      const reps = await allReps(); const lists = await allLists(); const emps = await allEmployers();
      const reqs = (await db.requests.toArray()).filter((r) => !r.archivedAt);
      const repName = (id?: string | null) => reps.find((x) => x.id === id)?.name ?? "—";
      const listName = (id?: string | null) => lists.find((x) => x.id === id)?.name ?? "—";
      const empName = (id?: string | null) => (id ? emps.find((x) => x.id === id)?.name ?? "—" : null);
      const { limit, offset } = pageArgs(a);
      const page = rows.slice(offset, offset + limit);
      const out = page.map((c) => {
        const mine = reqs.filter((r) => r.customerId === c.id);
        return custRow(c, repName(c.representativeId), listName(c.listId), empName(c.employerId),
          { total: mine.length, issued: mine.filter((r) => r.issued).length });
      });
      return ok({ total: rows.length, returned: out.length, customers: out }, `${rows.length.toLocaleString("fa-IR")} مشتری`);
    },
  });

  entries.push({
    def: { name: "count_customers", description: "فقط تعداد، بدون ردیف‌ها.", params: [...customerFilterArgs], writes: false },
    run: async (a) => {
      const rows = await filterCustomers({
        name: str(a.name), passport: str(a.passport), rep: str(a.representative), list: str(a.list),
        emp: str(a.employer), from: isoDate(str(a.registered_from)), to: isoDate(str(a.registered_to)),
      });
      return ok({ total: rows.length }, `${rows.length.toLocaleString("fa-IR")} مشتری`);
    },
  });

  entries.push({
    def: { name: "get_customer", description: "پروفایل کامل یک مشتری: مدرک‌ها، درخواست‌ها، پرداخت‌ها، کارفرما. اگر چند نفر هم‌نام باشند candidates برمی‌گرداند.", params: [P("selector", "string", "id یا نام یا شماره پاسپورت", true)], writes: false },
    run: async (a) => {
      const q = str(a.selector);
      if (!q) return fail("selector لازم است");
      const found = await findCustomers(q);
      if (found.length === 0) return fail(`مشتری «${q}» پیدا نشد`, "با list_customers جستجو کن یا از کاربر بپرس");
      if (found.length > 1) return ok({ candidates: found.slice(0, 8).map((c) => ({ id: c.id, name: customerFullName(c), passport: c.passportNo ?? "—" })) }, `${found.length} هم‌نام پیدا شد — از کاربر بپرس کدام`);
      const c = found[0];
      const rep = (await allReps()).find((x) => x.id === c.representativeId);
      const list = (await allLists()).find((x) => x.id === c.listId);
      const emp = (await allEmployers()).find((x) => x.id === c.employerId);
      const reqs = (await db.requests.toArray()).filter((r) => !r.archivedAt && r.customerId === c.id);
      const pays = (await db.payments.toArray()).filter((p) => p.representativeId === c.representativeId);
      const docs = await getAttachmentsFor(c.id);
      const dts = (await db.docTypes.toArray()).filter((d) => !d.archivedAt);
      const labelOf = (kind: string) => dts.find((d) => d.id === kind)?.label ?? (kind === "other" ? "سایر" : kind === "receipt" ? "رسید" : kind);
      const byKind: Record<string, number> = {};
      for (const d of docs) byKind[labelOf(d.kind)] = (byKind[labelOf(d.kind)] ?? 0) + 1;
      const payTotals: Record<string, number> = {};
      for (const p of pays) payTotals[p.currency] = (payTotals[p.currency] ?? 0) + p.amount;
      return ok({
        id: c.id, name: customerFullName(c), passport: c.passportNo ?? "—", birth_date: c.birthDate ?? null,
        employer: emp?.name ?? "بدون کارفرما", representative: rep?.name ?? "—", list: list?.name ?? "—",
        registered: c.registrationDate, registered_jalali: jdate(c.registrationDate), notes: c.notes ?? null,
        has_profile_photo: !!c.photo,
        requests: reqs.map((r) => ({
          id: r.id, visa_type: r.visaType ?? "—", status: r.issued ? "صادر شده" : "در حال کار",
          registered: r.registrationDate, issued_at: r.issuedAt ?? null,
          amount: r.quotedAmount != null ? formatMoney(r.quotedAmount, r.currency ?? "IRT") : null,
        })),
        documents: byKind,
        payments_note: "پرداخت‌ها به نام نماینده ثبت می‌شوند؛ مجموع پرداخت‌های نمایندهٔ این مشتری",
        representative_payments_total: Object.fromEntries(Object.entries(payTotals).map(([k, v]) => [k, formatMoney(v, k as "IRT")])),
      }, `پروفایل ${customerFullName(c)}`);
    },
  });

  entries.push({
    def: {
      name: "create_customer",
      description: "ثبت مشتری جدید. representative و list الزامی‌اند (قانون برنامه)؛ employer اختیاری است («none» = بدون کارفرما). اگر چیزی نامعلوم است از کاربر بپرس، حدس نزن.",
      params: [
        P("first_name", "string", "نام", true), P("last_name", "string", "نام خانوادگی"),
        P("passport_number", "string", "شماره پاسپورت"), P("birth_date", "string", "تاریخ تولد — میلادی یا شمسی"),
        P("representative", "string", "نام یا id نماینده", true), P("list", "string", "نام یا id لیست", true),
        P("employer", "string", "نام/id کارفرما یا none"), P("notes", "string", "یادداشت"),
        P("registration_date", "string", "تاریخ ثبت — میلادی یا شمسی (پیش‌فرض امروز)"),
      ],
      writes: true,
    },
    run: async (a) => {
      const repArg = str(a.representative);
      if (!repArg) return fail("نام نماینده داده نشده است", "از کاربر بپرس تحت کدام نماینده ثبت شود");
      const rep = await findRep(repArg);
      if (!rep) return fail("نماینده پیدا نشد", "از کاربر بپرس تحت کدام نماینده ثبت شود؛ فهرست: resolve_names(kind=representative)");
      const listArg = str(a.list);
      if (!listArg) return fail("نام لیست داده نشده است", "از کاربر بپرس داخل کدام لیست ثبت شود");
      const list = await findList(listArg);
      if (!list) return fail("لیست پیدا نشد", "از کاربر بپرس داخل کدام لیست ثبت شود؛ فهرست: resolve_names(kind=list)");
      const empRaw = str(a.employer);
      let employerId: string | null = null;
      if (empRaw && empRaw !== "none") {
        const emp = await findEmployer(empRaw);
        if (!emp) return fail(`کارفرما «${empRaw}» پیدا نشد`, "از کاربر بپرس؛ یا اول با create_employer بساز");
        employerId = emp.id;
      }
      const passport = str(a.passport_number);
      if (passport) {
        const dup = await findDuplicatePassport(passport);
        if (dup) return fail(`شماره پاسپورت تکراری — «${customerFullName(dup)}» از قبل ثبت است`, `به کاربر اطلاع بده و بپرس؛ id موجود: ${dup.id}`);
      }
      const created = await createCustomer({
        firstName: str(a.first_name), lastName: str(a.last_name),
        passportNo: passport, birthDate: isoDate(str(a.birth_date)),
        representativeId: rep.id, listId: list.id, employerId,
        notes: str(a.notes), registrationDate: isoDate(str(a.registration_date)) ?? todayIso(),
        customValues: {},
      });
      return ok({ id: created.id, name: customerFullName(created), representative: rep.name, list: list.name, employer: employerId ? (await findEmployer(employerId))?.name : "بدون کارفرما" }, `مشتری «${customerFullName(created)}» ثبت شد`);
    },
  });

  entries.push({
    def: {
      name: "update_customer",
      description: "ویرایش فیلدهای یک مشتری (فقط فیلدهایی که داده‌ای تغییر می‌کنند).",
      params: [
        P("id", "string", "id مشتری", true),
        P("employer", "string", "نام/id کارفرما یا none"), P("notes", "string", "یادداشت"),
        P("representative", "string", "نام/id نماینده"), P("list", "string", "نام/id لیست"),
        P("first_name", "string", "نام"), P("last_name", "string", "نام خانوادگی"), P("passport_number", "string", "شماره پاسپورت"),
      ],
      writes: true,
    },
    run: async (a) => {
      const id = str(a.id);
      const c = id ? await db.customers.get(id) : undefined;
      if (!c) return fail("مشتری پیدا نشد", "اول با get_customer/list_customers id درست را بگیر");
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (a.employer !== undefined) {
        const raw = str(a.employer);
        if (!raw || raw === "none") patch.employerId = null;
        else { const emp = await findEmployer(raw); if (!emp) return fail(`کارفرما «${raw}» پیدا نشد`); patch.employerId = emp.id; }
      }
      if (a.notes !== undefined) patch.notes = str(a.notes);
      if (a.representative !== undefined) { const rep = await findRep(str(a.representative) ?? ""); if (!rep) return fail("نماینده پیدا نشد"); patch.representativeId = rep.id; }
      if (a.list !== undefined) { const l = await findList(str(a.list) ?? ""); if (!l) return fail("لیست پیدا نشد"); patch.listId = l.id; }
      if (a.first_name !== undefined) patch.firstName = str(a.first_name) || undefined;
      if (a.last_name !== undefined) patch.lastName = str(a.last_name) || undefined;
      if (a.passport_number !== undefined) patch.passportNo = str(a.passport_number)?.toUpperCase() || undefined;
      await db.customers.update(c.id, patch);
      await logActivity({ type: "update", entity: "customer", entityId: c.id, title: `مشتری «${customerFullName(c)}» ویرایش شد`, detail: `توسط دستیار هوشمند — ${Object.keys(patch).filter((k) => k !== "updatedAt").join("، ")}` });
      return ok({ id: c.id, patched: Object.keys(patch).filter((k) => k !== "updatedAt") }, `${customerFullName(c)} به‌روز شد`);
    },
  });

  entries.push({
    def: { name: "check_duplicates", description: "بررسی تکراری بودن passport یا نام قبل از ثبت.", params: [P("passport", "string"), P("name", "string")], writes: false },
    run: async (a) => {
      const passport = str(a.passport);
      const name = str(a.name);
      const byPassport = passport ? await findDuplicatePassport(passport) : null;
      const byName = name ? await findCustomers(name) : [];
      return ok({
        passport_duplicate: byPassport ? { id: byPassport.id, name: customerFullName(byPassport), passport: byPassport.passportNo } : null,
        same_name: byName.slice(0, 6).map((c) => ({ id: c.id, name: customerFullName(c), passport: c.passportNo ?? "—" })),
      }, byPassport || byName.length > 0 ? "تکراری احتمالی هست" : "تکراری نیست");
    },
  });

  /* --------------------------------- employers --------------------------- */

  entries.push({
    def: { name: "list_employers", description: "کارفرمایان + تعداد مشتریان هر کدام.", params: [P("query", "string", "فیلتر نام")], writes: false },
    run: async (a) => {
      const emps = await allEmployers();
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt);
      const q = str(a.query);
      const rows = emps
        .filter((e) => !q || norm(e.name).includes(norm(q)))
        .map((e) => ({ id: e.id, name: e.name, phone: e.phone ?? "—", customers: customers.filter((c) => c.employerId === e.id).length }))
        .sort((x, y) => y.customers - x.customers);
      return ok({ employers: rows }, `${rows.length} کارفرما`);
    },
  });

  entries.push({
    def: { name: "get_employer", description: "کارفرما + همهٔ مشتریانش (پاسخ «چند مشتری کارفرمای X دارد»)", params: [P("selector", "string", "نام یا id", true)], writes: false },
    run: async (a) => {
      const q = str(a.selector) ?? "";
      const emp = await findEmployer(q);
      if (!emp) return fail(`کارفرما «${q}» پیدا نشد`, "فهرست: list_employers");
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt && c.employerId === emp.id);
      const reps = await allReps();
      return ok({
        id: emp.id, name: emp.name, phone: emp.phone ?? "—", notes: emp.notes ?? null,
        customers: customers.map((c) => ({
          id: c.id, name: customerFullName(c), passport: c.passportNo ?? "—",
          representative: reps.find((r) => r.id === c.representativeId)?.name ?? "—", registered: c.registrationDate,
        })),
      }, `کارفرما «${emp.name}» — ${customers.length} مشتری`);
    },
  });

  entries.push({
    def: { name: "create_employer", description: "ثبت کارفرمای جدید (قبل از ثبت، تکراری بودن نام چک می‌شود).", params: [P("name", "string", "نام", true), P("phone", "string"), P("notes", "string")], writes: true },
    run: async (a) => {
      const name = str(a.name);
      if (!name) return fail("نام لازم است");
      // Duplicate check against the live table (name, case/space-insensitive).
      const existing = (await allEmployers()).find((e) => norm(e.name) === norm(name));
      if (existing) return fail(`«${existing.name}» از قبل ثبت است`, `id موجود: ${existing.id}`);
      const emp = await createEmployer({ name, phone: str(a.phone), notes: str(a.notes) });
      return ok({ id: emp.id, name: emp.name }, `کارفرما «${emp.name}» ثبت شد`);
    },
  });

  /* ------------------------------ representatives ------------------------ */

  entries.push({
    def: { name: "list_representatives", description: "نمایندگان + آمار مشتری/درخواست.", params: [P("query", "string", "فیلتر نام")], writes: false },
    run: async (a) => {
      const reps = await allReps();
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt);
      const reqs = (await db.requests.toArray()).filter((r) => !r.archivedAt);
      const q = str(a.query);
      const rows = reps
        .filter((r) => !q || norm(r.name).includes(norm(q)))
        .map((r) => {
          const mine = customers.filter((c) => c.representativeId === r.id);
          const myReqs = reqs.filter((x) => x.representativeId === r.id);
          return { id: r.id, name: r.name, phone: r.phone ?? "—", customers: mine.length, requests: myReqs.length, issued: myReqs.filter((x) => x.issued).length };
        });
      return ok({ representatives: rows }, `${rows.length} نماینده`);
    },
  });

  entries.push({
    def: { name: "get_representative", description: "نماینده + مشتریانش + درخواست‌ها + مجموع پرداخت‌ها.", params: [P("selector", "string", "نام یا id", true)], writes: false },
    run: async (a) => {
      const q = str(a.selector) ?? "";
      const rep = await findRep(q);
      if (!rep) return fail(`نماینده «${q}» پیدا نشد`, "فهرست: list_representatives");
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt && c.representativeId === rep.id);
      const reqs = (await db.requests.toArray()).filter((r) => !r.archivedAt && r.representativeId === rep.id);
      const pays = (await db.payments.toArray()).filter((p) => p.representativeId === rep.id);
      const totals: Record<string, number> = {};
      for (const p of pays) totals[p.currency] = (totals[p.currency] ?? 0) + p.amount;
      return ok({
        id: rep.id, name: rep.name, phone: rep.phone ?? "—", notes: rep.notes ?? null,
        customers: customers.map((c) => ({ id: c.id, name: customerFullName(c), passport: c.passportNo ?? "—", registered: c.registrationDate, employer: c.employerId ? "دارد" : "بدون کارفرما" })),
        requests: { total: reqs.length, issued: reqs.filter((r) => r.issued).length, pending: reqs.filter((r) => !r.issued).length },
        payments_total: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, formatMoney(v, k as "IRT")])),
      }, `نماینده «${rep.name}» — ${customers.length} مشتری`);
    },
  });

  /* ---------------------------------- lists ------------------------------ */

  entries.push({
    def: { name: "list_lists", description: "لیست‌ها + تعداد مشتریان.", params: [], writes: false },
    run: async () => {
      const lists = await allLists();
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt);
      return ok({
        lists: lists.map((l) => ({ id: l.id, name: l.name, customers: customers.filter((c) => c.listId === l.id).length })),
      }, `${lists.length} لیست`);
    },
  });

  entries.push({
    def: { name: "get_list", description: "لیست + مشتریانش.", params: [P("selector", "string", "نام یا id", true)], writes: false },
    run: async (a) => {
      const l = await findList(str(a.selector) ?? "");
      if (!l) return fail("لیست پیدا نشد", "فهرست: list_lists");
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt && c.listId === l.id);
      const reps = await allReps();
      return ok({
        id: l.id, name: l.name, description: l.description ?? null,
        customers: customers.map((c) => ({ id: c.id, name: customerFullName(c), representative: reps.find((r) => r.id === c.representativeId)?.name ?? "—", registered: c.registrationDate })),
      }, `لیست «${l.name}» — ${customers.length} مشتری`);
    },
  });

  /* ------------------------------ visa requests -------------------------- */

  interface ReqFilter { status?: string; rep?: string; list?: string; emp?: string; cust?: string; vtype?: string; rfrom?: string; rto?: string; ifrom?: string; ito?: string }
  const reqFilterArgs: ToolParam[] = [
    P("status", "string", "pending | issued | all (پیش‌فرض all)", false, { enum: ["pending", "issued", "all"] }),
    ...customerFilterArgs.filter((p) => p.name === "representative" || p.name === "list" || p.name === "employer"),
    P("customer", "string", "نام/پاسپورت/id مشتری"),
    P("visa_type", "string", "نوع ویزا"),
    P("registered_from", "string", "از تاریخ ثبت — میلادی یا شمسی"), P("registered_to", "string", "تا تاریخ ثبت"),
    P("issued_from", "string", "از تاریخ صدور — میلادی یا شمسی"), P("issued_to", "string", "تا تاریخ صدور"),
  ];

  async function filterRequests(f: ReqFilter): Promise<{ reqs: import("../../types").VisaRequest[]; customers: Customer[] }> {
    const allC = (await db.customers.toArray()).filter((c) => !c.archivedAt);
    const custById = new Map(allC.map((c) => [c.id, c]));
    let reqs = (await db.requests.toArray()).filter((r) => !r.archivedAt);
    if (f.status === "issued") reqs = reqs.filter((r) => r.issued);
    else if (f.status === "pending") reqs = reqs.filter((r) => !r.issued);
    if (f.rep) { const rep = await findRep(f.rep); reqs = reqs.filter((r) => r.representativeId === (rep?.id ?? "__none__")); }
    if (f.list) { const l = await findList(f.list); reqs = reqs.filter((r) => r.listId === (l?.id ?? "__none__")); }
    if (f.cust) { const found = await findCustomers(f.cust); const ids = new Set(found.map((c) => c.id)); reqs = reqs.filter((r) => ids.has(r.customerId)); }
    if (f.vtype) { const vt = f.vtype; reqs = reqs.filter((r) => r.visaType && norm(r.visaType).includes(norm(vt))); }
    if (f.rfrom || f.rto) reqs = reqs.filter((r) => between(r.registrationDate, f.rfrom, f.rto));
    if (f.ifrom || f.ito) reqs = reqs.filter((r) => between(r.issuedAt, f.ifrom, f.ito));
    if (f.emp) {
      if (f.emp === "none") reqs = reqs.filter((r) => !custById.get(r.customerId)?.employerId);
      else { const e = await findEmployer(f.emp); reqs = reqs.filter((r) => (custById.get(r.customerId)?.employerId ?? null) === (e?.id ?? "__none__")); }
    }
    return { reqs, customers: allC };
  }

  function reqRow(r: import("../../types").VisaRequest, custById: Map<string, Customer>, reps: Representative[], lists: ListFolder[]) {
    const c = custById.get(r.customerId);
    return {
      id: r.id,
      customer: c ? customerFullName(c) : "—",
      passport: c?.passportNo ?? "—",
      representative: reps.find((x) => x.id === r.representativeId)?.name ?? "—",
      list: lists.find((x) => x.id === r.listId)?.name ?? "—",
      employer: c?.employerId ? "دارد" : "بدون کارفرما",
      visa_type: r.visaType ?? "—",
      status: r.issued ? "صادر شده" : "در حال کار",
      registered: r.registrationDate, registered_jalali: jdate(r.registrationDate),
      issued_at: r.issuedAt ?? null, issued_jalali: r.issuedAt ? jdate(r.issuedAt) : null,
      amount: r.quotedAmount != null ? formatMoney(r.quotedAmount, r.currency ?? "IRT") : null,
    };
  }

  entries.push({
    def: { name: "list_requests", description: "جستجو/فهرست درخواست‌های ویزا با هر ترکیب فیلتر (تاریخ ثبت، تاریخ صدور، وضعیت، نماینده، کارفرما، مشتری…).", params: [...reqFilterArgs, P("limit", "number"), P("offset", "number")], writes: false },
    run: async (a) => {
      const { reqs, customers } = await filterRequests({
        status: str(a.status), rep: str(a.representative), list: str(a.list), emp: str(a.employer),
        cust: str(a.customer), vtype: str(a.visa_type),
        rfrom: isoDate(str(a.registered_from)), rto: isoDate(str(a.registered_to)),
        ifrom: isoDate(str(a.issued_from)), ito: isoDate(str(a.issued_to)),
      });
      const custById = new Map(customers.map((c) => [c.id, c]));
      const reps = await allReps(); const lists = await allLists();
      const { limit, offset } = pageArgs(a);
      const page = reqs.slice(offset, offset + limit);
      return ok({
        total: reqs.length, issued: reqs.filter((r) => r.issued).length, pending: reqs.filter((r) => !r.issued).length,
        returned: page.length,
        requests: page.map((r) => reqRow(r, custById, reps, lists)),
      }, `${reqs.length.toLocaleString("fa-IR")} درخواست`);
    },
  });

  entries.push({
    def: { name: "count_requests", description: "فقط تعداد درخواست‌ها با فیلترها.", params: [...reqFilterArgs], writes: false },
    run: async (a) => {
      const { reqs } = await filterRequests({
        status: str(a.status), rep: str(a.representative), list: str(a.list), emp: str(a.employer),
        cust: str(a.customer), vtype: str(a.visa_type),
        rfrom: isoDate(str(a.registered_from)), rto: isoDate(str(a.registered_to)),
        ifrom: isoDate(str(a.issued_from)), ito: isoDate(str(a.issued_to)),
      });
      return ok({ total: reqs.length, issued: reqs.filter((r) => r.issued).length, pending: reqs.filter((r) => !r.issued).length }, `${reqs.length.toLocaleString("fa-IR")} درخواست`);
    },
  });

  entries.push({
    def: { name: "get_request", description: "جزئیات یک درخواست با id.", params: [P("id", "string", "id درخواست", true)], writes: false },
    run: async (a) => {
      const r = str(a.id) ? await db.requests.get(str(a.id)!) : undefined;
      if (!r) return fail("درخواست پیدا نشد");
      const customers = (await db.customers.toArray()).filter((c) => !c.archivedAt);
      const custById = new Map(customers.map((c) => [c.id, c]));
      const reps = await allReps(); const lists = await allLists();
      return ok(reqRow(r, custById, reps, lists), `درخواست ${r.visaType ?? ""}`);
    },
  });

  entries.push({
    def: {
      name: "create_request",
      description: "ثبت درخواست ویزا برای یک مشتری (ثبتِ «درخواست ویزا جدید»). نماینده/لیست پیش‌فرض از مشتری گرفته می‌شود.",
      params: [
        P("customer", "string", "id/نام/پاسپورت مشتری", true),
        P("visa_type", "string", "نوع ویزا"), P("quoted_amount", "number", "مبلغ توافقی"),
        P("currency", "string", "IRT | USD | AFN", false, { enum: ["IRT", "USD", "AFN"] }),
        P("representative", "string", "نام/id (پیش‌فرض: نمایندهٔ مشتری)"),
        P("list", "string", "نام/id (پیش‌فرض: لیست مشتری)"),
        P("notes", "string", "یادداشت"), P("registration_date", "string", "تاریخ ثبت — میلادی یا شمسی"),
        P("tags", "array", "نام برچسب‌ها", false, { items: { type: "string" } }),
      ],
      writes: true,
    },
    run: async (a) => {
      const q = str(a.customer) ?? "";
      const found = await findCustomers(q);
      if (found.length === 0) return fail(`مشتری «${q}» پیدا نشد`, "اول مشتری را با create_customer ثبت کن یا از کاربر بپرس");
      if (found.length > 1) return fail(`${found.length} هم‌نام پیدا شد`, "id دقیق را از کاربر بگیر؛ candidates: " + found.slice(0, 5).map((c) => `${customerFullName(c)} (${c.id})`).join("، "));
      const c = found[0];
      const repArg = str(a.representative);
      const repFinal = repArg ? await findRep(repArg) : (await allReps()).find((x) => x.id === c.representativeId);
      const listArg = str(a.list);
      const listFinal = listArg ? await findList(listArg) : (await allLists()).find((x) => x.id === c.listId);
      if (!repFinal) return fail("نماینده مشخص نیست", "از کاربر بپرس");
      if (!listFinal) return fail("لیست مشخص نیست", "از کاربر بپرس");
      const tagNames = strAll(a.tags) ?? [];
      const allTags = (await db.tags.toArray()).filter((t) => !t.archivedAt);
      const tagIds = tagNames.map((n) => allTags.find((t) => norm(t.name) === norm(n))?.id).filter((x): x is string => !!x);
      const created = await createRequest({
        customerId: c.id,
        representativeId: repFinal.id,
        listId: listFinal.id,
        visaType: str(a.visa_type),
        tags: tagIds,
        quotedAmount: num(a.quoted_amount),
        currency: (str(a.currency) as "IRT" | "USD" | "AFN" | undefined) ?? (num(a.quoted_amount) != null ? "IRT" : undefined),
        registrationDate: isoDate(str(a.registration_date)) ?? todayIso(),
        issued: false,
        issuedAt: null,
        notes: str(a.notes),
        customValues: {},
      });
      return ok({ id: created.id, customer: customerFullName(c), visa_type: created.visaType ?? "—", representative: repFinal.name, list: listFinal.name, amount: created.quotedAmount != null ? formatMoney(created.quotedAmount, created.currency ?? "IRT") : null }, `درخواست «${customerFullName(c)}» ثبت شد`);
    },
  });

  entries.push({
    def: { name: "set_request_issued", description: "علامت‌گذاری درخواست به «صادر شده» (یا برگرداندن آن با undo=true).", params: [P("request", "string", "id درخواست", true), P("issued_date", "string", "تاریخ صدور — میلادی یا شمسی (پیش‌فرض امروز)"), P("undo", "boolean", "برگشت به در حال کار")], writes: true },
    run: async (a) => {
      const id = str(a.request);
      const r = id ? await db.requests.get(id) : undefined;
      if (!r) return fail("درخواست پیدا نشد", "با list_requests id را بگیر");
      const undo = bool(a.undo) ?? false;
      await setRequestIssued(r.id, !undo, isoDate(str(a.issued_date)) ?? todayIso());
      return ok({ id: r.id, status: undo ? "در حال کار" : "صادر شده", issued_at: undo ? null : isoDate(str(a.issued_date)) ?? todayIso() }, undo ? "برگشت به در حال کار" : "صادر شد ✅");
    },
  });

  /* --------------------------------- payments ---------------------------- */

  entries.push({
    def: { name: "list_payments", description: "پرداخت‌های نمایندگان + مجموع هر ارز.", params: [P("representative", "string"), P("from", "string", "از تاریخ — میلادی یا شمسی"), P("to", "string", "تا تاریخ — میلادی یا شمسی"), P("currency", "string", "IRT | USD | AFN", false, { enum: ["IRT", "USD", "AFN"] }), P("limit", "number")], writes: false },
    run: async (a) => {
      const reps = await allReps();
      let pays = await db.payments.toArray();
      if (a.representative !== undefined) { const rep = await findRep(str(a.representative) ?? ""); pays = pays.filter((p) => p.representativeId === (rep?.id ?? "__none__")); }
      const cur = str(a.currency);
      if (cur) pays = pays.filter((p) => p.currency === cur);
      pays = pays.filter((p) => between(p.date, isoDate(str(a.from)), isoDate(str(a.to))));
      const totals: Record<string, number> = {};
      for (const p of pays) totals[p.currency] = (totals[p.currency] ?? 0) + p.amount;
      const { limit } = pageArgs(a);
      return ok({
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, formatMoney(v, k as "IRT")])),
        payments: pays.slice(-limit).reverse().map((p) => ({
          representative: reps.find((r) => r.id === p.representativeId)?.name ?? "—",
          amount: formatMoney(p.amount, p.currency), date: p.date, date_jalali: jdate(p.date), description: p.description ?? null,
        })),
      }, `${pays.length} پرداخت`);
    },
  });

  entries.push({
    def: { name: "create_payment", description: "ثبت پرداخت جدید (به نام یک نماینده).", params: [P("representative", "string", "نام/id نماینده", true), P("amount", "number", "مبلغ (واحد اصلی)", true), P("currency", "string", "IRT | USD | AFN", true, { enum: ["IRT", "USD", "AFN"] }), P("date", "string", "yyyy-mm-dd"), P("description", "string"), P("request", "string", "id درخواست مرتبط")], writes: true },
    run: async (a) => {
      const rep = await findRep(str(a.representative) ?? "");
      if (!rep) return fail("نماینده پیدا نشد", "از کاربر بپرس به نام کدام نماینده");
      const amount = num(a.amount);
      const cur = str(a.currency);
      if (amount == null || amount <= 0) return fail("مبلغ نامعتبر است", "از کاربر بپرس");
      if (cur !== "IRT" && cur !== "USD" && cur !== "AFN") return fail("ارز باید IRT/USD/AFN باشد");
      const p = await createPayment({
        representativeId: rep.id,
        requestId: str(a.request) ?? null,
        amount, currency: cur,
        date: isoDate(str(a.date)) ?? todayIso(),
        description: str(a.description),
      });
      return ok({ id: p.id, representative: rep.name, amount: formatMoney(p.amount, p.currency), date: p.date }, `پرداخت ${formatMoney(p.amount, p.currency)} ثبت شد`);
    },
  });

  /* -------------------------------- documents ---------------------------- */

  entries.push({
    def: { name: "list_documents", description: "مدارک ثبت‌شدهٔ یک مشتری (بخش‌ها + تعداد).", params: [P("customer", "string", "id/نام/پاسپورت", true)], writes: false },
    run: async (a) => {
      const found = await findCustomers(str(a.customer) ?? "");
      if (found.length === 0) return fail("مشتری پیدا نشد");
      if (found.length > 1) return fail(`${found.length} هم‌نام`, "id دقیق بگیر");
      const c = found[0];
      const docs = (await getAttachmentsFor(c.id)).filter((d) => !d.paymentId);
      const dts = (await db.docTypes.toArray()).filter((d) => !d.archivedAt);
      const labelOf = (kind: string) => dts.find((d) => d.id === kind)?.label ?? (kind === "other" ? "سایر" : kind);
      const byKind: Record<string, string[]> = {};
      for (const d of docs) (byKind[labelOf(d.kind)] ??= []).push(d.name);
      return ok({
        customer: customerFullName(c), has_profile_photo: !!c.photo,
        documents: byKind,
      }, `${docs.length} مدرک`);
    },
  });

  entries.push({
    def: { name: "view_document", description: "دیدن خودِ مدرک/عکس یک مشتری — تصویر به تو نشان داده می‌شود (مثلاً برای خواندن اطلاعات یا بررسی).", params: [P("customer", "string", "id/نام/پاسپورت", true), P("kind", "string", "بخش مدرک مثل پاسپورت/پشت تذکره/سایر — اختیاری")], writes: false },
    run: async (a) => {
      const found = await findCustomers(str(a.customer) ?? "");
      if (found.length === 0) return fail("مشتری پیدا نشد");
      if (found.length > 1) return fail(`${found.length} هم‌نام`, "id دقیق بگیر");
      const c = found[0];
      const docs = (await getAttachmentsFor(c.id)).filter((d) => !d.paymentId && d.mime.startsWith("image/"));
      if (docs.length === 0) return fail("این مشتری مدرک تصویری ندارد");
      const dts = (await db.docTypes.toArray()).filter((d) => !d.archivedAt);
      const labelOf = (kind: string) => dts.find((d) => d.id === kind)?.label ?? (kind === "other" ? "سایر" : kind);
      let chosen = docs[0];
      const kind = str(a.kind);
      if (kind) {
        const hit = docs.find((d) => norm(labelOf(d.kind)) === norm(kind) || norm(d.kind) === norm(kind))
          ?? docs.find((d) => norm(labelOf(d.kind)).includes(norm(kind)));
        const sections = [...new Set(docs.map((d) => labelOf(d.kind)))];
        if (!hit) return fail(`بخش «${kind}» پیدا نشد`, `بخش‌های موجود: ${sections.join("، ")}`);
        chosen = hit;
      }
      const image = await blobForVision(chosen.blob);
      return ok({ customer: customerFullName(c), kind: labelOf(chosen.kind), name: chosen.name, size_kb: Math.round(chosen.size / 1024) }, `تصویر «${labelOf(chosen.kind)}» — حالا می‌بینی`, { image });
    },
  });

  entries.push({
    def: {
      name: "download_documents",
      description: "دانلود ZIP مدارک مشتریان — گروه‌بندی به‌صورت نماینده/مشتری و نام‌گذاری فایل‌ها به نام خود شخص. customer_ids را از قبل با ابزارهای جستجو بگیر.",
      params: [P("customer_ids", "array", "آرایه‌ای از id مشتریان", true, { items: { type: "string" } })],
      writes: true,
    },
    run: async (a) => {
      const ids = Array.isArray(a.customer_ids) ? a.customer_ids.filter((x): x is string => typeof x === "string") : [];
      if (ids.length === 0) return fail("customer_ids خالی است", "اول با list_customers id ها را بگیر");
      const all = await db.customers.bulkGet(ids);
      const found = all.filter((c): c is Customer => !!c);
      if (found.length === 0) return fail("هیچ مشتری معتبری پیدا نشد");
      const reps = await allReps();
      const dts = (await db.docTypes.toArray()).filter((d) => !d.archivedAt);
      const labelOf = (kind: string) => dts.find((d) => d.id === kind)?.label ?? (kind === "other" ? "سایر" : kind === "receipt" ? "رسید" : kind);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let files = 0;
      const usedNames = new Set<string>();
      const seen = new Map<string, number>();
      for (const c of found) {
        const docs = (await getAttachmentsFor(c.id)).filter((d) => !d.paymentId && d.mime.startsWith("image/"));
        const rep = reps.find((r) => r.id === c.representativeId);
        const repDir = rep ? rep.name.replace(/[\\/:*?"<>|]/g, "-") : "بدون نماینده";
        const base = customerFullName(c).replace(/[\\/:*?"<>|]/g, "-");
        const idx = (seen.get(base) ?? 0) + 1;
        seen.set(base, idx);
        const custDir = `${repDir}/${base}${seen.get(base)! > 1 ? `-${idx}` : ""}`;
        const perKind = new Map<string, number>();
        for (const d of docs) {
          const n = (perKind.get(d.kind) ?? 0) + 1;
          perKind.set(d.kind, n);
          const label = labelOf(d.kind);
          const name = `${custDir}/${label}${n > 1 ? `-${n}` : ""}.jpg`;
          let candidate = name;
          let k = 2;
          while (usedNames.has(candidate)) candidate = name.replace(/\.jpg$/, `-${k++}.jpg`);
          usedNames.add(candidate);
          zip.file(candidate, d.blob);
          files++;
        }
      }
      if (files === 0) return fail("این مشتریان مدرک تصویری ندارند");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const zipName = `مدارک مشتریان - ${todayIso()}.zip`;
      downloadBlob(blob, zipName);
      return ok({ customers: found.length, files, zip_name: zipName, structure: "نماینده/مشتری/بخش-مدرک.jpg" }, `ZIP با ${files} فایل ساخته و دانلود شد`);
    },
  });

  /* -------------------------------- accounting --------------------------- */

  entries.push({
    def: { name: "acc_summary", description: "خلاصهٔ بخش حسابداری: مانده حساب‌ها، مجموع نقدی هر ارز، تعداد مطالبات/بدهی.", params: [], writes: false },
    run: async () => {
      const accounts = await db.accAccounts.toArray();
      const txs = await db.accTransactions.toArray();
      const balances = computeAllAccountBalances(accounts, txs);
      const cash = totalCashBalances(accounts, txs);
      const outstanding = await db.accOutstanding.toArray();
      const parties = await db.accParties.count();
      return ok({
        accounts: accounts.map((acc) => ({
          name: acc.name, type: acc.type, currency: acc.currency, active: acc.active,
          balance: formatMoney(balances.get(acc.id)?.balance ?? 0, acc.currency),
        })),
        cash_totals: Object.fromEntries(Object.entries(cash).map(([k, v]) => [k, formatMoney(v, k as "IRT")])),
        outstanding: {
          count: outstanding.length,
          open: outstanding.filter((o) => o.status === "open").length,
          settled: outstanding.filter((o) => o.status === "settled").length,
        },
        parties,
      }, "خلاصهٔ حسابداری");
    },
  });

  entries.push({
    def: { name: "list_acc_transactions", description: "تراکنش‌های حسابداری با فیلتر.", params: [P("party", "string", "نام/کد طرف‌حساب"), P("type", "string", "نوع تراکنش"), P("status", "string", "وضعیت"), P("from", "string", "از تاریخ — میلادی یا شمسی"), P("to", "string", "تا تاریخ — میلادی یا شمسی"), P("limit", "number")], writes: false },
    run: async (a) => {
      let txs: FinTransaction[] = await db.accTransactions.toArray();
      if (a.party !== undefined) {
        const parties = await db.accParties.toArray();
        const q = norm(str(a.party) ?? "");
        const p = parties.find((x) => x.id === str(a.party)) ?? parties.find((x) => norm(x.name).includes(q) || norm(x.code) === q);
        txs = txs.filter((t) => t.partyId === (p?.id ?? "__none__"));
      }
      const type = str(a.type);
      if (type) txs = txs.filter((t) => norm(t.type).includes(norm(type)));
      const status = str(a.status);
      if (status) txs = txs.filter((t) => norm(t.status).includes(norm(status)));
      txs = txs.filter((t) => between(t.date, isoDate(str(a.from)), isoDate(str(a.to))));
      const parties = await db.accParties.toArray();
      const { limit } = pageArgs(a);
      const page = txs.slice(-limit).reverse();
      return ok({
        total: txs.length,
        transactions: page.map((t) => ({
          number: t.number, date: t.date, date_jalali: jdate(t.date), type: t.type,
          party: parties.find((p) => p.id === t.partyId)?.name ?? "—",
          amount: formatMoney(t.amount, t.currency), description: t.description ?? null, status: t.status,
        })),
      }, `${txs.length} تراکنش`);
    },
  });

  entries.push({
    def: { name: "get_acc_party", description: "طرف‌حساب حسابداری + مجموع‌ها + تراکنش‌های اخیر.", params: [P("selector", "string", "نام/کد/id", true)], writes: false },
    run: async (a) => {
      const q = str(a.selector) ?? "";
      const parties = await db.accParties.toArray();
      const p = parties.find((x) => x.id === q || norm(x.code) === norm(q)) ?? parties.find((x) => norm(x.name).includes(norm(q)));
      if (!p) return fail(`طرف‌حساب «${q}» پیدا نشد`);
      const txs = (await db.accTransactions.toArray()).filter((t) => t.partyId === p.id);
      const totals = computePartyTotals(p.id, await db.accTransactions.toArray());
      const outstanding = (await db.accOutstanding.toArray()).filter((o) => o.partyId === p.id);
      return ok({
        id: p.id, code: p.code, name: p.name, type: p.type, phone: p.phone ?? "—",
        totals,
        outstanding: outstanding.map((o) => ({ kind: o.kind, amount: formatMoney(o.amount, o.currency), status: o.status, due: o.dueDate ?? null })),
        recent: txs.slice(-8).reverse().map((t) => ({ number: t.number, date: t.date, type: t.type, amount: formatMoney(t.amount, t.currency), status: t.status })),
      }, `طرف‌حساب «${p.name}»`);
    },
  });

  /* ------------------------------- ai & system --------------------------- */

  entries.push({
    def: { name: "test_ai_workers", description: "تست موازی همهٔ اکانت‌های هوش مصنوعی — کدام‌ها سالم‌اند، چه تأخیری دارند، خطای هر کدام چیست (کلید/آدرس هرگز فاش نمی‌شود).", params: [], writes: false },
    run: async () => {
      const workers: AiWorkerType[] = await db.aiWorkers.toArray();
      if (workers.length === 0) return fail("هیچ ورکری ثبت نشده است", "تنظیمات ← هوش مصنوعی");
      const results = await Promise.all(
        workers.map(async (w) => {
          const r = await testWorker(w);
          return { label: w.label || w.url, enabled: w.enabled, ok: r.ok, ms: r.ms, error: r.ok ? undefined : r.error };
        }),
      );
      const healthy = results.filter((r) => r.ok).length;
      return ok({ workers: results }, `${healthy} از ${results.length} سالم`);
    },
  });

  entries.push({
    def: { name: "set_theme", description: "تغییر تم برنامه بین روشن و تیره.", params: [P("theme", "string", "light | dark", true, { enum: ["light", "dark"] })], writes: true },
    run: async (a) => {
      const t = str(a.theme);
      if (t !== "light" && t !== "dark") return fail("theme باید light یا dark باشد");
      setThemeGlobal(t);
      return ok({ theme: t }, t === "dark" ? "تم تیره شد 🌙" : "تم روشن شد ☀️");
    },
  });

  entries.push({
    def: { name: "navigate", description: "بردن کاربر به یک صفحهٔ برنامه (مثلاً گزارش‌ها یا پروفایل مشتری).", params: [P("to", "string", "مسیر داخلی مثل /reports", true)], writes: true },
    run: async (a) => {
      const to = str(a.to);
      if (!to || !to.startsWith("/") || to.startsWith("//") || to.includes(":")) return fail("مسیر نامعتبر است", "مثل /reports یا /customers/<id>");
      ctx.navigate(to);
      return ok({ to }, `صفحهٔ ${to} باز شد`);
    },
  });

  /* --------------------------------- execute ----------------------------- */

  /** "countcustomers" ≡ "count_customers" ≡ "Count Customers" */
  const normKey = (s: string): string => s.toLowerCase().replace(/[\s_\-.]/g, "");
  const byExact = new Map(entries.map((e) => [e.def.name, e] as const));
  const byNorm = new Map(entries.map((e) => [normKey(e.def.name), e] as const));

  async function execute(call: ToolCallRequest): Promise<ToolCallResult> {
    const started = performance.now();
    const nk = normKey(call.name);
    // exact → separator-insensitive → substring (either direction, ≥4 chars)
    let entry = byExact.get(call.name) ?? byNorm.get(nk);
    if (!entry && nk.length >= 4) {
      entry = entries.find((e) => {
        const en = normKey(e.def.name);
        return (en.includes(nk) || nk.includes(en)) && en.length >= 3;
      });
    }
    let res: ToolCallResult;
    if (!entry) {
      // Helpful hint: closest real tool names (share a ≥4-char prefix chunk)
      const stem = nk.slice(0, 4);
      const close = [...byNorm.keys()]
        .filter((n) => n.includes(stem) || nk.includes(n.slice(0, 4)))
        .slice(0, 6);
      res = fail(
        `ابزار «${call.name}» وجود ندارد`,
        close.length > 0
          ? `شاید منظورت این‌ها بود: ${close.map((n) => byNorm.get(n)!.def.name).join("، ")} — نام دقیق را از فهرست ابزارهای سیستم‌پرامپت با زیرخط (_) کپی کن`
          : "نام دقیق را از فهرست ابزارهای سیستم‌پرامپت با زیرخط (_) کپی کن",
      );
    } else {
      try {
        res = await entry.run(call.args ?? {});
      } catch (e) {
        res = fail(e instanceof Error ? e.message : String(e));
      }
    }
    // Report the CANONICAL name back so the model self-corrects next round.
    return { ...res, id: call.id, name: entry ? entry.def.name : call.name, ms: Math.round(performance.now() - started) };
  }

  return { tools: entries.map((e) => e.def), execute };
}

