import { readFile } from "node:fs/promises";

const [player, type, payloadRaw = "{}"] = process.argv.slice(2);
if (!player || !type) throw new Error("usage: qa-command.mjs <allied|axis> <type> [payload JSON]");
const root = "/tmp/opencode/frontline-production-playtest";
const state = JSON.parse(await readFile(`${root}/state.json`, "utf8"));
const token = state[`${player}Token`];
if (!token) throw new Error(`missing token for ${player}`);
const url = `https://war.mau.guru/api/games/${state.gameID}`;
const gameResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!gameResponse.ok) throw new Error(`load failed: ${gameResponse.status} ${await gameResponse.text()}`);
const game = await gameResponse.json();
const response = await fetch(`${url}/commands`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    commandId: crypto.randomUUID(),
    expectedVersion: game.version,
    type,
    payload: JSON.parse(payloadRaw),
  }),
});
const body = await response.text();
if (!response.ok) throw new Error(`${response.status} ${body}`);
console.log(body);
