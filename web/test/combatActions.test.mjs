import assert from "node:assert/strict";
import test from "node:test";
import { bombardmentOptions, submergePayload, toggleBombarder } from "../src/combatActions.ts";

test("bombardment options only include unused ships sharing an assault sea", () => {
  const battle = { territory: "coast", attacker: "Germany" };
  const units = {
    land: { id: "land", type: "Infantry", owner: "Germany", space: "coast", amphibious: true, assaultTransportId: "transport" },
    transport: { id: "transport", type: "Transport", owner: "Germany", space: "assault" },
    valid: { id: "valid", type: "Cruiser", owner: "Germany", space: "assault" },
    used: { id: "used", type: "Battleship", owner: "Germany", space: "assault", combatUsed: true },
    adjacent: { id: "adjacent", type: "Cruiser", owner: "Germany", space: "other" },
  };
  assert.deepEqual(bombardmentOptions(battle, units), { ids: ["valid"], limit: 1 });
  assert.deepEqual(toggleBombarder([], "valid", ["valid"], 1), ["valid"]);
  assert.deepEqual(toggleBombarder(["valid"], "adjacent", ["valid"], 1), ["valid"]);
});

test("submerge action preserves an explicit empty selection", () => {
  assert.deepEqual(submergePayload("sea", []), { territory: "sea", unitIds: [] });
});
