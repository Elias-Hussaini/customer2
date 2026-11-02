/* eslint-disable */
/**
 * QA round 19 — the user's three follow-ups on ابزار عکس:
 *
 *  1. Jump-search history: at least 5 remembered jumps (سابقهٔ جستجو list),
 *     Backspace on the empty input recalls the previous query step-by-step,
 *     and everything survives a reload.
 *  2. Default conversion format is JPEG — never WebP — on a fresh device.
 *  3. The editor remembers the last output settings (format / quality /
 *     max-edge) so nothing has to be re-configured.
 *
 * Plus an end-to-end proof that a transparent PNG saved back into a پرونده
 * with the JPEG default flattens onto WHITE (not black).
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

const dlg = () => page.locator('[role="dialog"]').last();
const dlgBtn = (text) => dlg().locator(`button:has-text("${text}")`).last();

/** 1×1 fully-transparent PNG (real bytes for the file chooser). */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Clear every table (deleteDatabase would block on Dexie's open handle). */
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

/** Six customers + one employer + a transparent-PNG document attachment. */
async function seedData() {
  await page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    const put = (store, value) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    const now = Date.now();
    // 60×40 FULLY transparent PNG → proves the JPEG white-flatten on write-back.
    const c = document.createElement("canvas");
    c.width = 60;
    c.height = 40;
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    const people = [
      ["qa-cust", "علی", "رضایی", "A123456"],
      ["qa-cust2", "محمدرضا", "کریمی", "B222222"],
      ["qa-cust3", "حسین", "احمدی", "C333333"],
      ["qa-cust4", "رضا", "موسوی", "D444444"],
      ["qa-cust5", "مریم", "حسینی", "E555555"],
      ["qa-cust6", "زهرا", "نوری", "F666666"],
    ];
    for (const [id, first, last, pass] of people) {
      await put("customers", {
        id,
        firstName: first,
        lastName: last,
        passportNo: pass,
        employerId: null,
        registrationDate: "2025-11-01",
        createdAt: now,
        updatedAt: now,
      });
    }
    await put("employers", { id: "qa-emp", name: "شرکت ساختمانی هرات", createdAt: now, updatedAt: now });
    await put("docTypes", { id: "qa-passport", label: "پاسپورت تست", order: 1, createdAt: now, updatedAt: now });
    await put("attachments", {
      id: "qa-att-png",
      customerId: "qa-cust",
      paymentId: null,
      kind: "qa-passport",
      name: "لوگو.png",
      mime: "image/png",
      size: png.size,
      blob: png,
      createdAt: now,
      opt: now,
    });
    db.close();
  });
  await sleep(800);
}

/** Which format chip is active inside the فشرده‌سازی و خروجی section. */
async function activeFormat() {
  return page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section"));
    const sec = sections.find((s) => (s.textContent || "").includes("فشرده‌سازی و خروجی"));
    if (!sec) return null;
    const btns = Array.from(sec.querySelectorAll("button"));
    const active = btns.find(
      (b) => ["WebP", "JPEG", "PNG"].includes((b.textContent || "").trim()) && !b.className.includes("chip-soft"),
    );
    return active ? (active.textContent || "").trim() : null;
  });
}

async function readPrefs() {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("studio.prefs.v1") || "null");
    } catch {
      return null;
    }
  });
}

/** Load an image into the (empty) editor through the file picker. */
async function pickImage(name, buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('button:has-text("انتخاب تصویر")').first().click();
  const fc = await chooser;
  await fc.setFiles({ name, mimeType: "image/png", buffer });
  await sleep(1200);
}

const searchInput = () => page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]');

/** Jump to a profile and come straight back to the studio. */
async function jumpAndReturn(query, resultText) {
  await searchInput().fill(query);
  await sleep(500);
  await page.locator(`text=${resultText}`).first().click();
  await sleep(1100);
  const url = page.url();
  await clickDock("ابزار عکس");
  return url;
}

