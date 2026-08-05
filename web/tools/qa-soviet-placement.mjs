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

async function add(type, count, destination) {
  await page.getByText(`${type} ${count}`, { exact: true }).click();
  for (let i = 0; i < count; i++) {
    await page.getByRole("button", { name: `Select ${destination}` }).click();
    await page.getByText("Add placement", { exact: true }).click();
  }
}

try {
  await page.goto(`https://war.mau.guru/game/${state.gameID}`, { waitUntil: "networkidle" });
  await add("Infantry", 4, "Caucasus");
  await add("Artillery", 3, "Russia");
  await page.screenshot({ path: `${root}/31-soviet-placement-draft.png`, fullPage: true });
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/commands") && response.request().method() === "POST",
  );
  await page.getByText("Submit placements", { exact: true }).click();
  const response = await responsePromise;
  const body = await response.text();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/32-soviet-placement-submitted.png`, fullPage: true });
  if (!response.ok()) throw new Error(`${response.status()} ${body}`);
  console.log(JSON.stringify({ result: JSON.parse(body), errors }));
} finally {
  await context.close();
}
