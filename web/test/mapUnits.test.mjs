import assert from "node:assert/strict";
import test from "node:test";
import { groupUnitStacks } from "../src/mapUnits.ts";

test("groups visible units by space, owner, and type", () => {
  const stacks = groupUnitStacks({
    a: { id: "a", owner: "Germany", type: "Infantry", space: "germany" },
    b: { id: "b", owner: "Germany", type: "Infantry", space: "germany" },
    c: { id: "c", owner: "Germany", type: "Tank", space: "germany" },
    d: { id: "d", owner: "United Kingdom", type: "Fighter", space: "germany" },
    cargo: {
      id: "cargo",
      owner: "Germany",
      type: "Infantry",
      space: "",
      transportId: "ship",
    },
  });
  assert.deepEqual(stacks.germany, [
    { owner: "Germany", type: "Infantry", count: 2 },
    { owner: "Germany", type: "Tank", count: 1 },
    { owner: "United Kingdom", type: "Fighter", count: 1 },
  ]);
});
