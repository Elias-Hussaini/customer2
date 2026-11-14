/**
 * Browser QA — Round 24 (user rule):
 *   «وقتی مشتری جدید ثبت می‌کنم می‌رود در مرحلهٔ ثبت ویزا — باید از مرحلهٔ اول
 *    شروع بشه؛ قبلی‌ها دست نخورند.»
 *
 * Verifies in the REAL UI:
 *   1. Registering a new customer (simultaneous visa request ON, code empty)
 *      → customer starts at «مرحله اول» (stage1), request row exists (pending).
 *   2. New customer WITH the کد اختصاصی filled in the same form
 *      → «دارای کد اختصاصی» (stage3) + green tick.
 *   3. EVERY already-registered customer stays byte-identical
 *      (stage + updatedAt untouched), incl. a legacy null-stage row.
 *   4. A SEPARATE request created later (request form page) still advances
 *      that customer to «ثبت شده برای ویزا» (legacy rule intact where it belongs).
 *   5. New hint text renders in the form; zero console errors; mobile 390px.
 *
 * Runs against `vite dev` (no /customer2 base in dev).
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  if (navigator.serviceWorker) {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }
  for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name);
});
await page.reload({ waitUntil: "networkidle" });

/* -------------------------------- helpers -------------------------------- */

const dbEval = (fn, arg) => page.evaluate(fn, arg);

/** Click an option inside the OPEN floating panel (never the page behind). */
const pickFromPanel = (text) =>
  page.locator(`[data-floating-panel] button:has-text("${text}")`).first().click();

/**
 * Open a SearchSelect by its placeholder trigger and pick an option.
 * No-op when the field is already prefilled (remembered last selection).
 * Returns true when a pick happened.
 */
async function fillSelectIfEmpty(triggerText, pickText) {
  const trig = page.locator(`button:has-text("${triggerText}")`).first();
  if ((await trig.count()) === 0) return false;
  await trig.click();
  await page.waitForTimeout(250); // panel entrance animation
  await pickFromPanel(pickText);
  return true;
}

const dumpCustomers = () =>
  dbEval(async () => {
    const { db } = await import("/src/db/schema.ts");
    const all = await db.customers.toArray();
    return all.map((c) => ({ id: c.id, stage: c.stage ?? null, updatedAt: c.updatedAt }));
  });

const customerByPassport = (pp) =>
  dbEval(async (pp) => {
    const { db } = await import("/src/db/schema.ts");
    const all = await db.customers.toArray();
    return all.find((c) => c.passportNo === pp) ?? null;
  }, pp);

const stageOf = (id) =>
  dbEval(async (id) => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.customers.get(id))?.stage ?? null;
  }, id);

/** Poll until the customer reaches the expected stage (max ~6s). */
async function waitStage(id, expected) {
  for (let i = 0; i < 30; i++) {
    if ((await stageOf(id)) === expected) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Open the new-customer modal; fill rep/list (prefill-tolerant). */
async function openNewCustomerForm() {
  await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
  await page.waitForSelector("table");
  await page.getByRole("button", { name: "مشتری جدید" }).first().click();
  await page.waitForSelector("text=ثبت همزمان درخواست ویزا");
  const repName = await dbEval(async () => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.representatives.toArray())[0]?.name ?? "";
  });
  const listName = await dbEval(async () => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.lists.toArray())[0]?.name ?? "";
  });
  await fillSelectIfEmpty("انتخاب نماینده…", repName);
  await fillSelectIfEmpty("انتخاب لیست…", listName);
}

/** Pick a visa type (prefill-tolerant); creates one through the UI when none exists. */
async function ensureVisaType() {
  const existing = await dbEval(async () => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.visaTypes.toArray()).map((v) => v.name);
  });
  if (existing.length > 0) {
    const picked = await fillSelectIfEmpty("انتخاب یا ساخت…", existing[0]);
    return { vt: existing[0], picked };
  }
  const trig = page.locator('button:has-text("انتخاب یا ساخت…")').first();
  if ((await trig.count()) === 0) return { vt: "ویزای آزمون", picked: false };
  await trig.click();
  await page.waitForTimeout(250);
  await page.locator('[data-floating-panel] input[placeholder="جستجو…"]').fill("ویزای آزمون");
  await page.locator('[data-floating-panel] button:has-text("ایجاد و ثبت")').first().click();
  await page.waitForTimeout(400); // createVisaType is async inside onCreate
  return { vt: "ویزای آزمون", picked: true };
}

