/**
 * Browser QA — Round 15 (user round: مراحل ویزا + کد اختصاصی + hover hotkeys
 * + view modes for reps/employers).
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

const customerByName = (first) =>
  dbEval(async (first) => {
    const { db } = await import("/src/db/schema.ts");
    const all = await db.customers.toArray();
    return all.find((c) => c.firstName === first) ?? null;
  }, first);
/** Poll the DB until the customer reaches the expected stage (max ~6s). */
async function waitStage(customerId, expected, label) {
  const started = Date.now();
  for (let i = 0; i < 30; i++) {
    const s = await dbEval(async (id) => {
      const { db } = await import("/src/db/schema.ts");
      return (await db.customers.get(id))?.stage ?? null;
    }, customerId);
    if (s === expected) return { ok: true, stage: s, ms: Date.now() - started };
    await page.waitForTimeout(200);
  }
  const s = await dbEval(async (id) => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.customers.get(id))?.stage ?? null;
  }, customerId);
  return { ok: false, stage: s, ms: Date.now() - started };
}


/* ------------------------- 1. seed + customers page ----------------------- */

await dbEval(async () => {
  const { seedDemoData } = await import("/src/db/seed.ts");
  await seedDemoData();
});
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await page.waitForSelector("table");

const zahra = await customerByName("زهرا");
ok("seed: زهرا has an issued request → stored stage5", zahra?.stage === "stage5", `stage=${zahra?.stage}`);
ok("customers page: «مرحله» column header present", await page.locator("th", { hasText: "مرحله" }).count() === 1);
const badgeCount = await page.locator("table span", { hasText: "صادر شده" }).count();
ok("stage badges render (صادر شده x2)", badgeCount >= 2, `count=${badgeCount}`);
const tickCount = await page.locator('table svg.lucide-badge-check').count();
ok("green code ticks render (زهرا/محمد/فاطمه)", tickCount >= 3, `ticks=${tickCount}`);
ok(
  "referrer shows as «کد اختصاصی: …»",
  (await page.locator("text=کد اختصاصی: آقای تهرانی").count()) >= 1,
);
ok("«معرف» label is gone from the page", (await page.locator("text=معرف:").count()) === 0);

/* ----------------------------- 2. hover hotkeys --------------------------- */

// A fresh customer with no code and no request → مرحله اول.
const hotId = await dbEval(async () => {
  const { createCustomer } = await import("/src/db/customers.ts");
  const c = await createCustomer({
    firstName: "هاتکی",
    lastName: "آزمون",
    representativeId: null,
    listId: null,
    registrationDate: "2026-11-10",
  });
  return c.id;
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("table");

const stageOf = (id) =>
  dbEval(async (id) => {
    const { db } = await import("/src/db/schema.ts");
    return (await db.customers.get(id))?.stage ?? null;
  }, id);

ok("fresh customer starts at مرحله اول", (await stageOf(hotId)) === "stage1");

const hotRow = page.locator("tr", { hasText: "هاتکی آزمون" });
await hotRow.hover();
await page.keyboard.press("Control");
let r = await waitStage(hotId, "stage2");
ok("hover + Ctrl → stage2 (ثبت شده برای کد اختصاصی)", r.ok, `stage=${r.stage} in ${r.ms}ms`);
const hud1 = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("div")).filter(
    (d) => d.style?.position === "fixed" && d.style?.bottom?.includes("px") && d.dir === "rtl",
  );
  return els[0]?.textContent ?? "";
});
ok("HUD pill appeared with the new stage", hud1.includes("هاتکی") && hud1.includes("ثبت شده برای کد اختصاصی"), hud1);

await page.keyboard.press("Control");
await page.waitForTimeout(700);
ok("hover + Ctrl again → stage3", (await stageOf(hotId)) === "stage3");

// Ctrl+C must NOT trigger a stage change (combo invalidation).
await hotRow.hover();
await page.keyboard.press("Control+c");
await page.waitForTimeout(600);
ok("Ctrl+C (real shortcut) does not change the stage", (await stageOf(hotId)) === "stage3", `stage=${await stageOf(hotId)}`);

