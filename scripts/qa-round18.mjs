/* eslint-disable */
/**
 * QA round 18 (part B — real architecture) — ابزار عکس studio upgrades +
 * Windows-style folders + dock placement, on top of the launcher/studio base.
 *
 * Serves the production dist at :4173 (base /customer2/), seeds a customer /
 * employer / doc slot / image attachment straight into IndexedDB, then drives
 * real Chromium through: the launcher dock (studio next to کارفرماها), the
 * studio jump search, the photo-avatar editor write-back, the document editor
 * write-back, quick PDF conversion + editor forwarding, the employers pages,
 * and the Windows-style folder explorer.
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

async function textOf() {
  return (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).trim();
}

async function countOf(sel) {
  return await page.locator(sel).count().catch(() => 0);
}

async function clickDock(label) {
  await page.locator(`.dock-item[aria-label="${label}"]`).first().click();
  await page.waitForTimeout(800);
}

/** The TOPMOST open dialog (dialogs stack). */
const dlg = () => page.locator('[role="dialog"]').last();
const dlgBtn = (text) => dlg().locator(`button:has-text("${text}")`).last();
const dlgInput = () => dlg().locator("input").first();

/** Measure an image attachment's pixel size — fully in-browser. */
async function measureAttachment(id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction("attachments", "readonly").objectStore("attachments").get(id);
          get.onsuccess = async () => {
            try {
              const bitmap = await createImageBitmap(get.result.blob);
              const dims = { w: bitmap.width, h: bitmap.height, size: get.result.size };
              bitmap.close();
              db.close();
              resolve(dims);
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

async function readCustomerPhoto(id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open("customer2-visa");
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction("customers", "readonly").objectStore("customers").get(id);
          get.onsuccess = () => {
            const photo = get.result?.photo;
            db.close();
            resolve(typeof photo === "string" ? photo : null);
          };
        };
      }),
    id,
  );
}

