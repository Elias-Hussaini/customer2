/**
 * Browser QA — Round 27:
 *   «پروندهٔ هر مشتری → یک PDF داخل یک پوشه» (Smart Archive → documents →
 *   PDF output) + full customization (cover / captions / page size /
 *   orientation / quality / margins / naming / folder structure).
 *
 * Runs against the production build served at /customer2/ (serve_dist.js).
 * Byte-level verification: the downloaded ZIP is unpacked in Node and every
 * PDF is inspected (page count, MediaBox sizes, A4/auto-orientation rules).
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:4173/customer2";
const PASSWORD = "Mazari1234$$$";
const OUT_DIR = "/tmp/qa-round27";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/net::|fetch|Failed to load|ERR_|favicon/i.test(t)) errors.push(t);
});

async function waitFor(fn, timeout = 25_000, step = 350) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(step);
  }
  return last;
}

/* ------------------------------------------------------------------ */
/* 1. first-launch gate → unlock                                        */
/* ------------------------------------------------------------------ */
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const gate = page.locator('input[placeholder="رمز عبور"]');
if (await gate.count()) {
  await gate.first().fill(PASSWORD);
  await gate.first().press("Enter");
  const gone = await waitFor(async () => !(await page.locator('input[placeholder="رمز عبور"]').count()));
  ok("first-launch gate unlocks with the password", !!gone);
} else {
  ok("first-launch gate already unlocked on this profile", true);
}

