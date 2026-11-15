/**
 * Browser QA — Round 26:
 *   «رمز یک‌بارمصرف نصب (سیستم‌های تازه و قدیمی)؛ حذف همهٔ توضیحات /
 *    راهنماهای لودهنده؛ فعال‌سازی بی‌صدا و بی‌اعلان حالت ناهنجاری.»
 *
 * Runs against `vite preview` of the PRODUCTION build (real service worker,
 * real CacheStorage, real offline behavior).
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE ?? "http://localhost:4173/customer2";
const PASSWORD = "Mazari1234$$$";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};
const noop = () => {};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/net::|fetch|Failed to load|ERR_/i.test(t)) errors.push(t);
});

/* ---------------------------- helpers ---------------------------------- */

const secState = () => page.evaluate(() => JSON.parse(localStorage.getItem("customer2.security") ?? "null"));
const pwaState = () =>
  page.evaluate(async () => ({
    sw: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await window.caches.keys(),
    controlled: !!navigator.serviceWorker.controller,
  }));
const gateInput = page.locator('input[placeholder="رمز عبور"]');

async function waitFor(fn, timeout = 20_000, step = 400) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(step);
  }
  return last;
}

async function typeSecretCombo() {
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  for (const d of "09029327968") {
    await page.keyboard.press(d);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
}

/** What element sits at screen-center? (opaque-cover check) */
const centerOwner = () =>
  page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      inLockOverlay: !!el?.closest?.('[role="alertdialog"]'),
      tag: el?.tagName ?? null,
    };
  });

/** Fresh app state (no SW, no caches, no security state, gate shut). */
async function hardReset() {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if (navigator.serviceWorker) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
    if (window.caches) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
}

await hardReset();
await page.reload({ waitUntil: "networkidle" });

/* =================== A. install gate — fresh system ===================== */

console.log("\n--- A. رمز نصب (سیستم تازه) ---");

ok("A1. اولین باز: صفحه رمز باز است", await gateInput.isVisible().catch(() => false));
ok("A2. متن درخواست رمز دیده می‌شود",
  await page.getByText("لطفاً رمز عبور را وارد کنید").first().isVisible().catch(() => false));
ok("A3. صفحه رمز، داستان الگوریتم را نمی‌گوید",
  !(await page.getByText("الگوریتم امنیتی").first().isVisible().catch(() => false)));
const cover1 = await centerOwner();
ok("A4. پوشش کدر کامل — برنامه پشت قفل دیده نمی‌شود", cover1.inLockOverlay, JSON.stringify(cover1));

// combo is dead while the gate is shut
await typeSecretCombo();
await page.waitForTimeout(400);
ok("A5. کلید مخفی قبل از رمز، کنسول را باز نمی‌کند", !page.url().includes("/sec-console"));
ok("A6. قفل هنوز پابرجاست", await gateInput.isVisible().catch(() => false));

// SW registers behind the gate → the gate also holds OFFLINE
let st = await waitFor(async () => ((await pwaState()).sw >= 1 ? pwaState() : null), 20_000);
ok("A7. سرویس‌ورکر پشت قفل ثبت شد (کش روشن)", st.sw >= 1, `sw=${st.sw}`);
await ctx.setOffline(true);
let offlineGated = false;
await page.reload({ waitUntil: "load", timeout: 15_000 }).catch(() => { offlineGated = true; });
await ctx.setOffline(false);
ok("A8. آفلاین هم صفحه رمز سر جایش است (قفل از کش فرار ندارد)",
  await gateInput.isVisible().catch(() => false) && offlineGated === false);

// wrong password
await gateInput.fill("wrong-pass");
await gateInput.press("Enter");
await page.waitForTimeout(500);
ok("A9. رمز غلط → پیام خطا",
  await page.getByText("رمز عبور نادرست است").first().isVisible().catch(() => false));

// correct password → app opens
await gateInput.fill(PASSWORD);
await gateInput.press("Enter");
await waitFor(async () => !(await gateInput.isVisible().catch(() => false)) ? true : null, 10_000);
ok("A10. رمز درست → برنامه باز شد", !(await gateInput.isVisible().catch(() => false)));
const cover2 = await centerOwner();
ok("A11. پوشش برداشته شد — محتوای برنامه قابل کلیک است", !cover2.inLockOverlay, JSON.stringify(cover2));
let gate = (await secState())?.gateUnlocked;
ok("A12. پرچم بازشدن در حافظه ثبت شد", gate === true);