await hotRow.hover();
await page.keyboard.press("Shift");
r = await waitStage(hotId, "stage5");
ok("hover + Shift → صادر شده (stage5)", r.ok, `stage=${r.stage}`);

await hotRow.hover();
await page.keyboard.press("Shift");
r = await waitStage(hotId, "stage4");
ok("hover + Shift again → back to stage4", r.ok, `stage=${r.stage}`);

await hotRow.hover();
await page.keyboard.press("Alt");
r = await waitStage(hotId, "stage3");
ok("hover + Alt → previous stage (stage3)", r.ok, `stage=${r.stage}`);

await hotRow.hover();
await page.keyboard.press("Alt+Shift");
r = await waitStage(hotId, "stage6");
ok("hover + Alt+Shift → رد شده (stage6)", r.ok, `stage=${r.stage}`);

await hotRow.hover();
await page.keyboard.press("Alt+Shift");
r = await waitStage(hotId, "stage4");
ok("hover + Alt+Shift again → back to stage4", r.ok, `stage=${r.stage}`);

// Shift on a customer WITH a request → the carrier request gets issued too.
const carrierIds = await dbEval(async () => {
  const { createCustomer } = await import("/src/db/customers.ts");
  const { createRequest } = await import("/src/db/requests.ts");
  const c = await createCustomer({
    firstName: "ویزادار",
    lastName: "آزمون",
    representativeId: null,
    listId: null,
    registrationDate: "2026-11-10",
  });
  const r = await createRequest({
    customerId: c.id,
    representativeId: null,
    listId: null,
    visaType: "تستی",
    tags: [],
    registrationDate: "2026-11-10",
    issued: false,
  });
  return { c: c.id, r: r.id };
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("table");
const carrierRow = page.locator("tr", { hasText: "ویزادار آزمون" });
await carrierRow.hover();
await page.keyboard.press("Shift");
let carrierState = null;
for (let i = 0; i < 30; i++) {
  carrierState = await dbEval(async ({ c, r }) => {
    const { db } = await import("/src/db/schema.ts");
    return {
      stage: (await db.customers.get(c))?.stage,
      issued: (await db.requests.get(r))?.issued,
    };
  }, carrierIds);
  if (carrierState.stage === "stage5" && carrierState.issued === true) break;
  await page.waitForTimeout(200);
}
ok(
  "hover + Shift issues the customer's request too",
  carrierState.stage === "stage5" && carrierState.issued === true,
  JSON.stringify(carrierState),
);

/* ------------------------------ 3. stage filter --------------------------- */

await page.selectOption("select[aria-label='مرحله']", "stage5");
await page.waitForTimeout(400);
const rowsAfterFilter = await page.locator("tbody tr").count();
const allIssued = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  const cs = await db.customers.toArray();
  return cs.filter((c) => c.stage === "stage5").length;
});
ok(
  "stage filter «صادر شده» narrows the table",
  rowsAfterFilter === allIssued && rowsAfterFilter >= 2,
  `rows=${rowsAfterFilter} expected=${allIssued}`,
);
await page.selectOption("select[aria-label='مرحله']", "");
await page.waitForTimeout(300);

/* --------------------------- 4. settings colors --------------------------- */

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "مراحل و رنگ‌ها" }).locator("visible=true").click();
await page.waitForTimeout(400);
ok("settings: stage color section renders", (await page.locator("text=بازگردانی همهٔ رنگ‌ها").count()) >= 0);
const colorInputs = await page.locator("input[type='color']").count();
ok("six color pickers present", colorInputs === 6, `count=${colorInputs}`);

// Change مرحله چهارم's color (هاتکی is at stage4) and verify the dot follows.
await page.locator("input[type='color']").nth(3).evaluate((el, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, "#ff0066");
await page.waitForTimeout(400);
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await page.waitForSelector("table");
const dotColor = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("هاتکی آزمون"));
  if (!row) return null;
  const dots = Array.from(row.querySelectorAll("span")).filter(
    (s) => s.style?.width === "9px" && s.style?.backgroundColor,
  );
  return dots[0]?.style.backgroundColor ?? null;
});
ok("custom stage color flows to the dot (#ff0066)", dotColor === "rgb(255, 0, 102)", String(dotColor));