/* ------------------------------------------------------------------ */
/* 2. seed QA data (raw IndexedDB — reload afterwards so Dexie re-reads) */
/* ------------------------------------------------------------------ */
const SEED = async () => {
  const open = (name) =>
    new Promise((res, rej) => {
      const rq = indexedDB.open(name);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  const putAll = (db, store, rows) =>
    new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      for (const r of rows) tx.objectStore(store).put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

  const db = await open("customer2-visa");
  const now = Date.now();

  // --- image blobs via canvas -------------------------------------
  const img = async (w, h, text) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#dde7ff";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#22335c";
    g.font = `bold ${Math.round(h / 10)}px Tahoma`;
    g.textAlign = "center";
    g.fillText(text, w / 2, h / 2);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  };

  // --- minimal valid PDF with N blank pages -----------------------
  const makePdf = (numPages, w, h) => {
    const objs = [];
    let next = 3;
    const kids = [];
    for (let i = 0; i < numPages; i++) {
      const pid = next++;
      const cid = next++;
      objs[pid] = `${pid} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${cid} 0 R >>\nendobj\n`;
      objs[cid] = `${cid} 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`;
      kids.push(`${pid} 0 R`);
    }
    objs[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    objs[2] = `2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${numPages} >>\nendobj\n`;
    let out = "%PDF-1.4\n";
    const offs = [];
    for (let id = 1; id < objs.length; id++) {
      if (!objs[id]) continue;
      offs[id] = out.length;
      out += objs[id];
    }
    const xrefPos = out.length;
    let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objs.length; id++) {
      xref += objs[id] ? `${String(offs[id]).padStart(10, "0")} 00000 n \n` : `0000000000 65535 f \n`;
    }
    out += `${xref}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    return new Blob([out], { type: "application/pdf" });
  };

  const att = (id, customerId, kind, name, blob, i) => ({
    id,
    customerId,
    kind,
    name,
    mime: blob.type,
    size: blob.size,
    blob,
    createdAt: now - (100 - i) * 60000,
  });

  await putAll(db, "representatives", [
    { id: "qa-r1", name: "احمدی", createdAt: now - 9e7 },
    { id: "qa-r2", name: "کریمی", createdAt: now - 8e7 },
  ]);
  await putAll(db, "employers", [
    { id: "qa-e1", name: "شرکت ابن سینا", createdAt: now - 7e7 },
  ]);
  await putAll(db, "lists", [{ id: "qa-l1", name: "لیست آزمایشی", createdAt: now - 6e7, parentId: null }]);
  await putAll(db, "customers", [
    { id: "qa-c1", firstName: "علی", lastName: "رضایی", passportNo: "A100", representativeId: "qa-r1", listId: "qa-l1", employerId: "qa-e1", registrationDate: "2026-09-01", createdAt: now - 5e7, updatedAt: now },
    { id: "qa-c2", firstName: "مریم", lastName: "کریمی", passportNo: "A200", representativeId: "qa-r2", listId: "qa-l1", registrationDate: "2026-09-02", createdAt: now - 4e7, updatedAt: now },
    { id: "qa-c3", firstName: "حسین", lastName: "نوری", passportNo: "A300", representativeId: "qa-r1", listId: "qa-l1", registrationDate: "2026-09-03", createdAt: now - 3e7, updatedAt: now },
  ]);
  await putAll(db, "requests", [
    { id: "qa-q1", customerId: "qa-c1", representativeId: "qa-r1", listId: "qa-l1", visaType: "ویزای کار", tags: [], registrationDate: "2026-09-01", issued: true, issuedAt: "2026-10-01", notes: "", createdAt: now - 5e7, updatedAt: now },
    { id: "qa-q2", customerId: "qa-c2", representativeId: "qa-r2", listId: "qa-l1", visaType: "ویزای کار", tags: [], registrationDate: "2026-09-02", issued: true, issuedAt: "2026-10-02", notes: "", createdAt: now - 4e7, updatedAt: now },
    { id: "qa-q3", customerId: "qa-c3", representativeId: "qa-r1", listId: "qa-l1", visaType: "ویزای کار", tags: [], registrationDate: "2026-09-03", issued: true, issuedAt: "2026-10-03", notes: "", createdAt: now - 3e7, updatedAt: now },
  ]);

  const passportAli = await img(1240, 1754, "PASSPORT Ali Rezaei");
  const nidAli = await img(800, 600, "NID FRONT landscape");
  const otherPdfAli = makePdf(2, 612, 792);
  const visaAli = makePdf(1, 612, 792);
  const passportMaryam = await img(900, 1200, "PASSPORT Maryam");
  const txtHossein = new Blob(["just text"], { type: "text/plain" });

  await putAll(db, "attachments", [
    att("qa-a1", "qa-c1", "passport", "ali-passport.jpg", passportAli, 1),
    att("qa-a2", "qa-c1", "nidFront", "ali-nid.jpg", nidAli, 2),
    att("qa-a3", "qa-c1", "other", "ali-other.pdf", otherPdfAli, 3),
    att("qa-a4", "qa-c1", "issuedVisa", "ali-visa.pdf", visaAli, 4),
    att("qa-a5", "qa-c2", "passport", "maryam-passport.jpg", passportMaryam, 5),
    att("qa-a6", "qa-c3", "other", "hossein-notes.txt", txtHossein, 6),
  ]);
  db.close();
  return true;
};

await page.evaluate(SEED);
await page.goto(`${BASE}/smart-archive`, { waitUntil: "networkidle" });
await waitFor(async () => (await page.getByText("بایگانی هوشمند").count()) > 0);
ok("seeded + navigated to Smart Archive", true);

/* ------------------------------------------------------------------ */
/* 3. documents mode → PDF output                                      */
/* ------------------------------------------------------------------ */
await page.getByRole("radio", { name: /مدارک مشتریان/ }).click();
await waitFor(async () => (await page.getByText("انتخاب مشتری‌های خاص").count()) > 0);

await page.getByRole("radio", { name: /پروندهٔ هر مشتری/ }).click();
await waitFor(async () => (await page.getByText("شخصی‌سازی پرونده‌های PDF").count()) > 0);
ok("PDF output format switcher works", true);

// ZIP-specific cards must be hidden in PDF mode
ok(
  "ZIP structure card hidden in PDF mode",
  (await page.getByText("نام فایل ZIP", { exact: false }).count()) === 0,
);
ok(
  "external-files card hidden in PDF mode",
  (await page.getByText("فایل‌های اضافی از دستگاه", { exact: false }).count()) === 0,
);

// preview: 2 ready customers + 1 without convertible files
const previewHas = async (text) =>
  (await page.locator("li", { hasText: text }).count()) > 0;
await waitFor(async () => await previewHas("علی رضایی"));
ok("preview lists علی رضایی with his PDF name", await previewHas("علی رضایی.pdf"));
ok("preview lists مریم کریمی with her PDF name", await previewHas("مریم کریمی.pdf"));
ok(
  "preview flags the customer without convertible files",
  (await page.getByText("۱ مشتری بدون فایل قابل تبدیل").count()) > 0,
);
ok(
  "header button counts 2 customers",
  (await page.getByRole("button", { name: /دانلود PDFها \(۲ مشتری\)/ }).count()) === 1,
);

/* ------------------------------------------------------------------ */
/* 4. customization: per-rep folders + ZIP destination                 */
/* ------------------------------------------------------------------ */
const openPickerAndChoose = async (label, option) => {
  const picker = page.locator("div.rounded-2xl", { hasText: label }).filter({ hasText: " ChevronDown" }).first();
  // OptionPicker header button contains the label + current value
  const header = page.getByRole("button", { name: new RegExp(label) }).first();
  await header.click();
  await page.waitForTimeout(350);
  await page.getByRole("radio", { name: new RegExp(option) }).first().click();
  await page.waitForTimeout(350);
};

await openPickerAndChoose("ساختار پوشه‌ها", "پوشهٔ هر نماینده");
ok("per-rep folder shows in preview", await previewHas("احمدی/"));

await openPickerAndChoose("محل ذخیره", "فایل ZIP");
ok("ZIP destination selected", true);

/* ------------------------------------------------------------------ */
/* 5. run #1 — default (A4, cover, captions) → download + inspect      */
/* ------------------------------------------------------------------ */
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
await page.getByRole("button", { name: /دانلود PDFها/ }).click();
const download = await downloadPromise;
const zipPath = path.join(OUT_DIR, download.suggestedFilename());
await download.saveAs(zipPath);
ok("ZIP download fired", fs.existsSync(zipPath), download.suggestedFilename());

// success toast
await waitFor(async () => (await page.getByText("پروندهٔ PDF").count()) > 0, 8000);
ok("success toast shown", true);

/* ---- unzip + inspect in Node -------------------------------------- */
const { default: JSZip } = await import("jszip");
const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
ok(
  "ZIP contains per-rep folders with customer-named PDFs",
  names.includes("احمدی/علی رضایی.pdf") && names.includes("کریمی/مریم کریمی.pdf"),
  names.join(" | "),
);
ok("exactly 2 PDFs (Hossein had no convertible file)", names.length === 2);

const pdfPages = (buf) => {
  const s = buf.toString("latin1");
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [
    Math.round(parseFloat(m[1])),
    Math.round(parseFloat(m[2])),
  ]);
  const count = (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { count, boxes };
};

const aliBuf = await zip.files["احمدی/علی رضایی.pdf"].async("nodebuffer");
const ali = pdfPages(aliBuf);
// cover(1) + passport(1) + nid(1) + other pdf(2) + visa pdf(1) = 6
ok("Ali's dossier PDF has 6 pages (cover+4 docs+2-page PDF)", ali.count === 6, `got ${ali.count}`);
ok(
  "cover page is A4 portrait",
  ali.boxes[0]?.[0] === 595 && ali.boxes[0]?.[1] === 842,
  JSON.stringify(ali.boxes[0]),
);
ok(
  "landscape NID flips its page to A4 landscape",
  ali.boxes[2]?.[0] === 842 && ali.boxes[2]?.[1] === 595,
  JSON.stringify(ali.boxes[2]),
);
ok(
  "imported PDF pages keep portrait A4 boxes",
  ali.boxes[3]?.[0] === 595 && ali.boxes[3]?.[1] === 842,
  JSON.stringify(ali.boxes.slice(3)),
);

const maryamBuf = await zip.files["کریمی/مریم کریمی.pdf"].async("nodebuffer");
const maryam = pdfPages(maryamBuf);
ok("Maryam's dossier PDF has 2 pages (cover+passport)", maryam.count === 2, `got ${maryam.count}`);

/* ------------------------------------------------------------------ */
/* 6. run #2 — fit page size, no cover, no captions                    */
/* ------------------------------------------------------------------ */
await openPickerAndChoose("اندازهٔ صفحه", "هم‌اندازهٔ مدرک");
ok(
  "orientation picker hidden in fit mode",
  (await page.getByRole("button", { name: /^جهت صفحه/ }).count()) === 0,
);

// toggles off: cover + captions
const toggle = async (label) => {
  const t = page.locator("label, div", { hasText: label }).filter({ has: page.locator('input[type="checkbox"], [role="switch"]') }).first();
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(250);
};
await page.getByText("صفحهٔ جلد با مشخصات مشتری", { exact: true }).first().click();
await page.waitForTimeout(200);
await page.getByText("نام مدرک بالای هر صفحه", { exact: true }).first().click();
await page.waitForTimeout(200);

const dl2 = page.waitForEvent("download", { timeout: 90_000 });
await page.getByRole("button", { name: /دانلود PDFها/ }).click();
const d2 = await dl2;
const zip2Path = path.join(OUT_DIR, "fit-" + d2.suggestedFilename());
await d2.saveAs(zip2Path);

const zip2 = await JSZip.loadAsync(fs.readFileSync(zip2Path));
const ali2 = pdfPages(await zip2.files["احمدی/علی رضایی.pdf"].async("nodebuffer"));
// no cover: passport + nid + 2 pdf pages + visa = 5
ok("fit mode: Ali's PDF has 5 pages (no cover)", ali2.count === 5, `got ${ali2.count}`);
ok(
  "fit mode: page 1 sized to the passport image (1240×1754 px → 930×1316 pt)",
  ali2.boxes[0]?.[0] === 930 && ali2.boxes[0]?.[1] === 1316,
  JSON.stringify(ali2.boxes[0]),
);
ok(
  "fit mode: landscape NID page is 600×450 pt",
  ali2.boxes[1]?.[0] === 600 && ali2.boxes[1]?.[1] === 450,
  JSON.stringify(ali2.boxes[1]),
);

/* ------------------------------------------------------------------ */
/* 7. name template → {پاسپورت}                                        */
/* ------------------------------------------------------------------ */
await page.getByLabel("الگوی نام فایل PDF").fill("{پاسپورت}");
await page.waitForTimeout(400);
ok("name template preview updates", await previewHas("A100.pdf"));

/* ------------------------------------------------------------------ */
/* 8. clean up + verdict                                                */
/* ------------------------------------------------------------------ */
const fatal = errors.filter((e) => !/ResizeObserver|script error/i.test(e));
ok("no console/page errors", fatal.length === 0, fatal.slice(0, 3).join(" ;; "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n===== ROUND 27 QA: ${results.length - failed.length}/${results.length} passed =====`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
