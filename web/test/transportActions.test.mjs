import assert from "node:assert/strict";
import test from "node:test";
import {
  completeCargoManifest,
  stationaryTransportOptions,
} from "../src/transportActions.ts";

test("stationary transport options include allied transports for own cargo", () => {
  const units = {
    soviet: { id: "soviet", type: "Transport", owner: "Soviet Union", space: "sea" },
    british: { id: "british", type: "Transport", owner: "United Kingdom", space: "sea" },
    german: { id: "german", type: "Transport", owner: "Germany", space: "sea" },
  };
  assert.deepEqual(
    stationaryTransportOptions(units, "United Kingdom").map((unit) => unit.id),
    ["british", "soviet"],
  );
});

test("cargo orders preserve the complete multinational manifest", () => {
  const units = {
    transport: { id: "transport", type: "Transport", owner: "Soviet Union", space: "sea" },
    british: { id: "british", type: "Infantry", owner: "United Kingdom", space: "", transportId: "transport" },
    soviet: { id: "soviet", type: "Infantry", owner: "Soviet Union", space: "", transportId: "transport" },
    newCargo: { id: "new", type: "Infantry", owner: "United Kingdom", space: "coast" },
  };
  assert.deepEqual(completeCargoManifest(units, "transport", ["new"]), [
    "british",
    "new",
    "soviet",
  ]);
});
