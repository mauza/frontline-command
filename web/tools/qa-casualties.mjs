import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [player, territory, idsRaw, artifact = "casualties"] = process.argv.slice(2);
if (!player || !territory || !idsRaw) {
  throw new Error("usage: qa-casualties.mjs <allied|axis> <territory name> <comma IDs> [artifact]");
}
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
  const card = page
    .getByText(territory, { exact: true })
    .last()
    .locator("xpath=ancestor::div[.//*[normalize-space(text())='Confirm casualties']][1]");
  for (const id of idsRaw.split(",")) await card.getByText(id, { exact: false }).click();
  await card.getByText(`${idsRaw.split(",").length} / ${idsRaw.split(",").length} hits assigned`, { exact: true }).waitFor();
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/commands") && response.request().method() === "POST",
  );
  await card.getByText("Confirm casualties", { exact: true }).click();
  const response = await responsePromise;
  const body = await response.text();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/${artifact}.png`, fullPage: true });
  if (!response.ok()) throw new Error(`${response.status()} ${body}`);
  console.log(JSON.stringify({ result: JSON.parse(body), errors }));
} finally {
  await context.close();
}
