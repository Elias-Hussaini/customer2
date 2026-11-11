/* eslint-disable */
/**
 * QA round 22 — the user's asks:
 *
 *  A. نماینده sync: changing the customer's PROFILE representative re-points
 *     their visa requests (toast reports how many), EXCEPT requests whose rep
 *     was manually changed inside the request form (sticky override) — and
 *     setting the request's rep back to the profile's clears the override.
 *  B. Historical repair: stale rows (profile rep ≠ request rep) are synced
 *     once at startup by the prefs-guarded backfill.
 *  C. پروفایل نمایندگان → مشتریان tab: the SAME personalization filter panel
 *     (search / لیست / وضعیت / مرتب‌سازی, remembered per device) + customer
 *     TAGS beside the passport number.
 *  D. پنل کارفرما: the employer's customer list gets the same filters
 *     (نماینده / لیست / وضعیت / مرتب‌سازی) + tags beside passports.
 *  E. نمایندگان list page: filter panel (وضعیت / کارفرما / مرتب‌سازی).
 *  F. ابزار عکس: back button in the header.
 *  G. Mobile 390px zero overflow + zero console errors.
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

/** Read one request row straight from IndexedDB. */
async function getRequest(id) {
  return page.evaluate(
    (rid) =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("requests", "readonly");
          const get = tx.objectStore("requests").get(rid);
          get.onsuccess = () => {
            db.close();
            resolve(get.result || null);
          };
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
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
}

/** The round-22 seed: 3 reps, 2 lists, 1 employer, 3 customers, 4 requests,
 *  2 tags — a faithful miniature of the user's stale-rep world. */
async function seedWorld() {
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const put = (store, value) => new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const now = Date.now();
    await put("representatives", { id: "rep-old", name: "نماینده قدیمی", createdAt: 1, updatedAt: 1 });
    await put("representatives", { id: "rep-new", name: "نماینده جدید", createdAt: 2, updatedAt: 2 });
    await put("representatives", { id: "rep-third", name: "نماینده سوم", createdAt: 3, updatedAt: 3 });
    await put("lists", { id: "list-a", name: "لیست الف", createdAt: 1, updatedAt: 1, parentId: null });
    await put("lists", { id: "list-b", name: "لیست ب", createdAt: 2, updatedAt: 2, parentId: null });
    await put("employers", { id: "emp-1", name: "کارفرما تست", createdAt: 1, updatedAt: 1 });
    await put("tags", { id: "tag-urgent", name: "فوری", color: "#dc3535", isUrgent: true, createdAt: 1, updatedAt: 1 });
    await put("tags", { id: "tag-n", name: "تست‌صفر", color: "#2563eb", isUrgent: false, createdAt: 2, updatedAt: 2 });
    const cust = (id, first, last, passport, rep, list, employer, at) =>
      put("customers", { id, firstName: first, lastName: last, passportNo: passport, representativeId: rep, listId: list, employerId: employer, registrationDate: "2026-02-01", createdAt: at, updatedAt: at });
    await cust("c1", "علی", "رضایی", "PA1234", "rep-old", "list-a", "emp-1", 100);
    await cust("c2", "رضا", "کریمی", "PB5678", "rep-old", "list-a", "emp-1", 200);
    await cust("c3", "حسین", "احمدی", "PC9012", "rep-old", "list-b", null, 300);
    const reqRow = (id, cid, rep, list, tags, issued, at) =>
      put("requests", { id, customerId: cid, representativeId: rep, listId: list, tags, issued, issuedAt: issued ? "2026-02-10" : null, registrationDate: "2026-02-02", createdAt: at, updatedAt: at });
    await reqRow("r1", "c1", "rep-old", "list-a", ["tag-urgent"], false, 10);
    await reqRow("r2", "c1", "rep-old", "list-a", [], true, 11);
    await reqRow("r3", "c2", "rep-old", "list-a", ["tag-n"], false, 12);
    await reqRow("r4", "c3", "rep-old", "list-b", [], false, 13);
    db.close();
  });
}

/** Open a SearchSelect (by the current label on its combobox) and pick an option. */
async function pickSearchSelect(currentLabel, optionText) {
  await page.locator(`button.field`, { hasText: currentLabel }).first().click();
  await sleep(600);
  await page.locator(`[data-floating-panel] button`, { hasText: optionText }).last().click();
  await sleep(400);
}

