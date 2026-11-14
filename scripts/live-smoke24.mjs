/**
 * LIVE smoke — Round 24, on the DEPLOYED site (ephemeral browser context:
 * fresh IndexedDB inside this throwaway profile — the user's own device data
 * is never touched).
 *
 * Verifies on https://elias-hussaini.github.io/customer2/:
 *   1. the deployed bundle carries the new form hint,
 *   2. registering a NEW customer (simultaneous request ON) → stage1 «مرحله اول»,
 *   3. a pre-seeded «already registered» row (stage4@111) stays byte-identical,
 *   4. zero console errors, and the pills render in the customers list.
 */
import { chromium } from "playwright";

const LIVE = "https://elias-hussaini.github.io/customer2/";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const asset404 = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => {
  // GitHub Pages has no server rewrite: deep links (/customers…) are served
  // by the 404.html SPA fallback — the DOCUMENT answers 404 while still
  // booting the app. Only ASSET 404s are real breakage.
  if (r.status() === 404 && r.request().resourceType() !== "document") {
    asset404.push(r.url());
  }
});
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) {
    errors.push(m.text());
  }
});

await page.goto(LIVE, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

/* -------- seed a minimal fixture straight into IndexedDB, then reload ------- */
const seedOk = await page.evaluate(async () => {
  try {
    const d = await new Promise((resolve, reject) => {
      const req = indexedDB.open("customer2-visa");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    await new Promise((res, rej) => {
      const tx = d.transaction(
        ["representatives", "lists", "visaTypes", "customers"],
        "readwrite",
      );
      tx.objectStore("representatives").put({
        id: "lr1", name: "لیو رپ", phone: "", createdAt: now, updatedAt: now,
      });
      tx.objectStore("lists").put({
        id: "ll1", name: "لیو لیست", createdAt: now, updatedAt: now,
      });
      tx.objectStore("visaTypes").put({
        id: "lvt1", name: "لیو ویزا", createdAt: now, updatedAt: now,
      });
      // The «already registered» row: stored stage4, frozen updatedAt — must
      // stay byte-identical through the whole smoke.
      tx.objectStore("customers").put({
        id: "lc1",
        firstName: "قدیمی",
        lastName: "ثبتی",
        passportNo: "LIVEOLD1",
        representativeId: "lr1",
        listId: "ll1",
        registrationDate: "2026-11-01",
        stage: "stage4",
        createdAt: 1,
        updatedAt: 111,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    d.close();
    return true;
  } catch (e) {
    return false;
  }
});
ok("live: fixture seeded (rep/list/visaType + one stage4 row)", seedOk);

await page.goto(`${LIVE}customers`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

/* --------------------- register a NEW customer via the UI ------------------- */
await page.getByRole("button", { name: "مشتری جدید" }).first().click();
await page.waitForSelector("text=ثبت همزمان درخواست ویزا", { timeout: 15000 });

ok(
  "live bundle: new form hint renders («مرحلهٔ مشتری از «مرحله اول» شروع می‌شود»)",
  (await page.locator('text=مرحلهٔ مشتری از «مرحله اول» شروع می‌شود').count()) === 1,
);

const pickFromPanel = (text) =>
  page.locator(`[data-floating-panel] button:has-text("${text}")`).first().click();
await page.locator('button:has-text("انتخاب نماینده…")').first().click();
await page.waitForTimeout(400);
await pickFromPanel("لیو رپ");
await page.locator('button:has-text("انتخاب لیست…")').first().click();
await page.waitForTimeout(400);
await pickFromPanel("لیو لیست");
await page.getByPlaceholder("مثلاً زهرا").fill("لیو");
await page.getByPlaceholder("مثلاً موسوی").fill("نوین");
await page.getByPlaceholder("A12345678").fill("LIVENEW1");
// visa type: the seeded one shows up in the panel
await page.locator('button:has-text("انتخاب یا ساخت…")').first().click();
await page.waitForTimeout(400);
await pickFromPanel("لیو ویزا");
await page.getByRole("button", { name: "ثبت مشتری" }).click();
await page.waitForSelector("text=ثبت همزمان", { state: "detached" });

/* ------------------------------ DB assertions -------------------------------- */
const dbState = await page.evaluate(async () => {
  const d = await new Promise((resolve, reject) => {
    const req = indexedDB.open("customer2-visa");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const customers = await new Promise((res) => {
    const rq = d.transaction(["customers"]).objectStore("customers").getAll();
    rq.onsuccess = () => res(rq.result);
  });
  const requests = await new Promise((res) => {
    const rq = d.transaction(["requests"]).objectStore("requests").getAll();
    rq.onsuccess = () => res(rq.result);
  });
  d.close();
  return {
    fresh: customers.find((c) => c.passportNo === "LIVENEW1") ?? null,
    old: customers.find((c) => c.id === "lc1") ?? null,
    freshRequests: requests.filter((r) => r.customerId === (customers.find((c) => c.passportNo === "LIVENEW1") ?? {}).id),
  };
});
ok(
  "live: NEW customer starts at «مرحله اول» (stage1)",
  dbState.fresh?.stage === "stage1",
  `stage=${dbState.fresh?.stage}`,
);
ok(
  "live: the simultaneous request exists (pending, with visa type)",
  dbState.freshRequests.length === 1 &&
    dbState.freshRequests[0].issued === false &&
    !!dbState.freshRequests[0].visaType,
  JSON.stringify(dbState.freshRequests.map((r) => ({ t: r.visaType, issued: r.issued }))),
);
ok(
  "live: already-registered row untouched (stage4 + updatedAt 111)",
  dbState.old?.stage === "stage4" && dbState.old?.updatedAt === 111,
  `stage=${dbState.old?.stage}@${dbState.old?.updatedAt}`,
);

/* ------------------------------ UI assertions -------------------------------- */
await page.goto(`${LIVE}customers`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
ok(
  "live: «مرحله اول» pill on the new row",
  (await page.locator("tr", { hasText: "لیو نوین" }).locator("text=مرحله اول").count()) === 1,
);
ok(
  "live: old row still shows «ثبت شده برای ویزا»",
  (await page.locator("tr", { hasText: "قدیمی ثبتی" }).locator("text=ثبت شده برای ویزا").count()) === 1,
);
await page.screenshot({ path: "/home/z/my-project/qa/round24/live-after.png" });
ok(
  "live: zero console errors (SPA-fallback document 404s excluded)",
  errors.length === 0 && asset404.length === 0,
  [...errors, ...asset404].slice(0, 3).join(" | "),
);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\nLIVE ROUND 24: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
