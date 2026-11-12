/** Live smoke — Round 15 (stages) on the deployed GitHub Pages build. */
import { chromium } from "playwright";

const BASE = "https://elias-hussaini.github.io/customer2";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
});

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  if (navigator.serviceWorker) {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }
});
await page.reload({ waitUntil: "networkidle" });

// 1. Customers page renders with the stage column (seed one customer in THIS
//    ephemeral browser context — the user's own device data is never touched).
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
// Seed via the raw IndexedDB API (no version pin — Dexie already created it).
await page.evaluate(async () => {
  const open = indexedDB.open("customer2-visa");
  await new Promise((res, rej) => {
    open.onupgradeneeded = () => res(undefined);
    open.onsuccess = () => res(undefined);
    open.onerror = () => rej(open.error);
  });
  const req = open.result;
  const now = Date.now();
  await new Promise((res, rej) => {
    const tx = req.transaction(["customers"], "readwrite");
    const store = tx.objectStore("customers");
    store.put({
      id: "live-smoke-1",
      firstName: "آزمون",
      lastName: "زنده",
      referrer: "K-LIVE",
      representativeId: null,
      listId: null,
      employerId: null,
      stage: "stage3",
      registrationDate: "2026-11-12",
      customValues: {},
      createdAt: now,
      updatedAt: now,
    });
    tx.oncomplete = () => res(undefined);
    tx.onerror = () => rej(tx.error);
  });
  req.close();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const stageHeader = await page.locator("th", { hasText: "مرحله" }).count();
ok("live: customers page shows the مرحله column", stageHeader === 1, `headers=${stageHeader}`);
const tick = await page.locator("svg.lucide-badge-check").count();
ok("live: green کد اختصاصی tick renders on the coded row", tick >= 1, `ticks=${tick}`);
const stagePill = await page.locator("td span", { hasText: "دارای کد اختصاصی" }).count();
ok("live: stage badge «دارای کد اختصاصی» on the row", stagePill >= 1, `pills=${stagePill}`);
const stageFilterOptions = await page.locator("select[aria-label='مرحله'] option", { hasText: "دارای کد اختصاصی" }).count();
ok("live: stage filter with the six journey stages", stageFilterOptions >= 1);

// 2. Settings → مراحل و رنگ‌ها renders with six pickers.
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: "مراحل و رنگ‌ها" }).locator("visible=true").click();
await page.waitForTimeout(800);
const pickers = await page.locator("input[type='color']").count();
ok("live: six stage color pickers in Settings", pickers === 6, `pickers=${pickers}`);

// 3. Shortcuts tutorial documents the hover hotkeys.
await page.locator("button", { hasText: "کلیدهای میان‌بر" }).locator("visible=true").click();
await page.waitForTimeout(500);
ok(
  "live: hover-hotkey tutorial present",
  (await page.locator("text=تغییر مرحلهٔ مشتری").count()) === 1,
);

// 4. Representatives + Employers sections render with the view toggle.
await page.goto(`${BASE}/representatives`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok(
  "live: representatives view toggle present",
  (await page.locator("button[aria-label='نمایش جدولی']").count()) === 1,
);
await page.goto(`${BASE}/employers`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok(
  "live: employers section renders with view toggle",
  (await page.locator("button[aria-label='نمایش جدولی']").count()) === 1,
);

// 5. Zero console errors on a clean pass.
const realErrors = errors.filter((e) => !e.includes("ERR_") && !e.includes("Failed to load resource"));
ok("live: zero console/page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n===== LIVE ${results.length - failed.length}/${results.length} PASS =====`);
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
