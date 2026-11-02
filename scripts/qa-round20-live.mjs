/* eslint-disable */
/** Live smoke — round 20 (recall arrow + sticky search bar) on the deployed build. */
import { chromium } from "playwright";

const BASE = "https://elias-hussaini.github.io/customer2/";
const results = [];
let page;
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => page.waitForTimeout(ms);
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("robot.settings.v1", JSON.stringify({ enabled: false })); } catch {}
  });
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("manifest.json") && !m.text().includes("Download the React DevTools")) errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3000);

  // Seed customers into THIS browser context only.
  await page.evaluate(async () => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open();
    const now = Date.now();
    const people = [["live-c1", "علی", "رضایی"], ["live-c2", "حسین", "احمدی"]];
    for (const [id, f, l] of people) {
      await new Promise((res) => { const tx = db.transaction("customers", "readwrite"); tx.objectStore("customers").put({ id, firstName: f, lastName: l, registrationDate: "2025-11-01", createdAt: now, updatedAt: now }); tx.oncomplete = res; });
    }
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2500);

  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(1200);
  ok("live: studio opens", page.url().includes("/studio"));

  const input = page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]');
  const arrow = page.locator('button[aria-label="جستجوی قبلی"]');
  ok("live: arrow hidden before any jump", (await arrow.count()) === 0);

  // Two jumps → history
  for (const [q, hit] of [["رضایی", "علی رضایی"], ["احمدی", "حسین احمدی"]]) {
    await input.fill(q);
    await sleep(500);
    await page.locator(`text=${hit}`).first().click();
    await sleep(1300);
    await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
    await sleep(900);
  }
  ok("live: arrow visible after jumps", (await arrow.count()) === 1);

  // Arrow stepping on the empty input
  await input.click();
  await sleep(400);
  await arrow.click();
  await sleep(350);
  let v = await input.inputValue();
  ok("live: arrow #1 recalls newest (احمدی)", v === "احمدی", `value=${v}`);
  await arrow.click();
  await sleep(350);
  v = await input.inputValue();
  ok("live: arrow #2 steps older (رضایی)", v === "رضایی", `value=${v}`);
  await page.keyboard.press("Escape");

  // Sticky: load an image to make the page tall, then scroll.
  const chooser = page.waitForEvent("filechooser");
  await page.locator('button:has-text("انتخاب تصویر")').first().click();
  (await chooser).setFiles({ name: "t.png", mimeType: "image/png", buffer: PNG_1x1 });
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 800));
  await sleep(600);
  const top = await input.boundingBox();
  ok("live: bar sticks under the top bar", top && top.y >= 64 && top.y <= 88, `y=${top && top.y}`);
  await arrow.click();
  await sleep(350);
  v = await input.inputValue();
  ok("live: arrow works while stuck", v.length > 0, `value=${v}`);
  const bg = await page.evaluate(() => {
    const el = document.querySelector(".jump-search-wrap");
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  ok("live: floating backdrop while stuck", typeof bg === "string" && !bg.includes("0, 0, 0, 0") && bg !== "transparent", `${bg}`);

  ok("live: zero console/page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== LIVE ${pass}/${results.length} PASS ===`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