/* --------------------- 0. seed + "already registered" rows ------------------ */

await dbEval(async () => {
  const { seedDemoData } = await import("/src/db/seed.ts");
  await seedDemoData();
});
// Force one seeded customer to a legacy NULL stage — like data from before the
// feature (or restored old backup). It must stay null: nothing may rewrite it.
const legacyId = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  const first = (await db.customers.toArray())[0];
  await db.customers.update(first.id, { stage: null, updatedAt: 111 });
  return first.id;
});

const BEFORE = await dumpCustomers();
ok("seed: already-registered customers exist", BEFORE.length >= 4, `n=${BEFORE.length}`);
ok(
  "seed: a stage4 «ثبت شده برای ویزا» row exists (previously registered)",
  BEFORE.some((c) => c.stage === "stage4"),
);
const legacyRow = BEFORE.find((c) => c.id === legacyId);
ok("seed: legacy null-stage row prepared", legacyRow?.stage === null && legacyRow?.updatedAt === 111);

/* -------------------- 1. register a NEW customer (main case) ---------------- */

await openNewCustomerForm();

// The new hint must render while the modal is open.
ok(
  "form hint: «مرحلهٔ مشتری از «مرحله اول» شروع می‌شود» renders",
  (await page.locator('text=مرحلهٔ مشتری از «مرحله اول» شروع می‌شود').count()) === 1,
);
// Toggle defaults ON (the switch inside the simultaneous-request card).
const switchState = await page
  .locator('p:has-text("ثبت همزمان درخواست ویزا")')
  .locator("xpath=ancestor::div[2]")
  .getByRole("switch")
  .first()
  .getAttribute("aria-checked");
ok("simultaneous-request toggle defaults ON", switchState === "true", `aria=${switchState}`);

await page.getByPlaceholder("مثلاً زهرا").fill("رضا");
await page.getByPlaceholder("مثلاً موسوی").fill("آزمون");
await page.getByPlaceholder("A12345678").fill("PA249901");
const { vt } = await ensureVisaType();
await page.getByRole("button", { name: "ثبت مشتری" }).click();
await page.waitForSelector('text=ثبت همزمان', { state: "detached" });

const reza = await customerByPassport("PA249901");
ok("new customer row created", !!reza, `id=${reza?.id}`);
ok(
  "NEW customer (no code) starts at «مرحله اول» (stage1) — request did NOT push to ثبت ویزا",
  reza?.stage === "stage1",
  `stage=${reza?.stage}`,
);
const rezaRequest = await dbEval(async (id) => {
  const { db } = await import("/src/db/schema.ts");
  const rs = await db.requests.where("customerId").equals(id).toArray();
  return rs.map((r) => ({ visaType: r.visaType ?? null, issued: r.issued }));
}, reza.id);
ok(
  "the simultaneous request itself exists (pending) — bookkeeping intact",
  rezaRequest.length === 1 && rezaRequest[0].issued === false && !!rezaRequest[0].visaType,
  JSON.stringify(rezaRequest),
);

/* ------------------ 2. new customer WITH کد اختصاصی in the form -------------- */

await openNewCustomerForm();
await page.getByPlaceholder("مثلاً زهرا").fill("سارا");
await page.getByPlaceholder("مثلاً موسوی").fill("کدی");
await page.getByPlaceholder("A12345678").fill("PA249902");
await page.getByPlaceholder("کد اختصاصی مشتری (اختیاری)").fill("KA-24");
await ensureVisaType();
await page.getByRole("button", { name: "ثبت مشتری" }).click();
await page.waitForSelector('text=ثبت همزمان', { state: "detached" });

const sara = await customerByPassport("PA249902");
ok(
  "NEW customer with کد اختصاصی in the same form → «دارای کد اختصاصی» (stage3)",
  sara?.stage === "stage3",
  `stage=${sara?.stage}`,
);

