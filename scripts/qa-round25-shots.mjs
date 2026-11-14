/** Visual record: security console + lock screen screenshots. */
import { chromium } from "playwright";

const BASE = "http://localhost:4173/customer2";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// 1. security console (via the secret combo, like the owner would)
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
await page.waitForURL("**/sec-console", { timeout: 5_000 }).catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: "/home/z/my-project/qa/round25-console.png" });

// 2. lock screen (arm + click past threshold — read the real threshold)
await page.getByRole("button", { name: "فعال‌سازی", exact: true }).click();
const threshold = await page.evaluate(
  () => JSON.parse(localStorage.getItem("customer2.security"))?.anomaly?.threshold ?? 16,
);
await page.waitForTimeout(5_800); // grace over
for (let i = 0; i < threshold; i++) {
  await page.mouse.click(640, 450);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(700);
await page.screenshot({ path: "/home/z/my-project/qa/round25-lock.png" });

// 3. wrong-password state
await page.locator('input[placeholder="رمز عبور"]').fill("12345");
await page.locator('input[placeholder="رمز عبور"]').press("Enter");
await page.waitForTimeout(500);
await page.screenshot({ path: "/home/z/my-project/qa/round25-lock-wrong.png" });

console.log("screenshots saved");
await browser.close();
