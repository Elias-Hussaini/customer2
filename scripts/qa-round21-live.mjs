/* eslint-disable */
/**
 * QA round 21 — LIVE smoke on the deployed GitHub Pages build.
 * Read-mostly checks: deploy identity, feature surfaces present, the recall
 * arrow in the global search, the explorer toolbar, the ۸۰۰×۶۰۰ preset and
 * the settings toggle — zero console errors.
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

async function main() {
  /* 1. deploy identity */
  const version = await fetch(`${BASE}version.json`, { cache: "no-store" }).then((r) => r.json());
  ok(
    "live version.json sha matches the pushed commit",
    !EXPECT_SHA || version.sha === EXPECT_SHA,
    `sha=${version.sha}${EXPECT_SHA ? ` (expected ${EXPECT_SHA})` : ""}`,
  );

  /* 2. round-21 strings really are in the live bundle */
  const bundleUrl = await page0BundleUrl();
  const bundle = await fetch(bundleUrl).then((r) => r.text());
  for (const needle of [
    "app.field.history.v1", // per-field recall history
    "application/x-c2-studio-images", // internal dnd payload
    "اندازهٔ استاندارد عکس پروفایل", // settings toggle
    "زیرپوشهٔ جدید", // explorer sub-folder button
    "سایر (بدون پوشه)", // nested save picker
  ]) {
    ok(`live bundle contains «${needle.slice(0, 28)}»`, bundle.includes(needle));
  }

  /* 3. live browser smoke */
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

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);

  // studio: editor preset (end-to-end — load a real generated image first)
  await page.locator('.dock-item[aria-label="ابزار عکس"]').first().click();
  await sleep(1000);
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120; c.height = 90;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#4477cc";
    ctx.fillRect(0, 0, 120, 90);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles('input[accept="image/*,.pdf"]', {
    name: "live.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await sleep(1500);
  let body = await page.locator("body").innerText();
  ok("editor loads the image (120×90)", body.includes("120×90"));
  await page.locator("button", { hasText: "۸۰۰×۶۰۰" }).first().click();
  await sleep(900);
  body = await page.locator("body").innerText();
  ok("one tap → 800×600 with نسبت آزاد", body.includes("800×600") && body.includes("نسبت آزاد"));

  await page.locator('[role="tab"]', { hasText: "کتابخانه" }).first().click();
  await sleep(900);
  body = await page.locator("body").innerText();
  ok("library = explorer (breadcrumb خانه + back + سایر + انتخاب)", ["خانه", "سایر", "انتخاب"].every((t) => body.includes(t)));
  ok("library back disabled at root", (await page.locator('button[aria-label="بازگشت"]').isDisabled()) === true);

  // settings via the UI (GH Pages serves deep links with a 404 status — the
  // SPA fallback works, but a direct goto would pollute the console check)
  await page.locator('.dock-item[aria-label="بیشتر"]').first().click();
  await sleep(700);
  await page.locator('button', { hasText: "تنظیمات" }).first().click();
  await sleep(900);
  await page.locator("nav button", { hasText: "پیش‌فرض‌های فرم" }).first().click();
  await sleep(700);
  const sw = page.locator("div.rounded-2xl").filter({ hasText: "اندازهٔ استاندارد عکس پروفایل" }).first().getByRole("switch");
  ok("settings: profile-photo 400×600 toggle ON", (await sw.getAttribute("aria-checked")) === "true");

  // recall arrow in the global search (top bar) on a fresh-ish profile
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(900);
  const gs = page.locator("input[data-global-search]");
  await gs.fill("آزمون");
  await gs.press("Enter");
  await sleep(1000);
  await page.goBack();
  await sleep(1200);
  await gs.click();
  await sleep(400);
  const arrow = page.locator('input[data-global-search] ~ button[aria-label="جستجوی قبلی"]');
  ok("global search shows the recall arrow after history", (await arrow.count()) === 1);
  await arrow.click();
  await sleep(300);
  ok("arrow recalls the typed query", (await gs.inputValue()) === "آزمون");

  ok("zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  await browser.close();
  if (failed.length > 0) process.exit(1);
}

/** Find the main JS bundle URL from the live index.html. */
async function page0BundleUrl() {
  const html = await fetch(BASE, { cache: "no-store" }).then((r) => r.text());
  const m = html.match(/src="([^"]*assets\/index-[^"]+\.js)"/);
  if (!m) throw new Error("bundle not found in index.html");
  return new URL(m[1], BASE).toString();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