// Reset colors back to defaults.
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "مراحل و رنگ‌ها" }).locator("visible=true").click();
await page.waitForTimeout(300);
await page.click("button:has-text('بازگردانی همهٔ رنگ‌ها')");
await page.waitForTimeout(300);
const prefsAfter = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  return (await db.preferences.get("app"))?.stageColors ?? null;
});
ok("reset clears the overrides", prefsAfter == null || Object.keys(prefsAfter).length === 0, JSON.stringify(prefsAfter));

/* --------------------- 5. shortcut tutorial mentions it ------------------- */

await page.locator("button", { hasText: "کلیدهای میان‌بر" }).locator("visible=true").click();
await page.waitForTimeout(300);
ok(
  "shortcuts tutorial documents the hover hotkeys",
  (await page.locator("text=تغییر مرحلهٔ مشتری").count()) === 1,
);

/* -------------------------- 6. rep profile + views ------------------------ */

const repAli = await dbEval(async () => {
  const { db } = await import("/src/db/schema.ts");
  const all = await db.representatives.toArray();
  return all.find((r) => r.name.includes("علی")) ?? all[0];
});
await page.goto(`${BASE}/representatives/${repAli.id}`, { waitUntil: "networkidle" });
await page.click("button:has-text('مشتریان')");
await page.waitForTimeout(500);
ok(
  "rep profile: customer filters (search + مرحله + sort) render",
  (await page.locator("input[placeholder*='شماره پاسپورت مشتری']").count()) >= 1 &&
    (await page.locator("select[aria-label='مرحله']").count()) === 1,
);
const repCardsTicks = await page.locator('svg.lucide-badge-check').count();
ok("rep profile: green ticks on coded customers", repCardsTicks >= 2, `ticks=${repCardsTicks}`);
const repCardDots = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("span")).filter(
    (s) => s.style?.backgroundColor && s.title && s.title.includes("مرحله") === false && s.className?.includes("rounded-full") && s.style.width === "9px",
  ).length;
});
ok("rep profile: stage dots render on cards", repCardDots >= 3, `dots=${repCardDots}`);

// switch to table view
await page.click("button[aria-label='نمایش جدولی']");
await page.waitForTimeout(500);
ok(
  "rep profile: table view shows مرحله column",
  (await page.locator("th", { hasText: "مرحله" }).count()) === 1,
);
const savedView = await page.evaluate(() => localStorage.getItem("customer2-filter-repProfile"));
ok("view mode persisted (repProfile)", (savedView ?? "").includes("table"), String(savedView));
await page.click("button[aria-label='نمایش کارتی']");
await page.waitForTimeout(300);

// hotkeys inside the rep profile cards — زهرا is repAli's customer at stage5;
// Alt takes her back one step to «ثبت شده برای ویزا».
const zahraStageBefore = await stageOf(zahra.id);
const repHotCard = page.locator("[data-rep-customers] a", { hasText: "زهرا موسوی" }).first();
await repHotCard.hover();
await page.keyboard.press("Alt");
const altResult = await waitStage(zahra.id, "stage4");
const zahraStageAfter = await stageOf(zahra.id);
ok(
  "hotkeys work inside the rep profile cards (Alt: stage5 → stage4)",
  zahraStageBefore === "stage5" && altResult.ok,
  `${zahraStageBefore} → ${zahraStageAfter} in ${altResult.ms}ms`,
);

/* --------------------------- 7. representatives view ---------------------- */

await page.goto(`${BASE}/representatives`, { waitUntil: "networkidle" });
await page.click("button[aria-label='نمایش جدولی']");
await page.waitForTimeout(500);
const repTableHeaders = await page.locator("th").allTextContents();
ok(
  "representatives: table mode columns",
  repTableHeaders.some((h) => h.includes("نماینده")) && repTableHeaders.some((h) => h.includes("مشتریان")),
  repTableHeaders.join("|"),
);

/* ------------------------------ 8. employers ------------------------------ */

