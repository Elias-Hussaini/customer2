/* eslint-disable */
/**
 * QA round 21 — the user's four asks:
 *
 *  A. Editor «برش و سایز» gains a one-tap ۸۰۰×۶۰۰ preset (free ratio lock,
 *     applied instantly).
 *  B. Profile photos: as soon as one is SET — manually (file picker) — it
 *     converts to 400×600 (نسبت آزاد); the toggle lives in تنظیمات and is ON
 *     by default; OFF restores the classic 256×256 square; the studio editor
 *     pre-arms 400×600/free when editing an avatar.
 *  C. The recall arrow + Backspace now exist in EVERY search field, not just
 *     the studio lists: global top-bar search + the shared SearchBox (customers
 *     page) + the library search — appear on focus, step back through what was
 *     typed there before.
 *  D. کتابخانهٔ ابزار عکس is the SAME Windows-style explorer as لیست‌ها:
 *     nested folders, breadcrumb + back, grid/list views, «سایر», and rich
 *     drag & drop (image→crumb, image→folder tile, multi-select batch move,
 *     folder→folder nesting, OS files onto a tile) with safe deletes.
 *  E. Mobile 390px: no horizontal overflow; zero console errors everywhere.
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

/** A PNG of any size, generated inside the page (valid, decodable). */
async function pngB64(w, h, color = "#3366aa") {
  return page.evaluate(
    ({ w, h, color }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(4, 4, 10, 10);
      return c.toDataURL("image/png").split(",")[1];
    },
    { w, h, color },
  );
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

async function seedCustomers() {
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

/** Natural dimensions of the first <img alt="…"> matching the name. */
async function avatarDims(name) {
  return page.evaluate(async (altName) => {
    const img = Array.from(document.querySelectorAll("img")).find((i) => i.alt === altName);
    if (!img) return null;
    if (!img.complete || !img.naturalWidth) {
      await new Promise((res) => {
        if (img.complete) res();
        else img.addEventListener("load", () => res(), { once: true });
        setTimeout(res, 3000);
      });
    }
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, name);
}

const gsInput = () => page.locator("input[data-global-search]");
const gsArrow = () => page.locator('input[data-global-search] ~ button[aria-label="جستجوی قبلی"]');
const custInput = () => page.locator('input[placeholder="نام، شماره پاسپورت یا معرف…"]');
const custArrow = () => page.locator('input[placeholder="نام، شماره پاسپورت یا معرف…"] ~ button[aria-label="جستجوی قبلی"]');
const libInput = () => page.locator('input[placeholder="جستجوی نام تصویر…"]');
const libArrow = () => page.locator('input[placeholder="جستجوی نام تصویر…"] ~ button[aria-label="جستجوی قبلی"]');
const crumb = (label) => page.locator('nav[aria-label="مسیر پوشه"] button', { hasText: label }).first();
const tile = (name) => page.locator(`button[aria-label="باز کردن پوشه ${name}"]`).first();
const backBtn = () => page.locator('button[aria-label="بازگشت"]');

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

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1200);
  await clearTables();
  await seedCustomers();

  /* ============================ A — 800×600 preset ============================ */

  await clickDock("ابزار عکس");
  const pngA = await pngB64(200, 100);
  await page.setInputFiles('input[accept="image/*,.pdf"]', {
    name: "test-a.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngA, "base64"),
  });
  await sleep(1300);
  let dims = await page.locator("p.num[dir='ltr']").first().innerText();
  ok("A1: editor loads the 200×100 source", dims.includes("200×100"), dims);

  await page.locator("button", { hasText: "۸۰۰×۶۰۰" }).first().click();
  await sleep(900);
  dims = await page.locator("p.num[dir='ltr']").first().innerText();
  ok("A2: one tap → resized to exactly 800×600", dims.includes("800×600"), dims);

  const lockTxt = await page.locator('button[title="نسبت آزاد"], button[title="قفل نسبت فعال"]').first().innerText();
  ok("A3: ratio lock switched to آزاد", lockTxt.includes("نسبت آزاد"), lockTxt);

  const wVal = await page.locator("label", { hasText: "عرض (px)" }).locator("input").inputValue();
  const hVal = await page.locator("label", { hasText: "ارتفاع (px)" }).locator("input").inputValue();
  ok("A4: W/H inputs show 800/600", wVal === "800" && hVal === "600", `${wVal}×${hVal}`);

  /* ===================== B — profile photo auto 400×600 ====================== */

  await page.goto(`${BASE}customers/qa-cust`, { waitUntil: "networkidle" });
  await sleep(1000);
  const pngB = await pngB64(300, 300, "#a35b5b");
  await page.setInputFiles('input[accept="image/*"]', {
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngB, "base64"),
  });
  await sleep(1600);
  let d = await avatarDims("علی رضایی");
  ok("B1: manual profile photo → stored as 400×600 (default ON)", d && d.w === 400 && d.h === 600, d ? `${d.w}×${d.h}` : "no img");

  // «ویرایش عکس» opens the studio with the resize panel pre-armed 400×600/free
  await page.locator("button", { hasText: "ویرایش عکس" }).first().click();
  await sleep(1600);
  const pw = await page.locator("label", { hasText: "عرض (px)" }).locator("input").inputValue();
  const ph = await page.locator("label", { hasText: "ارتفاع (px)" }).locator("input").inputValue();
  const pLock = await page.locator('button[title="نسبت آزاد"], button[title="قفل نسبت فعال"]').first().innerText();
  ok("B2: avatar in studio → panel pre-armed 400×600 آزاد", pw === "400" && ph === "600" && pLock.includes("نسبت آزاد"), `${pw}×${ph} ${pLock}`);

  // Toggle OFF in تنظیمات → back to the classic 256 square
  await page.goto(`${BASE}settings?tab=defaults`, { waitUntil: "networkidle" });
  await sleep(900);
  // C-toggle locator: the rounded row card that holds the title + switch
  const photoSwitch = () =>
    page.locator("div.rounded-2xl").filter({ hasText: "اندازهٔ استاندارد عکس پروفایل" }).first().getByRole("switch");
  let checked = await photoSwitch().getAttribute("aria-checked");
  ok("B3: toggle exists and is ON by default", checked === "true", `aria-checked=${checked}`);
  await photoSwitch().click();
  await sleep(700);
  checked = await photoSwitch().getAttribute("aria-checked");
  ok("B4: toggle switches OFF", checked === "false", `aria-checked=${checked}`);

  await page.goto(`${BASE}customers/qa-cust`, { waitUntil: "networkidle" });
  await sleep(900);
  const pngC = await pngB64(500, 200, "#5b8da3");
  await page.setInputFiles('input[accept="image/*"]', {
    name: "avatar2.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngC, "base64"),
  });
  await sleep(1600);
  d = await avatarDims("علی رضایی");
  ok("B5: with the toggle OFF → classic 256×256 square", d && d.w === 256 && d.h === 256, d ? `${d.w}×${d.h}` : "no img");

  // Back ON (leave the app in its default state)
  await page.goto(`${BASE}settings?tab=defaults`, { waitUntil: "networkidle" });
  await sleep(800);
  await page.locator("div.rounded-2xl").filter({ hasText: "اندازهٔ استاندارد عکس پروفایل" }).first().getByRole("switch").click();
  await sleep(600);

  /* ===================== C — recall arrow in every field ===================== */

  // C1 — global search (top bar)
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(900);
  await gsInput().click();
  ok("C1a: no arrow before any history", (await countOf('input[data-global-search] ~ button[aria-label="جستجوی قبلی"]')) === 0);
  await gsInput().fill("احمدی");
  await sleep(300);
  await gsInput().press("Enter"); // commits + navigates to /search
  await sleep(1200);
  await page.goBack();
  await sleep(1200);
  await gsInput().click();
  await sleep(300);
  ok("C1b: arrow appears on focus after history", (await gsArrow().count()) === 1);
  await gsArrow().click();
  await sleep(300);
  let v = await gsInput().inputValue();
  ok("C1c: arrow recalls the previous query", v === "احمدی", v);

  // C2 — the shared SearchBox (customers page filter)
  await clickDock("مشتریان");
  await custInput().fill("رضایی");
  await custInput().press("Enter"); // commit
  await sleep(400);
  await custInput().fill(""); // still focused → arrow visible
  await sleep(300);
  ok("C2a: customers filter shows the arrow", (await custArrow().count()) === 1);
  await custArrow().click();
  await sleep(300);
  v = await custInput().inputValue();
  ok("C2b: arrow recalls «رضایی»", v === "رضایی", v);
  await custInput().fill("");
  await sleep(200);
  await custInput().press("Backspace"); // backspace on the empty field
  await sleep(300);
  v = await custInput().inputValue();
  ok("C2c: Backspace on the empty field recalls too", v === "رضایی", v);

  // C3 — studio library search (Backspace path)
  await clickDock("ابزار عکس");
  await page.locator('[role="tab"]', { hasText: "کتابخانه" }).first().click();
  await sleep(900);
  await libInput().fill("عکس");
  await libInput().press("Enter");
  await sleep(300);
  await libInput().fill("");
  await sleep(200);
  await libInput().press("Backspace");
  await sleep(300);
  v = await libInput().inputValue();
  ok("C3: library search recalls via Backspace", v === "عکس", v);

  /* =================== D — Windows-style explorer library ==================== */

  // Seed folders + images straight into IndexedDB (blobs built in-page).
  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => { const r = indexedDB.open("customer2-visa"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const db = await open();
    const put = (store, value) => new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const mkBlob = (w, h, color) => new Promise((resolve) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      c.toBlob((b) => resolve(b), "image/jpeg", 0.8);
    });
    await put("studioFolders", { id: "f-w", name: "ویزا", parentId: null, createdAt: 1, updatedAt: 1 });
    await put("studioFolders", { id: "f-m", name: "مدارک", parentId: "f-w", createdAt: 2, updatedAt: 2 });
    await put("studioFolders", { id: "f-a", name: "آرشیو", parentId: null, createdAt: 3, updatedAt: 3 });
    const mk = async (id, folderId, name, w, h, color, at) => {
      const blob = await mkBlob(w, h, color);
      await put("studioImages", { id, folderId, name, mime: "image/jpeg", size: blob.size, blob, width: w, height: h, createdAt: at, updatedAt: at });
    };
    await mk("i-1", "f-m", "عکس-یک.jpg", 100, 80, "#aa3333", 10);
    await mk("i-2", "f-m", "عکس-دو.jpg", 90, 70, "#33aa55", 11);
    await mk("i-3", "f-w", "آزاد-سه.jpg", 60, 60, "#3355aa", 12);
    await mk("i-4", null, "آزاد-چهار.jpg", 50, 50, "#aaaa33", 13);
    db.close();
  });
  // Raw IDB writes don't wake Dexie live queries — reload to see the seed.
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1500);
  await clickDock("ابزار عکس");
  await page.locator('[role="tab"]', { hasText: "کتابخانه" }).first().click();
  await sleep(1200);

  let body = await textOf();
  ok("D1: root shows folder tiles + سایر + counts", body.includes("ویزا") && body.includes("آرشیو") && body.includes("سایر") && body.includes("همه: ۴ تصویر"), body.match(/همه: [^\n]*/)?.[0] ?? "");
  ok("D1b: back disabled at root", (await backBtn().isDisabled()) === true);

  // navigate into ویزا → مدارک
  await tile("ویزا").click();
  await sleep(700);
  body = await textOf();
  ok("D2: breadcrumb خانه › ویزا + زیرپوشهٔ مدارک tile (۲ تصویر)", body.includes("ویزا") && (await countOf('button[aria-label="باز کردن پوشه مدارک"]')) === 1 && body.includes("۲ تصویر"));
  ok("D2b: ویزا shows its direct image as a card", body.includes("آزاد-سه"));

  await tile("مدارک").click();
  await sleep(700);
  body = await textOf();
  ok("D3: inside مدارک — 2 images", body.includes("عکس-یک") && body.includes("عکس-دو"));

  // drag عکس-یک onto the «ویزا» crumb → moves there
  const cardOne = page.locator("div.glass", { hasText: "عکس-یک" }).first();
  await cardOne.dragTo(crumb("ویزا"));
  await sleep(1100);
  body = await textOf();
  ok("D4: image dragged onto the breadcrumb crumb moved out", !body.includes("عکس-یک"));

  // drag عکس-دو onto «خانه» → becomes unfiled
  const cardTwo = page.locator("div.glass", { hasText: "عکس-دو" }).first();
  await cardTwo.dragTo(crumb("خانه"));
  await sleep(1100);
  body = await textOf();
  ok("D5: dragging onto خانه unfiles the image (folder empty now)", body.includes("این‌جا خالی است"), body.slice(0, 80));

  // root: «سایر» count = 2 (عکس-دو + آزاد-چهار), همه = ۴
  await backBtn().click(); // مدارک → ویزا
  await sleep(500);
  await backBtn().click(); // ویزا → خانه
  await sleep(700);
  body = await textOf();
  ok("D6: back climbs the breadcrumb to root", body.includes("آرشیو") && body.includes("همه: ۴ تصویر"), body.match(/همه: [^\n]*/)?.[0]);

  // multi-select: pick the two «سایر» images → انتقال به پوشه… → ویزا / مدارک
  await page.locator('button:text-is("انتخاب")').first().click();
  await sleep(500);
  for (const name of ["عکس-دو", "آزاد-چهار"]) {
    const card = page.locator("div.glass", { hasText: name }).first();
    await card.locator('button[aria-label="انتخاب تصویر"]').first().click();
    await sleep(250);
  }
  body = await textOf();
  ok("D7: selection bar «۲ تصویر انتخاب شد»", body.includes("۲ تصویر انتخاب شد"));
  await page.locator("button", { hasText: "انتقال به پوشه" }).first().click();
  await sleep(600);
  body = await textOf();
  ok("D8: move modal lists nested paths", body.includes("ویزا / مدارک"));
  await page.locator('button:text-is("ویزا / مدارک")').first().click();
  await sleep(1200);
  body = await textOf();
  ok("D8b: batch move done — toast + bar gone", !(await body.includes("تصویر انتخاب شد")), body.match(/منتقل شد[^\n]*/)?.[0] ?? "");

  // folder drag: ویزا onto آرشیو → nests
  await tile("ویزا").dragTo(tile("آرشیو"));
  await sleep(1200);
  body = await textOf();
  ok("D9: folder tile dragged into another folder (nesting)", (await countOf('button[aria-label="باز کردن پوشه ویزا"]')) === 0 && body.includes("۱ زیرپوشه"), body.match(/آرشیو[^\n]*/)?.[0] ?? "");

  await tile("آرشیو").click();
  await sleep(700);
  ok("D9b: ویزا now lives inside آرشیو", (await countOf('button[aria-label="باز کردن پوشه ویزا"]')) === 1);

  // folder move modal excludes the folder's own subtree
  await page.locator('[aria-label="عملیات پوشه"]').first().click();
  await sleep(500);
  await page.locator('[role="menuitem"]', { hasText: "انتقال به…" }).first().click();
  await sleep(600);
  body = await textOf();
  ok("D10: move modal excludes own subtree (no «ویزا / مدارک»)", !body.includes("ویزا / مدارک") && body.includes("خانه — سطح اصلی"));
  await page.keyboard.press("Escape"); // close (the autoFocus option keeps focus inside)
  await sleep(500);
  body = await textOf();
  ok("D10b: move modal closes with Escape", !body.includes("خانه — سطح اصلی"));

  // OS files dropped onto a folder tile → imported right into it
  const dropped = await page.evaluate(async () => {
    const mkFile = (w, h, color, name) => new Promise((resolve) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      c.toBlob((b) => resolve(new File([b], name, { type: "image/jpeg" })), "image/jpeg", 0.8);
    });
    const dt = new DataTransfer();
    dt.items.add(await mkFile(40, 40, "#ff00ff", "رها-یک.jpg"));
    dt.items.add(await mkFile(40, 40, "#00ffff", "رها-دو.jpg"));
    const target = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "باز کردن پوشه ویزا");
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true;
  });
  await sleep(1800);
  body = await textOf();
  ok("D11: OS files dropped onto a tile import into it", dropped && body.includes("۲ تصویر وارد کتابخانه شد"), body.match(/وارد کتابخانه[^\n]*/)?.[0] ?? "");

  // delete مدارک (inside ویزا) → images survive as «سایر», folder lifts
  await tile("ویزا").click();
  await sleep(700);
  await page.locator('[aria-label="عملیات پوشه"]').first().click();
  await sleep(500);
  await page.locator('[role="menuitem"]', { hasText: "حذف پوشه" }).first().click();
  await sleep(600);
  body = await textOf();
  ok("D12: delete confirm explains the safe semantics", body.includes("سایر") && body.includes("یک سطح بالا"));
  await page.locator('button:text-is("حذف پوشه")').last().click();
  await sleep(1200);
  body = await textOf();
  ok("D12b: مدارک deleted; ویزا keeps its ۴ تصویر", (await countOf('button[aria-label="باز کردن پوشه مدارک"]')) === 0 && body.includes("ویزا: ۴ تصویر"), body.match(/ویزا: [^\n]*/)?.[0] ?? "");

  // list view + search
  await backBtn().click(); await sleep(400);
  await backBtn().click(); await sleep(700); // root
  await page.locator('button[aria-label="نمایش فهرستی"]').first().click();
  await sleep(600);
  body = await textOf();
  ok("D13: فهرست view shows folder rows + image rows", (await countOf(".win-row")) >= 2 && body.includes("عکس-دو"), `win-rows=${await countOf(".win-row")}`);
  await page.locator('button[aria-label="نمایش شبکه‌ای"]').first().click();
  await sleep(500);

  await libInput().fill("رها");
  await sleep(700);
  body = await textOf();
  ok("D14: search widens to all folders with folder badges", body.includes("رها-یک") && body.includes("نتایج جستجو"), body.match(/نتایج جستجو[^\n]*/)?.[0] ?? "");
  await libInput().fill("");
  await sleep(400);

  /* ============================== E — mobile + clean ========================== */

  await page.setViewportSize({ width: 390, height: 800 });
  await sleep(900);
  const overflow = await page.evaluate(() => Math.max(0, document.scrollingElement.scrollWidth - 390));
  ok("E1: mobile 390px — zero horizontal overflow", overflow === 0, `overflow=${overflow}px`);
  await page.setViewportSize({ width: 1280, height: 800 });

  ok("E2: zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

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
