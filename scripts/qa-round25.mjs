/**
 * Browser QA — Round 25 (hidden security layer):
 *   «Ctrl+Alt+Shift + 09029327968 → صفحه امنیتی مخفی؛ کش فعال/غیرفعال؛
 *    حالت ناهنجاری — بستن صفحه، ۱۵ تا ۲۰ کلیک، قفل + رمز، کش خاموش.»
 *
 * Runs against `vite preview` of the PRODUCTION build (real service worker,
 * real CacheStorage, real offline behavior).
 */
import { chromium } from "playwright";

const BASE = process.env.QA_BASE ?? "http://localhost:4173/customer2";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// instrument every document-level click — survives ALL reloads (init script)
await page.addInitScript(() => {
  window.__clicks = [];
  window.__loadedAt = Date.now();
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      window.__clicks.push({
        tag: t?.tagName,
        inConsole: !!(t instanceof Element && t.closest("[data-sec-console]")),
        inBody: !!(t instanceof Node && document.body.contains(t)),
      });
    },
    true,
  );
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  // offline experiments legitimately produce network errors — skip those
  if (m.type() === "error" && !/net::|fetch|Failed to load|ERR_/i.test(t)) errors.push(t);
});

/** Fresh app state (no SW, no caches, no security state). */
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

/* ---------------------------- helpers ---------------------------------- */

const secState = () => page.evaluate(() => JSON.parse(localStorage.getItem("customer2.security") ?? "null"));
const pwaState = () =>
  page.evaluate(async () => ({
    sw: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await window.caches.keys(),
    controlled: !!navigator.serviceWorker.controller,
  }));

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

/** Type the secret combo: hold Ctrl+Alt+Shift, press the digits in order. */
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

/* ======================= A. secret combo → console ====================== */

console.log("\n--- A. کلید مخفی ---");

// A1: wrong order must NOT open it
await typeSecretComboWrong();
function noop() {}
async function typeSecretComboWrong() {
  await page.keyboard.down("Control"); await page.keyboard.down("Alt"); await page.keyboard.down("Shift");
  for (const d of "09029327969") { await page.keyboard.press(d); await page.waitForTimeout(60); }
  await page.keyboard.up("Shift"); await page.keyboard.up("Alt"); await page.keyboard.up("Control");
}
await page.waitForTimeout(400);
ok("A1. ترتیب غلط کنسول را باز نمی‌کند", !page.url().includes("/sec-console"));

// A2: correct order opens the hidden console
await typeSecretCombo();
await page.waitForURL("**/sec-console", { timeout: 5_000 }).catch(noop);
ok("A2. Ctrl+Alt+Shift+09029327968 → صفحه امنیتی باز می‌شود", page.url().includes("/sec-console"));
const consoleVisible = await page.getByText("کنسول امنیتی").first().isVisible().catch(() => false);
ok("A3. عنوان «کنسول امنیتی» دیده می‌شود", consoleVisible);
const grant = await page.evaluate(() => sessionStorage.getItem("customer2.sec.grant"));
ok("A4. مجوز نشست ثبت شده", grant === "1");

/* ======================= B. cache kill-switch =========================== */

console.log("\n--- B. کش ---");

// B1: production build has a live SW + caches
let st = await waitFor(async () => (await pwaState()).sw >= 1 ? pwaState() : null);
ok("B1. ابتدا: سرویس‌ورکر و کش فعال‌اند", st.sw >= 1 && st.caches.length >= 1, JSON.stringify({ sw: st.sw, caches: st.caches.length }));

// B2: with cache ON, an OFFLINE reload works (true offline PWA)
await ctx.setOffline(true);
let offlineReloadOk = true;
await page.reload({ waitUntil: "load", timeout: 15_000 }).catch(() => { offlineReloadOk = false; });
await ctx.setOffline(false);
const dashVisible = await page.getByText("کنسول امنیتی").first().isVisible().catch(() => false);
ok("B2. با کشِ روشن: بازآوریِ آفلاین کار می‌کند", offlineReloadOk && dashVisible);

// B3: turn the cache OFF from the console
await page.goto(`${BASE}/sec-console`, { waitUntil: "networkidle" }); // grant survived the reload
await page.getByRole("button", { name: "غیرفعال‌سازی کش" }).click();
await page.waitForTimeout(800);
st = await waitFor(async () => (await pwaState()).sw === 0 ? pwaState() : null, 10_000);
ok("B3. پس از خاموش‌کردن: هیچ سرویس‌ورکری نیست", st.sw === 0, `sw=${st.sw}`);
ok("B4. هیچ حافظهٔ کشی باقی نمانده", st.caches.length === 0, `caches=${st.caches.length}`);
const persisted = await secState();
ok("B5. وضعیت کش در حافظهٔ ماندگار ثبت شد", persisted?.cacheOff === true);