/** A valid 2-page PDF built by hand (pdf.js renders it happily). */
function buildTwoPagePdf() {
  const content = (n) => `BT /F1 24 Tf 60 100 Td (Page ${n}) Tj ET`;
  const objs = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    4: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    5: `<< /Length ${content(1).length} >>\nstream\n${content(1)}\nendstream`,
    6: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    7: `<< /Length ${content(2).length} >>\nstream\n${content(2)}\nendstream`,
  };
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const k of Object.keys(objs)) {
    offsets.push(body.length);
    body += `${k} 0 obj\n${objs[k]}\nendobj\n`;
  }
  const startxref = body.length;
  body += `xref\n0 8\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

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

/** Seed employer + customer (with photo) + doc slot + image attachment. */
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
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 250;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, 400, 250);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText("PASSPORT", 90, 130);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const photoCanvas = document.createElement("canvas");
    photoCanvas.width = 200;
    photoCanvas.height = 200;
    const pctx = photoCanvas.getContext("2d");
    pctx.fillStyle = "#0b9e6e";
    pctx.fillRect(0, 0, 200, 200);
    pctx.fillStyle = "#fff";
    pctx.font = "bold 40px sans-serif";
    pctx.fillText("ALI", 55, 115);
    const photo = photoCanvas.toDataURL("image/jpeg", 0.85);

    await put("employers", { id: "qa-emp", name: "شرکت ساختمانی هرات", createdAt: now, updatedAt: now });
    await put("customers", {
      id: "qa-cust",
      firstName: "علی",
      lastName: "رضایی",
      passportNo: "A123456",
      employerId: "qa-emp",
      registrationDate: "2025-11-01",
      photo,
      createdAt: now,
      updatedAt: now,
    });
    await put("docTypes", {
      id: "qa-passport",
      label: "پاسپورت تست",
      order: 1,
      createdAt: now,
      updatedAt: now,
    });
    await put("attachments", {
      id: "qa-att",
      customerId: "qa-cust",
      paymentId: null,
      kind: "qa-passport",
      name: "پاسپورت.jpg",
      mime: "image/jpeg",
      size: blob.size,
      blob,
      createdAt: now,
      opt: now,
    });
    db.close();
  });
  await page.waitForTimeout(800);
}

async function waitCount(sel, n, tries = 24) {
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(500);
    const c = await countOf(sel);
    if (c >= n) return c;
  }
  return countOf(sel);
}

async function main() {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 3000));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // The 3D robot companion overlays the top-right corner and would intercept
  // clicks — disable it for the QA session (exactly like a user can).
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("robot.settings.v1", JSON.stringify({ enabled: false }));
      localStorage.setItem("launcher.layout.v1", ""); // cleared → invalid → defaults
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
    /* ------------------------------ 1. dock ------------------------------ */
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await clearTables();
    await seedData();
    // Raw IDB writes bypass Dexie liveQuery — reload to read seeded rows.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    const dockLabels = (await page.locator(".dock-item").allInnerTexts()).map((t) => t.trim());
    ok("dock has 8 items (7 nav + بیشتر)", dockLabels.length === 8, `got ${dockLabels.length}`);
    ok("dock has ابزار عکس", dockLabels.some((t) => t.includes("ابزار عکس")));
    ok("dock has کارفرماها", dockLabels.some((t) => t.includes("کارفرما")));
    const empIdx = dockLabels.findIndex((t) => t.includes("کارفرما"));
    const studioIdx = dockLabels.findIndex((t) => t.includes("ابزار عکس"));
    ok("ابزار عکس is adjacent to کارفرماها", Math.abs(empIdx - studioIdx) === 1, `${empIdx} vs ${studioIdx}`);
    ok("accounting stays a floating button", (await countOf(".launcher-fab")) >= 1);

    /* ------------------------ 2. studio + jump search -------------------- */
    await clickDock("ابزار عکس");
    ok("studio opens", page.url().includes("/studio"));
    ok("jump search present", (await countOf('input[placeholder*="جستجوی مشتری یا کارفرما"]')) === 1);
    const studioBody = await textOf();
    ok("editor tab present", studioBody.includes("ویرایشگر"));
    ok("convert tab present", studioBody.includes("تبدیل سریع"));
    ok("library tab present", studioBody.includes("کتابخانه"));

    /* ---------------------- 3. jump search → profile --------------------- */
    await page.locator('input[placeholder*="جستجوی مشتری یا کارفرما"]').fill("رضایی");
    await page.waitForTimeout(600);
    const hit = page.locator("text=علی رضایی").first();
    ok("jump search finds customer", (await hit.count()) >= 1);
    await hit.click();
    await page.waitForTimeout(1100);
    ok("jump navigates to customer file", page.url().includes("/customers/qa-cust"));
    ok("profile shows photo edit button", (await textOf()).includes("ویرایش عکس"));

    /* ------------------ 4. inline docs grid (DocumentSlots) -------------- */
    ok("document slot tile exists", (await countOf('[data-slot="qa-passport"]')) === 1);
    const gridInfo = await page.evaluate(() => {
      const slot = document.querySelector('[data-slot="qa-passport"]');
      if (!slot) return null;
      return { cols: getComputedStyle(slot.parentElement).gridTemplateColumns.split(" ").filter(Boolean).length };
    });
    ok("inline slots render in a multi-column grid", gridInfo && gridInfo.cols >= 3, JSON.stringify(gridInfo));

    /* ------------------- 5. attachment editor write-back ----------------- */
    await page.locator('[data-slot="qa-passport"] button[aria-label="مشاهده"]').first().click();
    await page.waitForTimeout(900);
    ok("preview modal opens", (await dlg().innerText()).includes("دانلود"));
    ok("preview has ویرایش button", (await dlgBtn("ویرایش").count()) === 1);
    await dlgBtn("ویرایش").click();
    await page.waitForTimeout(1800);
    ok("studio opens with the attachment", page.url().includes("/studio"));
    const beforeDims = await measureAttachment("qa-att");
    await page.locator('button[title="۹۰ درجه راست"]').last().click();
    await page.waitForTimeout(700);
    await page.locator('button:has-text("ذخیره در پرونده")').last().click();
    await page.waitForTimeout(2000);
    const afterDims = await measureAttachment("qa-att");
    ok(
      "editor rotation persisted to the document",
      beforeDims.w === afterDims.h && beforeDims.h === afterDims.w,
      `${JSON.stringify(beforeDims)} → ${JSON.stringify(afterDims)}`,
    );

    /* -------------------- 6. docs manager modal (ادیت مدارک) ------------- */
    await page.goBack();
    await page.waitForTimeout(1400);
    await page.locator('button:has-text("ادیت مدارک")').first().click();
    await page.waitForTimeout(1200);
    const docsBody = await dlg().innerText();
    ok("docs manager modal opens", docsBody.includes("ادیت مدارک"));
    ok("docs manager shows the document", docsBody.includes("پاسپورت تست") || docsBody.includes("پاسپورت.jpg"));
    const managerGrid = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return null;
      const grid = modal.querySelector(".grid");
      return grid ? { cols: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length } : null;
    });
    ok("docs manager grid layout", managerGrid && managerGrid.cols >= 2, JSON.stringify(managerGrid));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);

    /* -------------------- 7. profile photo editor ------------------------ */
    await page.locator('button:has-text("ویرایش عکس")').first().click();
    await page.waitForTimeout(1800);
    ok("studio opens for the avatar", page.url().includes("/studio"));
    const photoBefore = await readCustomerPhoto("qa-cust");
    ok("avatar editor loaded the photo", typeof photoBefore === "string" && photoBefore.length > 100);
    await page.locator('button[title="آینه افقی"]').last().click();
    await page.waitForTimeout(700);
    await page.locator('button:has-text("ذخیره عکس پروفایل")').last().click();
    await page.waitForTimeout(2200);
    const photoAfter = await readCustomerPhoto("qa-cust");
    ok("avatar edited + saved back", typeof photoAfter === "string" && photoAfter !== photoBefore, "dataURL changed");

    /* --------------------- 8. quick convert (PDF → tiles) ---------------- */
    await page.locator('[role="tab"]:has-text("تبدیل سریع")').first().click();
    await page.waitForTimeout(700);
    const chooser = page.waitForEvent("filechooser");
    await page.locator('button:has-text("انتخاب فایل‌ها")').first().click();
    const fc = await chooser;
    await fc.setFiles({ name: "گزارش.pdf", mimeType: "application/pdf", buffer: buildTwoPagePdf() });
    let tiles = 0;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      tiles = await page.evaluate(() => document.querySelectorAll("main .glass-soft img[alt]").length);
      if (tiles >= 2) break;
    }
    ok("PDF converted to 2 image tiles", tiles === 2, `tiles=${tiles}`);

    /* ------------------------- 9. tile → editor -------------------------- */
    if (tiles >= 1) {
      await page.locator('button[aria-label="ویرایش"]').first().click();
      await page.waitForTimeout(1500);
      ok(
        "tile opens in the editor",
        (await page.locator('[role="tab"][aria-selected="true"]').first().innerText()).includes("ویرایشگر"),
      );
      ok("editor has the image loaded", (await countOf("main img")) >= 1);
    }

    /* ------------- 10. editor forwards PDFs to the convert tab ----------- */
    await page.locator('[role="tab"]:has-text("ویرایشگر")').first().click();
    await page.waitForTimeout(700);
    // Back to the empty state, then pick a PDF through the editor's picker.
    await page.locator('button:has-text("تصویر جدید")').last().click();
    await page.waitForTimeout(500);
    const chooser2 = page.waitForEvent("filechooser");
    await page.locator('button:has-text("انتخاب تصویر")').first().click();
    const fc2 = await chooser2;
    await fc2.setFiles({ name: "سند.pdf", mimeType: "application/pdf", buffer: buildTwoPagePdf() });
    await page.waitForTimeout(600);
    const activeTab = await page.locator('[role="tab"][aria-selected="true"]').first().innerText();
    ok("editor forwards PDF to تبدیل سریع", activeTab.includes("تبدیل سریع"), activeTab.trim());
    let fwdTiles = 0;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      fwdTiles = await page.evaluate(() => document.querySelectorAll("main .glass-soft img[alt]").length);
      if (fwdTiles >= 2) break;
    }
    ok("forwarded PDF converts to 2 tiles", fwdTiles >= 2, `tiles=${fwdTiles}`);
    const convertBody = await textOf();
    ok("batch actions present", convertBody.includes("دانلود همه") && convertBody.includes("پاک کردن"));

    /* ----------------------- 11. employers pages ------------------------- */
    await clickDock("کارفرماها");
    ok("employers page opens", page.url().includes("/employers"));
    ok("employer card visible", (await textOf()).includes("شرکت ساختمانی هرات"));
    await page.locator("text=شرکت ساختمانی هرات").first().click();
    await page.waitForTimeout(1200);
    const empUrl = page.url();
    ok("employer file opens", /\/employers\/[^/]+$/.test(empUrl), empUrl);
    const empBody = await textOf();
    ok("employer file shows connected customer", empBody.includes("علی رضایی"));
    ok("employer file has stats", empBody.includes("مشتریان مرتبط"));

    /* ------------------- 12. folder explorer (Windows) ------------------- */
    await clickDock("لیست‌ها");
    ok("lists explorer opens", page.url().includes("/lists"));
    ok("breadcrumb bar present", (await countOf('nav[aria-label="مسیر پوشه"]')) === 1);
    ok("view toggle present", (await countOf('button[aria-label="نمایش شبکه‌ای"]')) === 1);
    ok("back disabled at home", await page.locator('button[aria-label="بازگشت"]').first().isDisabled());

    await page.locator('button:has-text("پوشه جدید")').first().click();
    await page.waitForTimeout(800);
    await dlgInput().fill("ویزای دوبی");
    await dlgBtn("ساخت پوشه").click();
    await page.waitForTimeout(1300);
    ok("folder tile created", (await waitCount(".win-folder", 1)) >= 1);
    ok("windows folder icon drawn", (await countOf(".win-folder-icon")) >= 1);

    await page.locator('button[aria-label="نمایش فهرستی"]').first().click();
    await page.waitForTimeout(700);
    ok("list view rows render", (await countOf(".win-row")) >= 1);
    await page.locator('button[aria-label="نمایش شبکه‌ای"]').first().click();
    await page.waitForTimeout(600);

    await page.locator(".win-folder").first().click();
    await page.waitForTimeout(1200);
    ok("folder page opens", /\/lists\/[^/]+$/.test(page.url()));
    ok("breadcrumb shows folder", (await textOf()).includes("ویزای دوبی"));

    await page.locator('button:has-text("زیرپوشه جدید")').first().click();
    await page.waitForTimeout(800);
    await dlgInput().fill("آبان");
    await dlgBtn("ساخت پوشه").click();
    await page.waitForTimeout(1300);
    ok("subfolder tile appears", (await textOf()).includes("آبان"));

    await page.locator('button[aria-label="بازگشت"]').first().click();
    await page.waitForTimeout(1200);
    ok("back returns to explorer root", /\/lists\/?$/.test(page.url().split("?")[0]), page.url());

    await page.locator(".win-folder").first().click();
    await page.waitForTimeout(1200);
    await page.locator(".win-folder").first().click();
    await page.waitForTimeout(1200);
    ok("inside subfolder", /\/lists\/[^/]+$/.test(page.url()));
    await page.locator('nav[aria-label="مسیر پوشه"] button, nav[aria-label="مسیر پوشه"] a').first().click();
    await page.waitForTimeout(1200);
    ok("breadcrumb خانه climbs to root", /\/lists\/?$/.test(page.url().split("?")[0]), page.url());

    /* -------------------------- 13. mobile sweep -------------------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + "studio", { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    ok("no horizontal overflow on mobile", overflow <= 1, `overflow=${overflow}px`);
    const dockOverflow = await page.evaluate(() => {
      const dock = document.querySelector(".dock");
      return dock ? dock.scrollWidth - dock.clientWidth : 0;
    });
    ok("dock fits mobile width", dockOverflow <= 1, `dockOverflow=${dockOverflow}px`);
    await page.screenshot({ path: "/home/z/my-project/qa/round18/studio-mobile.png" });

    /* --------------------------- console sweep ---------------------------- */
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