// once per system: reload → no gate
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
ok("A13. بازآوری: دیگر رمز نمی‌خواهد (فقط یک بار)",
  !(await gateInput.isVisible().catch(() => false)));

/* ============ A-bis. legacy (round-25) installs get gated too ============ */

console.log("\n--- A-bis. سیستم‌های قدیمی ---");

await page.evaluate(() => {
  // exactly what a round-25 device has in storage — NO gateUnlocked key
  localStorage.setItem(
    "customer2.security",
    JSON.stringify({ cacheOff: false, cacheBeforeAnomaly: null, anomaly: null, locked: false, lockedAt: 0, failedAttempts: 0, cooldownUntil: 0 }),
  );
});
await page.reload({ waitUntil: "networkidle" });
ok("A14. نصب‌های قبلی هم بدون رمز باز نمی‌شوند", await gateInput.isVisible().catch(() => false));
await gateInput.fill(PASSWORD);
await gateInput.press("Enter");
await waitFor(async () => !(await gateInput.isVisible().catch(() => false)) ? true : null, 10_000);
ok("A15. با رمز درست وارد شد", !(await gateInput.isVisible().catch(() => false)));

/* ============ B. console — no more revealing explanations =============== */

console.log("\n--- B. پنل مخفی بدون توضیح ---");

await typeSecretCombo();
await page.waitForURL("**/sec-console", { timeout: 5_000 }).catch(noop);
ok("B1. کلید مخفی → کنسول باز شد", page.url().includes("/sec-console"));
const bodyText = await page.evaluate(() => document.body.innerText);
ok("B2. هیچ اشاره‌ای به Ctrl+Alt+Shift نیست", !bodyText.includes("Ctrl+Alt+Shift"));
ok("B3. هیچ اشاره‌ای به «شماره/ترکیب مخفی» نیست", !bodyText.includes("شماره مخفی") && !bodyText.includes("ترکیب کلید مخفی"));
ok("B4. توضیح مکانیزم تله حذف شد", !bodyText.includes("تشخیص الگوریتم") && !bodyText.includes("قفل صفحه بین کلیک"));
ok("B5. وضعیت زنده کش سر جایش است", bodyText.includes("وضعیت زنده مرورگر"));

/* ============ C. anomaly — SILENT arm, then trap ======================== */

console.log("\n--- C. فعال‌سازی بی‌صدا و تله ---");

await page.getByRole("button", { name: "فعال‌سازی", exact: true }).click();
await page.waitForTimeout(900);
ok("C1. کنسول بسته و صفحه اصلی باز شد", !page.url().includes("/sec-console"));

const toastText = (await page.locator('div[role="status"]').textContent().catch(() => "")) ?? "";
ok("C2. هیچ اعلانی («حالت ناهنجاری فعال شد») نشان داده نشد",
  !toastText.includes("ناهنجاری") && toastText.trim() === "", JSON.stringify(toastText.slice(0, 60)));

let trap = await secState();
const threshold = trap?.anomaly?.threshold;
ok("C3. تله مسلح شد (آستانه ۱۵ تا ۲۰)",
  typeof threshold === "number" && threshold >= 15 && threshold <= 20, `threshold=${threshold}`);
ok("C4. کش خودکار خاموش شد", trap?.cacheOff === true);

// grace window: first-5s clicks don't count
for (let i = 0; i < 6; i++) await page.mouse.click(640, 450);
trap = await secState();
ok("C5. کلیک‌های مهلت ۵ ثانیه شمرده نمی‌شوند", trap.anomaly.clicks === 0, `clicks=${trap.anomaly.clicks}`);

st = await waitFor(async () => ((await pwaState()).sw === 0 ? pwaState() : null), 10_000);
ok("C6. سرویس‌ورکر پاک شد (فقط با اینترنت)", st.sw === 0, `sw=${st.sw}`);

// wait out the grace window, then click to threshold-1
{
  const armedAt = (await secState()).anomaly.armedAt;
  const waitMs = Math.max(0, 5_000 - (Date.now() - armedAt)) + 400;
  await page.waitForTimeout(waitMs);
}
for (let i = 0; i < threshold - 1; i++) {
  await page.mouse.click(640, 450);
  await page.waitForTimeout(50);
}
trap = await secState();
ok("C7. تا یک کلیک مانده به آستانه: همه‌چیز طبیعی",
  trap.anomaly.clicks === threshold - 1 && trap.locked === false, `clicks=${trap.anomaly.clicks}/${threshold}`);

