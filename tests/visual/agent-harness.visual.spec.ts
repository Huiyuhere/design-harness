import { expect, test } from "@playwright/test";

test("renders without clipping, overflow, or runtime errors", async ({ page, browserName }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" }).catch(() => undefined);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main.harness-shell")).toBeVisible();
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors, `${browserName} emitted runtime errors`).toEqual([]);
  const screenshot = await page.screenshot({ fullPage: false, animations: "disabled" });
  await testInfo.attach(`${testInfo.project.name}.png`, { body: screenshot, contentType: "image/png" });
});