/** Edit a customer's profile representative via the profile form. */
async function changeCustomerRep(customerId, currentRepName, newRepName) {
  await page.goto(`${BASE}customers/${customerId}`, { waitUntil: "networkidle" });
  await sleep(900);
  await page.locator('button:text-is("ویرایش")').first().click();
  await sleep(900);
  await pickSearchSelect(currentRepName, newRepName);
  await page.locator('button:text-is("ذخیره تغییرات")').first().click();
  await sleep(1300);
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 3000));

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
  await sleep(1200);
  await clearTables();
  await seedWorld();
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1600);

  /* ==================== A — profile rep change syncs requests ==================== */

  // No false positives at startup: everything still under قدیمی.
  let r1 = await getRequest("r1");
  ok("A0: seeded world intact (r1 under قدیمی)", r1 && r1.representativeId === "rep-old", r1?.representativeId);

  // Change c1's PROFILE rep قدیمی → جدید via the customer form.
  await changeCustomerRep("c1", "نماینده قدیمی", "نماینده جدید");
  let body = await textOf();
  ok("A1: toast reports the synced requests", body.includes("۲ درخواست ویزای این مشتری هم به نمایندهٔ جدید"), body.match(/درخواست ویزای این مشتری[^\n]*/)?.[0] ?? "-");
  r1 = await getRequest("r1");
  const r2 = await getRequest("r2");
  ok("A2: both c1 requests now under جدید (r1, r2)", r1.representativeId === "rep-new" && r2.representativeId === "rep-new", `${r1.representativeId} / ${r2.representativeId}`);
  const r3 = await getRequest("r3");
  const r4 = await getRequest("r4");
  ok("A3: OTHER customers untouched (r3, r4 still قدیمی)", r3.representativeId === "rep-old" && r4.representativeId === "rep-old", `${r3.representativeId} / ${r4.representativeId}`);

  // The customer profile page itself shows the new rep on its requests table.
  body = await textOf();
  ok("A4: customer profile table shows نماینده جدید rows", body.includes("نماینده جدید"), "table text check");

  // Manual override INSIDE the request form: r1 → back to قدیمی.
  await page.goto(`${BASE}requests/r1/edit`, { waitUntil: "networkidle" });
  await sleep(1100);
  await pickSearchSelect("نماینده جدید", "نماینده قدیمی");
  await page.locator('button:text-is("ذخیره")').first().click();
  await sleep(1300);
  r1 = await getRequest("r1");
  ok("A5: manual change inside the request form sticks (r1 → قدیمی, override stamped)", r1.representativeId === "rep-old" && r1.repOverride === true, `${r1.representativeId} override=${r1.repOverride}`);

  // Profile changes again (جدید → سوم): override keeps قدیمی, follower moves to سوم.
  await changeCustomerRep("c1", "نماینده جدید", "نماینده سوم");
  r1 = await getRequest("r1");
  const r2b = await getRequest("r2");
  ok("A6: overridden r1 KEEPS قدیمی", r1.representativeId === "rep-old", r1.representativeId);
  ok("A7: follower r2 moves to سوم", r2b.representativeId === "rep-third", r2b.representativeId);

  // Setting the request back to the profile's rep clears the override.
  await page.goto(`${BASE}requests/r1/edit`, { waitUntil: "networkidle" });
  await sleep(1100);
  await pickSearchSelect("نماینده قدیمی", "نماینده سوم");
  await page.locator('button:text-is("ذخیره")').first().click();
  await sleep(1300);
  r1 = await getRequest("r1");
  ok("A8: matching the profile again clears the override (r1 → سوم, follows again)", r1.representativeId === "rep-third" && !r1.repOverride, `${r1.representativeId} override=${r1.repOverride}`);

  /* ========================= B — historical backfill ========================== */

  // Simulate a legacy stale row: r2 still under سوم's profile but its request
  // says قدیمی — then a fresh start (prefs cleared) repairs it once.
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const row = await new Promise((res) => { const g = db.transaction("requests", "readonly").objectStore("requests").get("r2"); g.onsuccess = () => res(g.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("requests", "readwrite");
      tx.objectStore("requests").put({ ...row, representativeId: "rep-old", updatedAt: 999 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await clearPrefs();
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1800);
  const r2c = await getRequest("r2");
  ok("B1: stale legacy row repaired to the profile rep at startup (r2 → سوم)", r2c.representativeId === "rep-third", r2c.representativeId);
  // Second start must NOT re-repair (flag set): sabotage + reload stays.
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const row = await new Promise((res) => { const g = db.transaction("requests", "readonly").objectStore("requests").get("r2"); g.onsuccess = () => res(g.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("requests", "readwrite");
      tx.objectStore("requests").put({ ...row, representativeId: "rep-old" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1600);
  const r2d = await getRequest("r2");
  ok("B2: backfill runs exactly once (sabotaged row left alone)", r2d.representativeId === "rep-old", r2d.representativeId);

  // Undo the sabotage so later expectations stay clean (r2 back under سوم).
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const row = await new Promise((res) => { const g = db.transaction("requests", "readonly").objectStore("requests").get("r2"); g.onsuccess = () => res(g.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("requests", "readwrite");
      tx.objectStore("requests").put({ ...row, representativeId: "rep-third" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  /* =================== C — rep profile مشتریان tab: filters + tags =================== */

  await page.goto(`${BASE}representatives/rep-old`, { waitUntil: "networkidle" });
  await sleep(1000);
  await page.locator('[role="tablist"] [role="tab"]', { hasText: "مشتریان" }).first().click();
  await sleep(900);
  body = await textOf();
  const repFilterPanel = await countOf("[data-rep-customers] [data-customer-filters]");
  ok("C1: filter panel present on the rep profile", repFilterPanel === 1, `panels=${repFilterPanel}`);
  ok("C1b: panel has search + وضعیت + مرتب‌سازی (and لیست)", body.includes("همه وضعیت‌ها") && body.includes("جدیدترین") && body.includes("همه لیست‌ها"), "selects present");
  const repNoRepFilter = !(await page.locator('[data-rep-customers] select[aria-label="نماینده"]').count());
  ok("C1c: نماینده filter hidden inside a rep's own profile", repNoRepFilter === true);

  // Status filter: c2 (r3 pending) + c3 (r4 pending) → 2 cards; issued → none.
  await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').selectOption({ label: "در حال کار" });
  await sleep(700);
  body = await textOf();
  ok("C2: وضعیت=در حال کار keeps both pending customers", body.includes("رضا کریمی") && body.includes("حسین احمدی") && body.includes("۲ مشتری"), body.match(/مشتری[^\n]*/)?.[0] ?? "-");
  await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').selectOption({ label: "ویزا صادر شده" });
  await sleep(700);
  body = await textOf();
  ok("C3: وضعیت=صادر شده → empty hint (no issued under قدیمی anymore)", body.includes("با این فیلترها مشتری‌ای پیدا نشد"), body.slice(0, 60));
  await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').selectOption({ label: "همه وضعیت‌ها" });
  await sleep(600);

  // Search narrows to one customer; tags show beside the passport.
  await page.locator('[data-rep-customers] input[placeholder="نام یا شماره پاسپورت مشتری…"]').fill("رضا");
  await sleep(700);
  body = await textOf();
  ok("C4: search «رضا» keeps only رضا کریمی", body.includes("رضا کریمی") && !body.includes("حسین احمدی") && body.includes("۱ مشتری"), body.match(/مشتری[^\n]*/)?.[0] ?? "-");
  const card2 = page.locator("[data-rep-customers] a", { hasText: "رضا کریمی" });
  const card2Text = (await card2.innerText().catch(() => "")) || "";
  ok("C5: TAG badge shown beside the passport on the rep profile card", card2Text.includes("PB5678") && card2Text.includes("تست‌صفر"), card2Text.replace(/\n/g, " | "));

  // Persistence: dropdown filters survive a reload (like the مشتریان page —
  // the transient search text is not kept, only the selects).
  await page.locator('[data-rep-customers] input[placeholder="نام یا شماره پاسپورت مشتری…"]').fill("");
  await sleep(400);
  await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').selectOption({ label: "رد شده" });
  await sleep(600);
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1300);
  await page.locator('[role="tablist"] [role="tab"]', { hasText: "مشتریان" }).first().click();
  await sleep(900);
  const statusVal = await page.locator('[data-rep-customers] select[aria-label="وضعیت ویزا"]').inputValue();
  ok("C6: وضعیت filter survives reload (remembered per device)", statusVal === "rejected", statusVal);
  body = await textOf();
  ok("C6b: filtered to zero customers with the remembered filter", body.includes("با این فیلترها مشتری‌ای پیدا نشد"), "");
  await page.locator("[data-rep-customers] button", { hasText: "پاک‌کردن فیلترها" }).first().click();
  await sleep(700);
  body = await textOf();
  ok("C7: پاک‌کردن فیلترها restores both customers", body.includes("رضا کریمی") && body.includes("حسین احمدی"), "");

  /* ================== D — employer panel: filters + tags beside passport ================== */

  await page.goto(`${BASE}employers/emp-1`, { waitUntil: "networkidle" });
  await sleep(1100);
  body = await textOf();
  ok("D1: employer panel has the filter panel", (await countOf("[data-employer-customers] [data-customer-filters]")) === 1);
  ok("D1b: both linked customers show", body.includes("علی رضایی") && body.includes("رضا کریمی"), "");
  const empRepSelect = await page.locator('[data-employer-customers] select[aria-label="نماینده"]').count();
  const empEmpSelect = await page.locator('[data-employer-customers] select[aria-label="کارفرما"]').count();
  ok("D1c: نماینده filter present, کارفرما filter hidden in the employer panel", empRepSelect === 1 && empEmpSelect === 0, `${empRepSelect}/${empEmpSelect}`);

  // Tags beside passport in the employer panel.
  const empCard2 = page.locator("[data-employer-customers] a", { hasText: "رضا کریمی" });
  const empCard2Text = (await empCard2.innerText().catch(() => "")) || "";
  ok("D2: tag badge beside the passport in the employer panel", empCard2Text.includes("PB5678") && empCard2Text.includes("تست‌صفر"), empCard2Text.replace(/\n/g, " | "));

  // Rep filter: c1 is under سوم now, c2 under قدیمی.
  await page.locator('[data-employer-customers] select[aria-label="نماینده"]').selectOption({ label: "نماینده سوم" });
  await sleep(700);
  body = await textOf();
  ok("D3: نماینده=سوم keeps only علی رضایی + shows rep meta", body.includes("علی رضایی") && !body.includes("رضا کریمی") && body.includes("نماینده: نماینده سوم"), body.match(/نماینده: [^\n]*/)?.[0] ?? "-");
  await page.locator("[data-employer-customers] button", { hasText: "پاک‌کردن فیلترها" }).first().click();
  await sleep(600);

  /* ==================== E — نمایندگان list page filter panel ==================== */

  await page.goto(`${BASE}representatives`, { waitUntil: "networkidle" });
  await sleep(1100);
  ok("E1: reps page filter panel present", (await countOf("[data-reps-filters]")) === 1);
  body = await textOf();
  ok("E1b: وضعیت + کارفرما + مرتب‌سازی selects", body.includes("همه وضعیت‌ها") && body.includes("همه کارفرماها") && body.includes("الفبا"), "");

  // Sort by most requests: قدیمی has r3+r4 = 2; سوم has r1+r2 = 2; جدید 0 →
  // tie falls back to the Persian name order.
  await page.locator('[data-reps-filters] select[aria-label="مرتب‌سازی"]').selectOption({ label: "بیشترین درخواست" });
  await sleep(700);
  const firstRep = await page.locator(".glass.group .text-\\[14px\\]").first().innerText().catch(() => "");
  ok("E2: sort=بیشترین درخواست puts a 2-request rep first", ["نماینده قدیمی", "نماینده سوم"].includes(firstRep.trim()), firstRep.trim());

  // Status filter: بدون درخواست → only جدید.
  await page.locator('[data-reps-filters] select[aria-label="وضعیت درخواست‌ها"]').selectOption({ label: "بدون درخواست" });
  await sleep(700);
  body = await textOf();
  ok("E3: وضعیت=بدون درخواست keeps only نماینده جدید", body.includes("نماینده جدید") && !body.includes("نماینده قدیمی") && !body.includes("نماینده سوم"), "");
  ok("E3b: پاک‌کردن فیلترها visible", body.includes("پاک‌کردن فیلترها"));
  await page.locator('[data-reps-filters] button', { hasText: "پاک‌کردن فیلترها" }).first().click();
  await sleep(600);
  body = await textOf();
  ok("E4: clearing restores all three reps", body.includes("نماینده قدیمی") && body.includes("نماینده جدید") && body.includes("نماینده سوم"), "");

  /* ============================ F — studio back button ========================= */

  await clickDock("ابزار عکس");
  await sleep(800);
  const studioBack = await page.locator('button[aria-label="بازگشت"]').count();
  ok("F1: ابزار عکس has a back button", studioBack >= 1, `count=${studioBack}`);
  await page.locator('button[aria-label="بازگشت"]').first().click();
  await sleep(900);
  body = await textOf();
  ok("F2: back navigates to the previous page (نمایندگان)", body.includes("نماینده فعال") || body.includes("نمایندگان"), body.slice(0, 50));

  /* ============================ G — mobile + clean ============================= */

  await page.setViewportSize({ width: 390, height: 800 });
  await sleep(900);
  const overflow = await page.evaluate(() => Math.max(0, document.scrollingElement.scrollWidth - 390));
  ok("G1: mobile 390px — zero horizontal overflow", overflow === 0, `overflow=${overflow}px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  ok("G2: zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  /* --------------------------------- wrap ---------------------------------- */

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  await browser.close();
  server.kill();
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