// the final click locks — WITH the algorithm story this time
await page.mouse.click(640, 450);
await page.waitForTimeout(600);
ok("C8. کلیک نهایی → صفحه قفل شد", await gateInput.isVisible().catch(() => false));
ok("C9. پیام «دسترسی قفل شد» و داستان مدارک",
  await page.getByText("دسترسی قفل شد").first().isVisible().catch(() => false) &&
  await page.getByText("الگوریتم امنیتی").first().isVisible().catch(() => false));

// reload can't escape (canonical URL — the preview server 404s the
// slashless /customer2 URL that navigate("/") leaves behind; on GitHub Pages
// the SPA 404.html boots the app there and the lock holds just the same)
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1_000);
let lockStill = await gateInput.isVisible().catch(() => false);
if (lockStill) {
  await page.reload({ waitUntil: "networkidle" }).catch(noop);
  await page.waitForTimeout(1_000);
  lockStill = await gateInput.isVisible().catch(() => false);
}
ok("C10. بازآوری از قفل فرار نمی‌کند", lockStill);

// wrong then correct password
await gateInput.fill("12345");
await gateInput.press("Enter");
await page.waitForTimeout(400);
trap = await secState();
ok("C11. تلاش ناموفق شمرده شد", trap.failedAttempts === 1, `failed=${trap.failedAttempts}`);
await gateInput.fill(PASSWORD);
await gateInput.press("Enter");
await page.waitForTimeout(2_500); // confirmation + auto reload
await page.waitForLoadState("networkidle").catch(noop);
const finalTrap = await secState();
ok("C12. رمز درست: تله تمام و کش به حالت قبل برگشت",
  finalTrap?.anomaly === null && finalTrap?.locked === false && finalTrap?.cacheOff === false,
  JSON.stringify(finalTrap));
st = await waitFor(async () => ((await pwaState()).sw >= 1 ? pwaState() : null), 25_000);
ok("C13. سرویس‌ورکر دوباره ثبت شد", st.sw >= 1, `sw=${st.sw}`);

/* ============ D. removed guides elsewhere =============================== */

console.log("\n--- D. راهنماهای حذف‌شده ---");

await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
let txt = await page.evaluate(() => document.body.innerText);
ok("D1. راهنمای Ctrl/Alt/Shift در بخش مشتریان حذف شد", !txt.includes("با نگه‌داشتن نشانگر"));
ok("D2. صفحه مشتریان کار می‌کند", await page.locator("main").first().isVisible().catch(() => false));

await page.goto(`${BASE}/settings?tab=stages`, { waitUntil: "networkidle" });
txt = await page.evaluate(() => document.body.innerText);
ok("D3. کارت «جریان خودکار مراحل» حذف شد", !txt.includes("جریان خودکار مراحل"));
ok("D3b. سربرگ «مراحل و رنگ‌ها» هنوز سر جایش است", txt.includes("مراحل و رنگ‌ها"));

await page.goto(`${BASE}/settings?tab=shortcuts`, { waitUntil: "networkidle" });
txt = await page.evaluate(() => document.body.innerText);
ok("D4. کارت «تغییر مرحلهٔ مشتری (هاور + کلید)» حذف شد",
  !txt.includes("هاور + کلید") && !txt.includes("تغییر مرحلهٔ مشتری"));
ok("D4b. بقیهٔ راهنمای میان‌برها سر جایش است", txt.includes("میان‌برهای دوبل"));

ok("D5. هیچ خطای کنسولی نیست", errors.length === 0, errors.slice(0, 3).join(" | "));

/* ============ E. a brand-new system is gated again ====================== */

console.log("\n--- E. سیستم نو ---");
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page2 = await ctx2.newPage();
await page2.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok("E1. سیستم تازه: صفحه رمز باز است",
  await page2.locator('input[placeholder="رمز عبور"]').isVisible().catch(() => false));
await ctx2.close();

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n========== ${results.length - failed.length}/${results.length} PASS ==========`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" · "));
  process.exit(1);
}
