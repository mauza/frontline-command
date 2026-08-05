import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const root = "/tmp/opencode/frontline-production-playtest";
const state = JSON.parse(await readFile(`${root}/state.json`, "utf8"));
const game = await fetch(`https://war.mau.guru/api/games/${state.gameID}`, {
  headers: { Authorization: `Bearer ${state.alliedToken}` },
}).then((response) => response.json());
const units = Object.values(game.worldUnits);
const used = new Set();
const names = {
  archangel: "Archangel",
  caucasus: "Caucasus",
  "karelia-ssr": "Karelia S.S.R.",
  russia: "Russia",
  "ukraine-ssr": "Ukraine S.S.R.",
  "west-russia": "West Russia",
};

function choose(space, requested) {
  const chosen = [];
  for (const [type, count] of Object.entries(requested)) {
    const matches = units.filter(
      (unit) => unit.space === space && unit.type === type && !used.has(unit.id),
    );
    if (matches.length < count) throw new Error(`not enough ${type} in ${space}`);
    for (const unit of matches.slice(0, count)) {
      used.add(unit.id);
      chosen.push(unit.id);
    }
  }
  return chosen;
}

const plans = [
  { source: "russia", units: choose("russia", { Infantry: 4, Artillery: 1 }), path: ["west-russia"] },
  { source: "karelia-ssr", units: choose("karelia-ssr", { Infantry: 4, Artillery: 1 }), path: ["west-russia"] },
  { source: "archangel", units: choose("archangel", { Infantry: 1, Tank: 1 }), path: ["west-russia"] },
  { source: "caucasus", units: choose("caucasus", { Infantry: 3, Artillery: 1, Tank: 1 }), path: ["ukraine-ssr"] },
  { source: "russia", units: choose("russia", { Tank: 2, Fighter: 1 }), path: ["caucasus", "ukraine-ssr"] },
  { source: "karelia-ssr", units: choose("karelia-ssr", { Fighter: 1 }), path: ["west-russia", "ukraine-ssr"] },
];

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

async function submit(label) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/commands") && response.request().method() === "POST",
  );
  await page.getByText(label, { exact: true }).click();
  const response = await responsePromise;
  const body = await response.text();
  if (!response.ok()) throw new Error(`${label}: ${response.status()} ${body}`);
  return body;
}

try {
  await page.goto(`https://war.mau.guru/game/${state.gameID}`, { waitUntil: "networkidle" });
  for (const plan of plans) {
    await page.getByRole("button", { name: `Select ${names[plan.source]}` }).click();
    for (const id of plan.units) await page.getByText(id, { exact: false }).click();
    for (const space of plan.path) {
      await page.getByRole("button", { name: `Select ${names[space]}` }).click();
    }
    await page.getByText("Add route", { exact: true }).click();
  }
  await page.screenshot({ path: `${root}/08-soviet-combat-routes.png`, fullPage: true });
  const moveButton = page.getByText(/Submit movement plan \(\d+ units\)/).last();
  const moveLabel = await moveButton.innerText();
  const movement = await submit(moveLabel);
  await page.screenshot({ path: `${root}/09-soviet-combat-submitted.png`, fullPage: true });
  const complete = await submit("Complete Combat Move");
  console.log(JSON.stringify({ movement: JSON.parse(movement), complete: JSON.parse(complete), errors }));
} finally {
  await context.close();
}
