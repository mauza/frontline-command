import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const root = "/tmp/opencode/frontline-production-playtest";
const state = JSON.parse(await readFile(`${root}/state.json`, "utf8"));
const context = await chromium.launchPersistentContext(`${root}/allied-profile`, {
  executablePath: "/usr/bin/chromium",
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const page = context.pages()[0] || (await context.newPage());
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(`https://war.mau.guru/game/${state.gameID}`, { waitUntil: "networkidle" });
  for (const [unit, count] of [["Infantry", 4], ["Artillery", 3]]) {
    const card = page
      .getByText(unit, { exact: true })
      .locator("xpath=ancestor::div[.//*[normalize-space(text())='+']][1]");
    for (let i = 0; i < count; i++) await card.getByText("+", { exact: true }).click();
  }
  await page.getByText("24 / 24 IPC", { exact: true }).waitFor();
  await page.screenshot({ path: `${root}/05-soviet-purchase-draft.png`, fullPage: true });
  await page.getByText("Submit purchase plan", { exact: true }).click();
  await page.getByText(/purchased/i).first().waitFor();
  await page.screenshot({ path: `${root}/06-soviet-purchase-submitted.png`, fullPage: true });
  await page.getByText("Complete Purchase", { exact: true }).click();
  await page.getByText("Combat Move", { exact: true }).first().waitFor();
  console.log(JSON.stringify({ errors, phase: "Combat Move" }));
} finally {
  await context.close();
}
