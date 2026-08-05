import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [player, label, artifact = "action", confirmLabel] = process.argv.slice(2);
if (!player || !label) throw new Error("usage: qa-click.mjs <allied|axis> <exact text> [artifact]");
const root = "/tmp/opencode/frontline-production-playtest";
const state = JSON.parse(await readFile(`${root}/state.json`, "utf8"));
const context = await chromium.launchPersistentContext(`${root}/${player}-profile`, {
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
  await page.getByText(label, { exact: true }).click();
  if (confirmLabel) await page.getByText(confirmLabel, { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${root}/${artifact}.png`, fullPage: true });
  console.log(JSON.stringify({ url: page.url(), errors }));
} finally {
  await context.close();
}
