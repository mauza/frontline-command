import { readFile } from "node:fs/promises";

const root = "/tmp/opencode/frontline-production-playtest";
const state = JSON.parse(await readFile(`${root}/state.json`, "utf8"));
const url = `https://war.mau.guru/api/games/${state.gameID}`;
const allied = new Set(["Soviet Union", "United Kingdom", "United States"]);
const costs = {
  Infantry: 3, Artillery: 4, AAA: 5, Tank: 6, Submarine: 6,
  Destroyer: 8, Fighter: 10, Cruiser: 12, Bomber: 12,
  "Aircraft Carrier": 14, Battleship: 20, Transport: 999,
};

function tokenFor(power) {
  return allied.has(power) ? state.alliedToken : state.axisToken;
}

async function load() {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${state.alliedToken}` } });
  if (!response.ok) throw new Error(`load failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function command(game, power, type, payload) {
  const response = await fetch(`${url}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(power)}` },
    body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: game.version, type, payload }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${type}: ${response.status} ${body}`);
  const result = JSON.parse(body);
  console.log(`${result.version}: ${result.message}`);
}

function casualties(game, pending) {
  const candidates = pending.eligible
    .map((id) => game.worldUnits[id])
    .filter(Boolean)
    .sort((a, b) => (costs[a.type] ?? 100) - (costs[b.type] ?? 100));
  let capacity = 0;
  for (const unit of candidates) capacity += unit.type === "Battleship" && !unit.damage ? 2 : 1;
  const maximum = Math.min(pending.hits, capacity);
  const minimum = pending.group ? (pending.minHits ?? 0) : maximum;
  let remaining = pending.group
    ? Math.min(maximum, Math.max(minimum, candidates.filter((unit) => unit.type !== "Transport").length))
    : maximum;
  const ids = [];
  const ordered = pending.group
    ? candidates.filter((unit) => unit.type !== "Transport").concat(candidates.filter((unit) => unit.type === "Transport"))
    : candidates;
  for (const unit of ordered) {
    if (!remaining) break;
    ids.push(unit.id);
    remaining--;
    if (remaining && unit.type === "Battleship" && !unit.damage) {
      ids.push(unit.id);
      remaining--;
    }
  }
  return ids;
}

for (let step = 0; step < 300; step++) {
  const game = await load();
  if (game.currentPhase !== "Resolve Combat") break;
  const entry = Object.entries(game.battles).find(([, battle]) => !battle.complete);
  if (!entry) break;
  const [territory, battle] = entry;
  const pending = battle.pendingDecision;
  if (!battle.started) {
    await command(game, game.currentPower, "start_battle", { territory, bombarders: [] });
  } else if (!pending) {
    await command(game, game.currentPower, "battle_step", { territory });
  } else if (pending.kind === "choose-casualties") {
    await command(game, pending.power, "choose_casualties", { territory, unitIds: casualties(game, pending) });
  } else if (pending.kind === "choose-submerge") {
    await command(game, pending.power, "submerge", { territory, unitIds: [] });
  } else if (pending.kind === "choose-retreat") {
    await command(game, pending.power, "continue_battle", { territory });
  } else if (pending.kind === "choose-fighter-landing") {
    const unitId = pending.eligible[0];
    const destination = pending.destinations?.[unitId]?.[0] || "";
    await command(game, pending.power, "land_fighter", { territory, unitId, destination });
  } else {
    throw new Error(`unsupported decision ${pending.kind}`);
  }
}

const final = await load();
console.log(JSON.stringify({ version: final.version, phase: final.currentPhase, battles: final.battles }));