// B6: with cache OFF, an OFFLINE reload FAILS (internet-only, as requested)
await ctx.setOffline(true);
let offlineReloadBlocked = false;
await page.reload({ waitUntil: "load", timeout: 12_000 }).catch(() => { offlineReloadBlocked = true; });
await ctx.setOffline(false);
ok("B6. با کشِ خاموش: بدون اینترنت برنامه باز نمی‌شود", offlineReloadBlocked);

// B7: turning the cache back ON re-registers the SW (auto reload)
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await typeSecretCombo(); // grant died? no — grant survived; but combo is the honest path
await page.waitForURL("**/sec-console", { timeout: 5_000 }).catch(noop);
await page.getByRole("button", { name: "فعال‌سازی کش" }).click();
await page.waitForTimeout(2_500); // toast + ~900ms → auto reload
st = await waitFor(async () => {
  const s = await pwaState();
  return s.sw >= 1 && s.caches.length >= 1 ? s : null;
}, 25_000);
ok("B7. روشن‌کردن مجدد: سرویس‌ورکر برگشت", !!(st && st.sw >= 1), JSON.stringify(st));
const afterOn = await secState();
ok("B8. پرچم cacheOff برگشت به false", afterOn?.cacheOff === false);

/* ======================= C. anomaly trap ================================ */

console.log("\n--- C. حالت ناهنجاری ---");

// C1: open console via combo (fresh grant after reloads) and ARM
await typeSecretCombo();
await page.waitForURL("**/sec-console", { timeout: 5_000 }).catch(noop);
console.log("  [dbg] console url:", page.url());
await page.getByRole("button", { name: "فعال‌سازی", exact: true }).click();
await page.waitForTimeout(700);
console.log("  [dbg] url after arm:", page.url());
ok("C1. فعال‌سازی → صفحه امنیتی بسته و صفحه اصلی باز شد", !page.url().includes("/sec-console"));

let trap = await secState();
const threshold = trap?.anomaly?.threshold;
ok("C2. تله مسلح شد و آستانه بین ۱۵ تا ۲۰ است",
  typeof threshold === "number" && threshold >= 15 && threshold <= 20, `threshold=${threshold}`);
ok("C3. کش در حالت ناهنجاری خودکار خاموش شد", trap?.cacheOff === true);

// C6 FIRST (grace window is ticking): clicks in the first 5s don't count
for (let i = 0; i < 6; i++) await page.mouse.click(640, 450);
trap = await secState();
ok("C6. کلیک‌های ۵ ثانیهٔ اول شمرده نمی‌شوند (مهلت)", trap.anomaly.clicks === 0, `clicks=${trap.anomaly.clicks}`);

// now the slower assertions (grace is over by the time these finish)
st = await waitFor(async () => (await pwaState()).sw === 0 ? pwaState() : null, 10_000);
ok("C4. سرویس‌ورکر در حالت ناهنجاری پاک شد", st.sw === 0);
const grantAfterArm = await page.evaluate(() => sessionStorage.getItem("customer2.sec.grant"));
ok("C5. مجوز کنسول با فعال‌سازی تله باطل شد", grantAfterArm === null);
// C7: count up to threshold-1 — still normal, nothing visible
const preC7 = await page.evaluate(() => {
  const el = document.elementFromPoint(640, 450);
  return {
    at: el?.tagName + "." + String(el?.className).slice(0, 40),
    seenSoFar: window.__clicks.length,
    url: location.href,
    docAge: Date.now() - window.__loadedAt,
  };
});
console.log("  [dbg] pre-C7:", JSON.stringify(preC7), "t+", Date.now() - (await secState()).anomaly.armedAt, "ms since arm");
// wait out the remaining grace window — clicks only count AFTER it
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
const c7debug = await page.evaluate(() => ({ seen: window.__clicks.length, last: window.__clicks.slice(-4) }));
console.log("  [dbg] post-C7:", JSON.stringify(c7debug));
ok("C7. تا یک کلیک قبل از آستانه: همه‌چیز طبیعی", trap.anomaly.clicks === threshold - 1 && trap.locked === false, `clicks=${trap.anomaly.clicks}/${threshold}`);

