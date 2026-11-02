/* eslint-disable */
/**
 * QA round 20 — the user's follow-up: «این بک اسپیس کار نمیکنه؛ یک فلش بزار
 * اون بالا حالت استیکی داشته باشه و مزاحم هم نباشه».
 *
 *  1. A recall ARROW button next to the search input: hidden without history,
 *     visible after the first jump, each tap = one step back (newest → oldest,
 *     wrapping), typing restarts the chain.
 *  2. The search bar is STICKY under the top bar — the arrow stays reachable
 *     while scrolling, and the floating backdrop appears only when stuck.
 *  3. Mobile: 390px, no overflow, sticky + arrow still work.
 *  4. Regression: the Backspace chain from round 19 still passes.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4173;
const BASE = `http://localhost:${PORT}/customer2/`;
const results = [];
const consoleErrors = [];
let page;

function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}
const sleep = (ms) => page.waitForTimeout(ms);

async function textOf() {
  return (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).trim();
}

async function countOf(sel) {
  return await page.locator(sel).count().catch(() => 0);
}

async function clickDock(label) {
  await page.locator(`.dock-item[aria-label="${label}"]`).first().click();
  await sleep(900);
}

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
}

async function seedData() {
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const put = (store, value) => new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const now = Date.now();
    const people = [
      ["qa-cust", "علی", "رضایی"],
      ["qa-cust2", "محمدرضا", "کریمی"],
      ["qa-cust3", "حسین", "احمدی"],
    ];
    for (const [id, first, last] of people) {
      await put("customers", { id, firstName: first, lastName: last, passportNo: null, registrationDate: "2025-11-01", createdAt: now, updatedAt: now });
    }
    db.close();
  });
  await sleep(800);
}

const searchInput = () => page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]');
const recallArrow = () => page.locator('button[aria-label="جستجوی قبلی"]');

async function jumpAndReturn(query, resultText) {
  await searchInput().fill(query);
  await sleep(500);
  await page.locator(`text=${resultText}`).first().click();
  await sleep(1100);
  await clickDock("ابزار عکس");
}

/** Where is the search bar vertically? (for the sticky assertions) */
async function searchBoxTop() {
  const box = await searchInput().boundingBox();
  return box ? Math.round(box.y) : null;
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 3000));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("robot.settings.v1", JSON.stringify({ enabled: false }));
      localStorage.setItem("launcher.layout.v1", "");
    } catch {}
  });
  page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await sleep(2500);
    await clearTables();
    await seedData();
    await page.reload({ waitUntil: "networkidle" });
    await sleep(2500);

    /* ----------------- 1. no history → arrow hidden ----------------------- */
    await clickDock("ابزار عکس");
    ok("studio opens", page.url().includes("/studio"));
    ok("recall arrow HIDDEN without history", (await countOf('button[aria-label="جستجوی قبلی"]')) === 0);

    /* ----------------- 2. two jumps → arrow appears ----------------------- */
    await jumpAndReturn("رضایی", "علی رضایی");
    ok("first jump done", page.url().includes("/studio"));
    ok("recall arrow appears after a jump", (await recallArrow().count()) === 1);

    /* ----------------- 3. arrow stepping: newest → older → wrap ---------- */
    await jumpAndReturn("کریمی", "محمدرضا کریمی");
    await jumpAndReturn("احمدی", "حسین احمدی");
    ok("three jumps done", (await recallArrow().count()) === 1);

    await searchInput().click();
    await sleep(400);
    await recallArrow().click();
    await sleep(350);
    let v = await searchInput().inputValue();
    ok("arrow #1 recalls the newest query (احمدی)", v === "احمدی", `value=${v}`);
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("arrow #2 steps to the older query (کریمی)", v === "کریمی", `value=${v}`);
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("arrow #3 reaches the oldest query (رضایی)", v === "رضایی", `value=${v}`);
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("arrow #4 wraps back to the newest (احمدی)", v === "احمدی", `value=${v}`);

    /* typing restarts the chain */
    await searchInput().fill("متن جدید");
    await sleep(300);
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("typing restarts the chain (arrow → newest again)", v === "احمدی", `value=${v}`);
    await page.keyboard.press("Escape");
    await sleep(300);

    /* ----------------- 4. sticky bar under the top bar ------------------- */
    // Make the page long: load an image into the editor (all panels open) and
    // KEEP it — an empty editor makes the page too short to scroll.
    const chooser = page.waitForEvent("filechooser");
    await page.locator('button:has-text("انتخاب تصویر")').first().click();
    (await chooser).setFiles({ name: "t.png", mimeType: "image/png", buffer: PNG_1x1 });
    await sleep(1400);
    await page.evaluate(() => document.querySelector('input[placeholder*="جستجوی مشتری"]')?.scrollIntoView());
    const restTop = await searchBoxTop();
    ok("search bar rests below the header", restTop !== null && restTop > 80, `top=${restTop}`);

    await page.evaluate(() => window.scrollTo(0, 900));
    await sleep(600);
    const scrolled = await page.evaluate(() => window.scrollY);
    ok("page actually scrolled", scrolled > 100, `scrollY=${scrolled}`);
    const stuckTop = await searchBoxTop();
    ok("search bar STICKS under the top bar while scrolling", stuckTop !== null && stuckTop >= 64 && stuckTop <= 88, `top=${stuckTop}`);

    // The arrow is still clickable in the stuck position.
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("arrow works while the bar is stuck", v.length > 0, `value=${v}`);
    await page.keyboard.press("Escape");

    // Backdrop only while stuck: the wrapper gains an opaque background.
    const stuckBg = await page.evaluate(() => {
      const el = document.querySelector(".jump-search-wrap");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok(
      "floating backdrop active while stuck",
      typeof stuckBg === "string" && stuckBg !== "rgba(0, 0, 0, 0)" && stuckBg !== "transparent",
      `${stuckBg}`,
    );

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    const backTop = await searchBoxTop();
    ok("bar returns to its natural place", backTop !== null && backTop === restTop, `${restTop} → ${backTop}`);

    /* ----------------- 5. backspace regression (round 19) ----------------- */
    await searchInput().fill(""); // clean slate — Backspace needs an EMPTY input
    await sleep(300);
    const queriesList = ["احمدی", "کریمی", "رضایی"];
    await page.keyboard.press("Backspace"); // empty → recall
    await sleep(350);
    v = await searchInput().inputValue();
    ok("Backspace still recalls (regression)", queriesList.includes(v), `value=${v}`);
    await page.keyboard.press("Backspace"); // selected → cleared
    await sleep(300);
    v = await searchInput().inputValue();
    ok("Backspace still clears the recalled text", v === "", `value=${v}`);
    await page.keyboard.press("Backspace"); // → older
    await sleep(350);
    v = await searchInput().inputValue();
    ok("Backspace still steps to the older query", queriesList.includes(v), `value=${v}`);
    await page.keyboard.press("Escape");

    /* ----------------- 6. history dropdown hint mentions the arrow -------- */
    await searchInput().fill("");
    await sleep(300);
    await searchInput().click();
    await sleep(400);
    const body = await textOf();
    ok("hint mentions فلش یا ⌫", body.includes("فلش یا ⌫ = جستجوی قبلی"));
    const rows = await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count();
    ok("history rows intact (3)", rows === 3, `rows=${rows}`);
    await page.keyboard.press("Escape");

    /* ----------------- 7. mobile: sticky + arrow + no overflow ----------- */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + "studio", { waitUntil: "networkidle" });
    await sleep(2000);
    // Load an image so the editor panels make the page tall enough to scroll.
    const mChooser = page.waitForEvent("filechooser");
    await page.locator('button:has-text("انتخاب تصویر")').first().click();
    (await mChooser).setFiles({ name: "t.png", mimeType: "image/png", buffer: PNG_1x1 });
    await sleep(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("mobile: no horizontal overflow", overflow <= 1, `overflow=${overflow}px`);
    ok("mobile: recall arrow visible", (await recallArrow().count()) === 1);
    await page.evaluate(() => window.scrollTo(0, 900));
    await sleep(600);
    const mScrolled = await page.evaluate(() => window.scrollY);
    ok("mobile: page actually scrolled", mScrolled > 100, `scrollY=${mScrolled}`);
    const mTop = await searchBoxTop();
    ok("mobile: bar sticks under the top bar", mTop !== null && mTop >= 64 && mTop <= 88, `top=${mTop}`);
    await recallArrow().click();
    await sleep(350);
    v = await searchInput().inputValue();
    ok("mobile: arrow recalls while stuck", v.length > 0, `value=${v}`);
    await page.screenshot({ path: "/home/z/my-project/qa/round20/studio-stuck-mobile.png" });

    /* --------------------------- console sweep ---------------------------- */
    const realErrors = consoleErrors.filter(
      (e) => !e.includes("Download the React DevTools") && !e.includes("manifest.json") && !e.includes("three") && !e.includes("WebGL"),
    );
    ok("zero console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    server.kill();
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== ${pass}/${results.length} PASS ===`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