/* ------------------------ 3. previously registered untouched ---------------- */

const AFTER = await dumpCustomers();
const beforeMap = new Map(BEFORE.map((c) => [c.id, c]));
// Only rows that already existed may never change; the two new ones are expected.
const changed = AFTER.filter((c) => {
  const b = beforeMap.get(c.id);
  return b != null && (b.stage !== (c.stage ?? null) || b.updatedAt !== c.updatedAt);
});
const missing = BEFORE.filter((b) => !AFTER.find((c) => c.id === b.id));
ok(
  "already-registered customers: stage + updatedAt byte-identical (nothing rewritten)",
  changed.length === 0 && missing.length === 0 && AFTER.length === BEFORE.length + 2,
  changed.length === 0 ? `n=${AFTER.length}` : `changed=${JSON.stringify(changed)}`,
);
const legacyAfter = AFTER.find((c) => c.id === legacyId);
ok(
  "legacy null-stage row still null + updatedAt untouched",
  legacyAfter?.stage === null && legacyAfter?.updatedAt === 111,
  `stage=${legacyAfter?.stage}@${legacyAfter?.updatedAt}`,
);

/* ------------------------------ 4. UI rendering ------------------------------ */

await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await page.waitForSelector("table");
const rezaRow = page.locator("tr", { hasText: "رضا آزمون" });
const saraRow = page.locator("tr", { hasText: "سارا کدی" });
ok(
  "list: رضا آزمون shows the «مرحله اول» pill",
  (await rezaRow.locator("text=مرحله اول").count()) === 1,
);
ok(
  "list: سارا کدی shows «دارای کد اختصاصی» + the green tick",
  (await saraRow.locator("text=دارای کد اختصاصی").count()) === 1 &&
    (await saraRow.locator("svg.lucide-badge-check").count()) >= 1,
);
ok(
  "list: a previously-registered row still shows «ثبت شده برای ویزا»",
  (await page.locator("tbody").locator("text=ثبت شده برای ویزا").count()) >= 1,
);
await page.screenshot({ path: "/home/z/my-project/qa/round24/list-after.png", fullPage: false });

/* ------------- 5. SEPARATE request later → still advances (legacy) ---------- */

const repName2 = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  return (await db.representatives.toArray())[0]?.name ?? "";
});
const listName2 = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  return (await db.lists.toArray())[0]?.name ?? "";
});
await page.goto(`${BASE}/requests/new`, { waitUntil: "networkidle" });
await page.locator('button:has-text("جستجوی نام یا شماره پاسپورت…")').first().click();
await page.waitForTimeout(250);
await page.locator('[data-floating-panel] input[placeholder="جستجو…"]').fill("PA249901");
await pickFromPanel("رضا آزمون");
await fillSelectIfEmpty("انتخاب نماینده…", repName2);
await fillSelectIfEmpty("انتخاب لیست…", listName2);
await fillSelectIfEmpty("انتخاب یا ساخت…", vt);
await page.getByRole("button", { name: "ذخیره" }).first().click();
// Poll-based: a SECOND request row appears for رضا (no URL-shape reliance).
let second = false;
for (let i = 0; i < 30; i++) {
  const cnt = await dbEval(async (id) => {
    const { db } = await import("/src/db/schema.ts");
    return await db.requests.where("customerId").equals(id).count();
  }, reza.id);
  if (cnt >= 2) {
    second = true;
    break;
  }
  await page.waitForTimeout(200);
}
ok("SEPARATE request created (2nd row for رضا)", second);
ok(
  "SEPARATE request (request form) still advances رضا to «ثبت شده برای ویزا»",
  await waitStage(reza.id, "stage4"),
  `stage=${await stageOf(reza.id)}`,
);

/* ------------------------------ 6. hygiene ---------------------------------- */

ok("zero console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
ok("mobile 390px: no horizontal overflow", overflow === 0, `Δ=${overflow}px`);
await page.screenshot({ path: "/home/z/my-project/qa/round24/mobile.png" });

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\nROUND 24 QA: ${results.length - failed.length}/${results.length} PASS`);
if (errors.length > 0) console.log("CONSOLE ERRORS:", errors);
process.exit(failed.length === 0 ? 0 : 1);
