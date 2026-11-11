/* eslint-disable */
/**
 * QA round 22 — LIVE smoke on the deployed GitHub Pages build.
 * Deploy identity + round-22 strings in the live bundle + a REAL end-to-end
 * representative sync on the deployed app (seed a stale legacy row via raw
 * IndexedDB, clear the prefs flag, reload → the startup backfill repairs it),
 * the rep-profile & employer-panel filter surfaces with tags beside the
 * passport, the representatives page filter bar, the studio back button —
 * zero console errors. Deep links 404 on GH Pages, so everything navigates
 * via the dock and in-app links.
 */
import { chromium } from "playwright";

const BASE = "https://elias-hussaini.github.io/customer2/";
const EXPECT_SHA = process.argv[2] ?? "";
const results = [];
const consoleErrors = [];
let page;

function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}
const sleep = (ms) => page.waitForTimeout(ms);

async function textOf() {
  return (await page.locator("body").innerText({ timeout: 8000 }).catch(() => "")).trim();
}

async function clearTables() {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const stores = Array.from(db.objectStoreNames);
          const tx = db.transaction(stores, "readwrite");
          for (const s of stores) tx.objectStore(s).clear();
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      }),
  );
}

async function getRequestRep(id) {
  return page.evaluate(
    (rid) =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("requests", "readonly");
          const get = tx.objectStore("requests").get(rid);
          get.onsuccess = () => { db.close(); resolve(get.result ? get.result.representativeId : null); };
        };
      }),
    id,
  );
}

async function clearPrefs() {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("preferences", "readwrite");
          tx.objectStore("preferences").clear();
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      }),
  );
}

async function page0BundleUrl() {
  const html = await fetch(BASE, { cache: "no-store" }).then((r) => r.text());
  const m = html.match(/src="([^"]*assets\/index-[^"]+\.js)"/);
  if (!m) throw new Error("bundle not found in index.html");
  return new URL(m[1], BASE).toString();
}