// C8: the NEXT click locks the screen
await page.mouse.click(640, 450);
await page.waitForTimeout(600);
const lockInput = page.locator('input[placeholder="رمز عبور"]');
ok("C8. کلیک نهایی → صفحه قفل شد", await lockInput.isVisible().catch(() => false));
ok("C9. پیام «لطفاً رمز عبور را وارد کنید» نمایش داده شد",
  await page.getByText("لطفاً رمز عبور را وارد کنید").first().isVisible().catch(() => false));
trap = await secState();
ok("C10. قفل در حافظهٔ ماندگار ثبت شد", trap.locked === true && trap.cacheOff === true);

// C11: reload / re-entry cannot escape the lock.
// (The preview dev-server 404s the no-trailing-slash /customer2 URL — a
// dev-only quirk; on GitHub Pages that URL boots the app via 404.html. So we
// test escape at the canonical URL: address-bar re-entry AND a real F5.)
await page.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch((e) => console.log("  [dbg] goto err:", String(e).slice(0, 120)));
await page.waitForTimeout(1_200);
let lockStill = await page.locator('input[placeholder="رمز عبور"]').isVisible().catch(() => false);
console.log("  [dbg] lock after re-entry at canonical URL:", lockStill);
if (lockStill) {
  await page.reload({ waitUntil: "networkidle" }).catch((e) => console.log("  [dbg] reload err:", String(e).slice(0, 120)));
  await page.waitForTimeout(1_200);
  lockStill = await page.locator('input[placeholder="رمز عبور"]').isVisible().catch(() => false);
}
const secAfterReload = await page.evaluate(() => localStorage.getItem("customer2.security"));
console.log("  [dbg] security storage after reload:", secAfterReload ? secAfterReload.slice(0, 90) : "NULL");
ok("C11. بازآوری صفحه از قفل فرار نمی‌کند", lockStill);

// C12: wrong password → shake message + attempt counter
await lockInput.fill("wrong-pass");
await lockInput.press("Enter");
await page.waitForTimeout(500);
ok("C12. رمز نادرست → پیام خطا",
  await page.getByText("رمز عبور نادرست است").first().isVisible().catch(() => false));
await lockInput.fill("12345");
await lockInput.press("Enter");
await page.waitForTimeout(400);
trap = await secState();
ok("C13. تلاش‌های ناموفق شمرده می‌شوند", trap.failedAttempts === 2, `failed=${trap.failedAttempts}`);

// C13b: Escape / Tab can't dismiss or escape the lock
await page.keyboard.press("Escape");
await page.keyboard.press("Tab");
ok("C13b. Escape/Tab قفل را نمی‌بندند", await lockInput.isVisible().catch(() => false));

// C14: the real password unlocks → trap fully ends, cache restored
await lockInput.fill("Mazari1234$$$");
await lockInput.press("Enter");
let confirmShown = true;
try {
  await page.getByText("رمز صحیح").first().waitFor({ timeout: 2_500 });
} catch {
  confirmShown = false;
}
ok("C14. پیام تأیید رمز صحیح", confirmShown);
await page.waitForTimeout(2_500); // auto reload
await page.waitForLoadState("networkidle").catch(noop);
const finalTrap = await secState();
ok("C15. پس از قفل‌گشایی: تله پایان یافت و کش به حالت قبل برگشت",
  finalTrap?.anomaly === null && finalTrap?.locked === false && finalTrap?.cacheOff === false,
  JSON.stringify(finalTrap));
st = await waitFor(async () => (await pwaState()).sw >= 1 ? pwaState() : null, 25_000);
ok("C16. سرویس‌ورکر پس از پایان تله دوباره ثبت شد", st.sw >= 1, `sw=${st.sw}`);

// C17: after everything, the console needs the combo again (grant was revoked)
await page.goto(`${BASE}/sec-console`, { waitUntil: "networkidle" });
ok("C17. ورود مستقیم به کنسول بدون مجوز → بازگشت به برنامه", !page.url().includes("/sec-console"));

/* ======================= D. sanity + summary ============================ */

console.log("\n--- D. سلامت کلی ---");
await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
ok("D1. صفحه مشتریان همچنان کار می‌کند", await page.locator("main").first().isVisible().catch(() => false));
ok("D2. هیچ خطای کنسولی نیست", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n========== ${results.length - failed.length}/${results.length} PASS ==========`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" · "));
  process.exit(1);
}