/** Decode the stored attachment + read its first pixel (fully in-browser). */
async function attachmentPixel(id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction("attachments", "readonly").objectStore("attachments").get(id);
          get.onsuccess = async () => {
            try {
              const row = get.result;
              const bitmap = await createImageBitmap(row.blob);
              const canvas = document.createElement("canvas");
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(bitmap, 0, 0);
              const d = ctx.getImageData(0, 0, 1, 1).data;
              bitmap.close();
              db.close();
              resolve({ mime: row.blob.type, name: row.name, r: d[0], g: d[1], b: d[2], a: d[3], w: canvas.width, h: canvas.height });
            } catch (e) {
              db.close();
              resolve({ error: String(e) });
            }
          };
        };
      }),
    id,
  );
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
      // NOTE: studio.prefs.v1 / studio.jump.history.v1 stay UNTOUCHED — a
      // fresh profile must see the JPEG default and an empty history.
    } catch {
      /* ignore */
    }
  });
  page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await sleep(2500);
    await clearTables();
    await seedData();
    await page.reload({ waitUntil: "networkidle" });
    await sleep(2500);

    /* ---------------- 1. studio + FRESH default format = JPEG ------------- */
    await clickDock("ابزار عکس");
    ok("studio opens", page.url().includes("/studio"));

    // First: the empty search box shows the history hint (no history yet).
    await searchInput().click();
    await sleep(400);
    ok("empty history shows the hint", (await countOf("text=اینجا نگه")) >= 1);
    await page.keyboard.press("Escape");

    await pickImage("شفاف.png", PNG_1x1);
    ok("editor loads the picked image", (await countOf("main img")) >= 1);
    const freshFmt = await activeFormat();
    ok("FRESH default format is JPEG (نه WebP)", freshFmt === "JPEG", `active=${freshFmt}`);
    const freshPrefs = await readPrefs();
    ok(
      "fresh prefs persisted as JPEG",
      freshPrefs && freshPrefs.format === "image/jpeg",
      JSON.stringify(freshPrefs),
    );

    /* ------------------- 2. settings persist across reload ----------------- */
    const fmtSection = page.locator('section:has-text("فشرده‌سازی")');
    await fmtSection.locator('button:has-text("WebP")').first().click();
    await fmtSection.locator('input[type="range"]').evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "70");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await fmtSection.locator("select").selectOption("1200");
    await sleep(900);
    const savedPrefs = await readPrefs();
    ok(
      "settings written to prefs (webp / q70 / 1200)",
      savedPrefs?.format === "image/webp" && Math.abs(savedPrefs?.quality - 0.7) < 0.001 && savedPrefs?.maxEdge === 1200,
      JSON.stringify(savedPrefs),
    );

    await page.reload({ waitUntil: "networkidle" });
    await sleep(2200);
    await clickDock("ابزار عکس");
    await pickImage("شفاف.png", PNG_1x1);
    ok("after reload: WebP chip active", (await activeFormat()) === "WebP");
    const secText = await page.locator('section:has-text("فشرده‌سازی")').innerText();
    ok("after reload: quality slider at 70", secText.includes("70٪"), secText.match(/کیفیت[^\n]*/)?.[0] || "");
    const edgeVal = await page.locator('section:has-text("فشرده‌سازی")').locator("select").inputValue();
    ok("after reload: max-edge select at 1200", edgeVal === "1200", `value=${edgeVal}`);

    // Back to JPEG for the write-back test below.
    await page.locator('section:has-text("فشرده‌سازی")').locator('button:has-text("JPEG")').first().click();
    await sleep(600);
    ok("switching back to JPEG sticks", (await activeFormat()) === "JPEG");

    /* ----------------------- 3. jump history (≥5) ------------------------- */
    await jumpAndReturn("رضایی", "علی رضایی");
    await searchInput().click();
    await sleep(500);
    ok("history header appears after first jump", (await countOf("text=سابقهٔ جستجو")) >= 1);
    const rows1 = await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count();
    ok("one history row after first jump", rows1 === 1, `rows=${rows1}`);
    ok("backspace hint shown", (await countOf("text=جستجوی قبلی")) >= 1);
    await page.keyboard.press("Escape");

    await jumpAndReturn("کریمی", "محمدرضا کریمی");
    await jumpAndReturn("احمدی", "حسین احمدی");
    await jumpAndReturn("موسوی", "رضا موسوی");
    await jumpAndReturn("حسینی", "مریم حسینی");

    await searchInput().click();
    await sleep(500);
    const rows5 = await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count();
    ok("FIVE history rows kept (حداقل ۵ سابقه)", rows5 === 5, `rows=${rows5}`);
    const histText = await textOf();
    ok("newest jump listed first", histText.includes("مریم حسینی"));
    ok("oldest jump still listed (علی رضایی)", histText.includes("علی رضایی"));

    /* ------------------- 4. Backspace recall chain ------------------------- */
    await page.keyboard.press("Backspace"); // empty → recalls newest query
    await sleep(400);
    const v1 = await searchInput().inputValue();
    ok("Backspace #1 recalls the last query (حسینی)", v1 === "حسینی", `value=${v1}`);
    await page.keyboard.press("Backspace"); // selected text → cleared
    await sleep(300);
    const v2 = await searchInput().inputValue();
    ok("Backspace #2 clears the recalled text", v2 === "", `value=${v2}`);
    await page.keyboard.press("Backspace"); // → older query
    await sleep(400);
    const v3 = await searchInput().inputValue();
    ok("Backspace #3 steps to the previous query (موسوی)", v3 === "موسوی", `value=${v3}`);
    await page.keyboard.press("Escape");

    /* ------------------------ 5. history survives reload ------------------- */
    await page.reload({ waitUntil: "networkidle" });
    await sleep(2200);
    await clickDock("ابزار عکس");
    await searchInput().click();
    await sleep(500);
    const rowsReload = await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count();
    ok("history survives a reload (5 rows)", rowsReload === 5, `rows=${rowsReload}`);
    // Recall still works after the reload — no re-typing needed.
    await page.keyboard.press("Backspace");
    await sleep(400);
    const vReload = await searchInput().inputValue();
    ok("Backspace recalls after reload too", vReload === "حسینی", `value=${vReload}`);
    await page.keyboard.press("Escape");

    /* ------------------------ 6. employer in history ----------------------- */
    const empUrl = await jumpAndReturn("هرات", "شرکت ساختمانی هرات");
    ok("employer jump navigates to its file", /\/employers\/[^/]+$/.test(empUrl), empUrl);
    await searchInput().click();
    await sleep(500);
    const rows6 = await page.locator('p:has-text("سابقهٔ جستجو") ~ ul > li').count();
    ok("employer row kept in history (6 rows)", rows6 === 6, `rows=${rows6}`);
    await page.keyboard.press("Escape");

    /* ------------- 7. JPEG default write-back + WHITE flatten ------------- */
    ok("prefs are JPEG before the write-back", (await readPrefs())?.format === "image/jpeg");
    const custUrl = await jumpAndReturn("رضایی", "علی رضایی");
    ok("jump lands on the customer file", custUrl.includes("/customers/qa-cust"), custUrl);
    // Re-open the file itself for the document write-back test.
    await page.goto(BASE + "customers/qa-cust", { waitUntil: "networkidle" });
    await sleep(1800);
    ok("back on the customer file", page.url().includes("/customers/qa-cust"));
    await page.locator('[data-slot="qa-passport"] button[aria-label="مشاهده"]').first().click();
    await sleep(900);
    await dlgBtn("ویرایش").click();
    await sleep(1800);
    ok("studio opens with the transparent PNG", page.url().includes("/studio"));
    await page.locator('button:has-text("ذخیره در پرونده")').last().click();
    await sleep(2200);
    const px = await attachmentPixel("qa-att-png");
    ok(
      "attachment re-encoded as JPEG (default format)",
      px?.mime === "image/jpeg",
      JSON.stringify(px),
    );
    ok(
      "transparent PNG flattened onto WHITE, not black",
      px?.r === 255 && px?.g === 255 && px?.b === 255,
      `rgb(${px?.r},${px?.g},${px?.b})`,
    );
    ok("attachment name retargeted to .jpg", typeof px?.name === "string" && /\.jpe?g$/i.test(px.name), px?.name);

    /* ---------------------------- 8. mobile sweep -------------------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + "studio", { waitUntil: "networkidle" });
    await sleep(1800);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    ok("no horizontal overflow on mobile", overflow <= 1, `overflow=${overflow}px`);
    await page.screenshot({ path: "/home/z/my-project/qa/round19/studio-mobile.png" });

    /* --------------------------- console sweep ----------------------------- */
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes("Download the React DevTools") &&
        !e.includes("manifest.json") &&
        !e.includes("three") &&
        !e.includes("WebGL"),
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
