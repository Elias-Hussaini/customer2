/* eslint-disable */
/** Live smoke test for round 19 — runs against the DEPLOYED GitHub Pages build. */
import { chromium } from "playwright";

const BASE = "https://elias-hussaini.github.io/customer2/";
const results = [];
let page;

function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}
const sleep = (ms) => page.waitForTimeout(ms);

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("robot.settings.v1", JSON.stringify({ enabled: false }));
    } catch {}
  });
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("manifest.json") && !m.text().includes("Download the React DevTools")) errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3000);

  // Seed one customer INTO THIS BROWSER CONTEXT ONLY (IndexedDB is per-browser).
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const now = Date.now();
    await new Promise((res) => { const tx = db.transaction("customers", "readwrite"); tx.objectStore("customers").put({ id: "live-c1", firstName: "علی", lastName: "رضایی", passportNo: "A1", registrationDate: "2025-11-01", createdAt: now, updatedAt: now }); tx.oncomplete = res; });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2500);

  // 1. studio via dock
  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(1200);
  ok("live: studio opens", page.url().includes("/studio"));

  // 2. fresh device → empty-history hint under the jump search
  const input = page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]');
  await input.click();
  await sleep(500);
  ok("live: empty-history hint", (await page.locator("text=اینجا نگه").count()) >= 1);
  await page.keyboard.press("Escape");

  // 3. fresh editor default = JPEG
  const chooser = page.waitForEvent("filechooser");
  await page.locator('button:has-text("انتخاب تصویر")').first().click();
  (await chooser).setFiles({ name: "t.png", mimeType: "image/png", buffer: PNG_1x1 });
  await sleep(1500);
  const activeFmt = await page.evaluate(() => {
    const sec = Array.from(document.querySelectorAll("section")).find((s) => (s.textContent || "").includes("فشرده‌سازی و خروجی"));
    if (!sec) return null;
    const b = Array.from(sec.querySelectorAll("button")).find((x) => ["WebP", "JPEG", "PNG"].includes((x.textContent || "").trim()) && !x.className.includes("chip-soft"));
    return b ? (b.textContent || "").trim() : null;
  });
  ok("live: fresh default format = JPEG", activeFmt === "JPEG", `active=${activeFmt}`);

  // 4. settings persist across reload
  const sec = page.locator('section:has-text("فشرده‌سازی")');
  await sec.locator('button:has-text("WebP")').first().click();
  await sleep(700);
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2500);
  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(1000);
  const ch2 = page.waitForEvent("filechooser");
  await page.locator('button:has-text("انتخاب تصویر")').first().click();
  (await ch2).setFiles({ name: "t.png", mimeType: "image/png", buffer: PNG_1x1 });
  await sleep(1500);
  const activeFmt2 = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll("section")).find((x) => (x.textContent || "").includes("فشرده‌سازی و خروجی"));
    if (!s) return null;
    const b = Array.from(s.querySelectorAll("button")).find((x) => ["WebP", "JPEG", "PNG"].includes((x.textContent || "").trim()) && !x.className.includes("chip-soft"));
    return b ? (b.textContent || "").trim() : null;
  });
  ok("live: WebP remembered after reload", activeFmt2 === "WebP", `active=${activeFmt2}`);

  // 5. jump → history row + Backspace recall (live)
  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(800);
  await page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]').fill("رضایی");
  await sleep(600);
  await page.locator("text=علی رضایی").first().click();
  await sleep(1300);
  ok("live: jump → پرونده", page.url().includes("/customers/live-c1"));
  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(1000);
  const ji = page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]');
  await ji.click();
  await sleep(500);
  ok("live: history row appears", (await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count()) === 1);
  await page.keyboard.press("Backspace");
  await sleep(400);
  ok("live: Backspace recalls the query", (await ji.inputValue()) === "رضایی");
  await page.keyboard.press("Escape");

  ok("live: zero console/page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== LIVE ${pass}/${results.length} PASS ===`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