async function main() {
  /* 1. deploy identity */
  const version = await fetch(`${BASE}version.json`, { cache: "no-store" }).then((r) => r.json());
  ok(
    "live version.json sha matches the pushed commit",
    !EXPECT_SHA || version.sha === EXPECT_SHA,
    `sha=${version.sha}${EXPECT_SHA ? ` (expected ${EXPECT_SHA})` : ""}`,
  );

  /* 2. round-22 strings really are in the live bundle */
  const bundleUrl = await page0BundleUrl();
  const bundle = await fetch(bundleUrl).then((r) => r.text());
  for (const needle of [
    "با این فیلترها مشتری‌ای پیدا نشد", // scoped filter empty hint
    "در حال کار دارد", // reps status filter
    "بیشترین مشتری", // reps sort
    "همگام‌سازی نمایندگان", // backfill activity line
    "تغییر نماینده از پروفایل مشتری", // sync activity detail
    "در این فیلتر", // filtered count chip
  ]) {
    ok(`live bundle contains «${needle.slice(0, 28)}»`, bundle.includes(needle));
  }

  /* 3. live browser smoke */
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("robot.settings.v1", JSON.stringify({ enabled: false }));
      localStorage.setItem("launcher.layout.v1", "");
    } catch {}
  });
  page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1800);
  await clearTables();

  // Seed the user's exact pain: a customer whose PROFILE rep is جدید but whose
  // visa request still carries the OLD representative.
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const put = (store, value) => new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    await put("representatives", { id: "rep-old", name: "نماینده قدیمی", createdAt: 1, updatedAt: 1 });
    await put("representatives", { id: "rep-new", name: "نماینده جدید", createdAt: 2, updatedAt: 2 });
    await put("lists", { id: "list-a", name: "لیست الف", createdAt: 1, updatedAt: 1, parentId: null });
    await put("employers", { id: "emp-1", name: "کارفرما تست", createdAt: 1, updatedAt: 1 });
    await put("tags", { id: "tag-n", name: "لایو-تست", color: "#2563eb", isUrgent: false, createdAt: 2, updatedAt: 2 });
    await put("customers", { id: "c1", firstName: "علی", lastName: "رضایی", passportNo: "PA1234", representativeId: "rep-new", listId: "list-a", employerId: "emp-1", registrationDate: "2026-02-01", createdAt: 100, updatedAt: 100 });
    await put("requests", { id: "r1", customerId: "c1", representativeId: "rep-old", listId: "list-a", tags: ["tag-n"], issued: false, registrationDate: "2026-02-02", createdAt: 10, updatedAt: 10 });
    db.close();
  });
  await clearPrefs();
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2500);
  const rep = await getRequestRep("r1");
  ok("L1: live backfill repaired the stale legacy request (r1 → جدید)", rep === "rep-new", String(rep));

  /* 3b. rep profile — filters + tags beside the passport (navigate in-app) */
  await page.locator(`.dock-item[aria-label="نمایندگان"]`).first().click();
  await sleep(1100);
  await page.locator('div.glass.group button', { hasText: "نماینده جدید" }).first().click();
  await sleep(1100);
  ok("L2a: opened the representative profile page", page.url().includes("/representatives/"), page.url());
  await page.locator('[role="tablist"] [role="tab"]', { hasText: "مشتریان" }).first().click();
  await sleep(1000);
  let body = await textOf();
  ok("L2: rep profile مشتریان tab has the filter panel", (await page.locator("[data-rep-customers] [data-customer-filters]").count()) === 1);
  const card = page.locator("[data-rep-customers] a", { hasText: "علی رضایی" });
  const cardText = (await card.innerText().catch(() => "")) || "";
  ok("L3: TAG badge beside the passport on the live rep profile", cardText.includes("PA1234") && cardText.includes("لایو-تست"), cardText.replace(/\n/g, " | "));

  // filter: وضعیت=صادر شده → empty (r1 is pending) then clear
  await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').selectOption({ label: "ویزا صادر شده" });
  await sleep(800);
  body = await textOf();
  ok("L4: وضعیت filter works live (empty hint)", body.includes("با این فیلترها مشتری‌ای پیدا نشد"));
  await page.locator("[data-rep-customers] button", { hasText: "پاک‌کردن فیلترها" }).first().click();
  await sleep(700);

  /* 3c. employer panel — filters + tags */
  await page.locator(`.dock-item[aria-label="کارفرماها"]`).first().click();
  await sleep(1100);
  await page.locator('div.glass.group button', { hasText: "کارفرما تست" }).first().click();
  await sleep(1200);
  body = await textOf();
  ok("L5: employer panel has the filter panel + نماینده select", (await page.locator("[data-employer-customers] [data-customer-filters]").count()) === 1 && (await page.locator('[data-employer-customers] select[aria-label="نماینده"]').count()) === 1);
  const empCard = page.locator("[data-employer-customers] a", { hasText: "علی رضایی" });
  const empCardText = (await empCard.innerText().catch(() => "")) || "";
  ok("L6: tag beside the passport in the live employer panel", empCardText.includes("PA1234") && empCardText.includes("لایو-تست"), empCardText.replace(/\n/g, " | "));

  /* 3d. representatives page filter bar */
  await page.locator(`.dock-item[aria-label="نمایندگان"]`).first().click();
  await sleep(1100);
  ok("L7: reps page filter panel live", (await page.locator("[data-reps-filters]").count()) === 1);
  body = await textOf();
  ok("L8: reps sort options live", body.includes("بیشترین درخواست") && body.includes("در حال کار دارد"));

  /* 3e. studio back button */
  await page.locator(`.dock-item[aria-label="ابزار عکس"]`).first().click();
  await sleep(1100);
  ok("L9: ابزار عکس has a back button (live)", (await page.locator('button[aria-label="بازگشت"]').count()) >= 1);

  /* 3f. clean */
  ok("L10: zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  await browser.close();
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