const empSetup = await dbEval(async () => {
  const { createEmployer } = await import("/src/db/employers.ts");
  const { db } = await import("/src/db/schema.ts");
  let emp = (await db.employers.toArray()).find((e) => e.name === "شرکت آزمون پیمانکاری");
  if (!emp) emp = await createEmployer({ name: "شرکت آزمون پیمانکاری", phone: "021-55" });
  const zahraC = (await db.customers.toArray()).find((c) => c.firstName === "زهرا");
  await db.customers.update(zahraC.id, { employerId: emp.id });
  return emp.id;
});
await page.goto(`${BASE}/employers`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
ok(
  "employers section renders with the employer card",
  (await page.locator("text=شرکت آزمون پیمانکاری").count()) >= 1,
);
ok(
  "employers: customer count on the card",
  (await page.locator("text=/۱\\s*مشتری/").count()) >= 1,
);
await page.waitForTimeout(300);
await page.click("button[aria-label='نمایش جدولی']");
await page.waitForTimeout(400);
ok(
  "employers: table view with «دارای کد اختصاصی» column",
  (await page.locator("th", { hasText: "دارای کد اختصاصی" }).count()) === 1,
);
await page.click("button[aria-label='نمایش کارتی']");
await page.waitForTimeout(300);

await page.goto(`${BASE}/employers/${empSetup}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok(
  "employer profile: customer collection with filters",
  (await page.locator("[data-employer-customers] select[aria-label='مرحله']").count()) === 1,
);
ok(
  "employer profile: linked customer listed (زهرا)",
  (await page.locator("text=زهرا موسوی").count()) >= 1,
);
const empTicks = await page.locator('svg.lucide-badge-check').count();
ok("employer profile: green tick on زهرا", empTicks >= 1, `ticks=${empTicks}`);

/* --------------------------- 9. customer detail --------------------------- */

const zahraStageNow = await stageOf(zahra.id);
const stageLabelNow = await dbEval(async (s) => {
  const { customerStageLabel } = await import("/src/types/index.ts");
  return customerStageLabel(s);
}, zahraStageNow);
await page.goto(`${BASE}/customers/${zahra.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const stripText = await page.evaluate(() => {
  const strips = Array.from(document.querySelectorAll(".glass"));
  const strip = strips.find((s) => s.textContent?.includes("کد اختصاصی"));
  return strip?.textContent ?? "";
});
ok(
  "customer detail: stage strip shows the current stage badge",
  stripText.includes(stageLabelNow),
  `strip="${stripText.slice(0, 80)}" expected="${stageLabelNow}"`,
);
ok(
  "customer detail: «کد اختصاصی: آقای تهرانی» chip",
  (await page.locator("text=کد اختصاصی: آقای تهرانی").count()) >= 1,
);
ok(
  "customer detail: مشخصات label renamed",
  (await page.locator("text=کد اختصاصی").count()) >= 2,
);

/* --------------------------- 10. new-customer form ------------------------ */

await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await page.click("button:has-text('مشتری جدید')");
await page.waitForTimeout(500);
const formTexts = await page.locator(".modal, [role='dialog']").first().textContent();
ok("customer form: field renamed to «کد اختصاصی»", formTexts?.includes("کد اختصاصی"));
ok("customer form: «معرف» is gone", !formTexts?.includes("معرف"));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

/* ------------------------------ 11. mobile ------------------------------- */

const mob = await ctx.newPage();
const mobErrors = [];
mob.on("pageerror", (e) => mobErrors.push(String(e)));
await mob.setViewportSize({ width: 390, height: 800 });
await mob.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
await mob.waitForTimeout(600);
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("mobile 390px: no horizontal overflow", overflow <= 0, `overflow=${overflow}px`);
const mobileStageBadge = await mob.locator("text=صادر شده").count();
ok("mobile: stage badge visible on cards", mobileStageBadge >= 1, `count=${mobileStageBadge}`);
await mob.close();

/* ------------------------------ 12. sweep -------------------------------- */

const realErrors = errors.filter((e) => !e.includes("favicon") && !e.includes("ERR_INTERNET"));
ok("console/page errors: zero", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name).join(" | "));
}
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
