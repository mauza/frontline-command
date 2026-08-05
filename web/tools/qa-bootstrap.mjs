import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const root = "/tmp/opencode/frontline-production-playtest";
const site = "https://war.mau.guru";
await mkdir(root, { recursive: true });

async function browser(name) {
  const context = await chromium.launchPersistentContext(`${root}/${name}-profile`, {
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
  return { context, page, errors };
}

const allied = await browser("allied");
const axis = await browser("axis");

try {
  await allied.page.goto(site, { waitUntil: "networkidle" });
  await allied.page.getByPlaceholder("Sunday Night 1942").fill("QA Full Campaign 2026-08-04");
  await allied.page.getByPlaceholder("Commander name").fill("Allied Subagent");
  await allied.page.getByText("Create campaign", { exact: true }).click();
  await allied.page.waitForURL(/\/game\//);
  await allied.page.getByText("INVITE YOUR FRIENDS", { exact: true }).waitFor();
  const gameID = new URL(allied.page.url()).pathname.split("/")[2];
  const alliedText = await allied.page.locator("body").innerText();
  const joinCode = alliedText.match(/INVITE YOUR FRIENDS\s+([A-Z0-9_-]{6})/)?.[1];
  if (!joinCode) throw new Error("could not read invite code from lobby");
  await allied.page.screenshot({ path: `${root}/01-allied-lobby.png`, fullPage: true });

  await axis.page.goto(site, { waitUntil: "networkidle" });
  await axis.page.getByText("Join by code", { exact: true }).click();
  await axis.page.getByPlaceholder("A7K9QZ").fill(joinCode);
  await axis.page.getByPlaceholder("Commander name").fill("Axis Subagent");
  await axis.page.getByText("Enter war room", { exact: true }).click();
  await axis.page.waitForURL(new RegExp(`/game/${gameID}$`));
  await axis.page.getByText("The host will start when everyone arrives.", { exact: true }).waitFor();
  await axis.page.screenshot({ path: `${root}/02-axis-lobby.png`, fullPage: true });

  await allied.page.reload({ waitUntil: "networkidle" });
  await allied.page.getByText("2 of 5 commanders assembled", { exact: true }).waitFor();
  await allied.page.getByText("Assign powers & start", { exact: true }).click();
  await allied.page.getByText("Soviet Union", { exact: true }).first().waitFor();
  await allied.page.screenshot({ path: `${root}/03-allied-start.png`, fullPage: true });
  await axis.page.reload({ waitUntil: "networkidle" });
  await axis.page.screenshot({ path: `${root}/04-axis-start.png`, fullPage: true });

  const alliedSessions = await allied.page.evaluate(() =>
    JSON.parse(localStorage.getItem("frontline-games") || "{}"),
  );
  const axisSessions = await axis.page.evaluate(() =>
    JSON.parse(localStorage.getItem("frontline-games") || "{}"),
  );
  await writeFile(
    `${root}/state.json`,
    JSON.stringify(
      {
        gameID,
        joinCode,
        alliedToken: alliedSessions[gameID],
        axisToken: axisSessions[gameID],
        alliedErrors: allied.errors,
        axisErrors: axis.errors,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ gameID, joinCode, alliedErrors: allied.errors, axisErrors: axis.errors }));
} finally {
  await allied.context.close();
  await axis.context.close();
}
