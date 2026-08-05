import type { WorldUnit } from "./types";

export type UnitStack = { owner: string; type: string; count: number };

const ownerOrder = [
  "Soviet Union",
  "Germany",
  "United Kingdom",
  "Japan",
  "United States",
];
const unitOrder = [
  "Infantry",
  "Artillery",
  "Tank",
  "AAA",
  "Fighter",
  "Bomber",
  "Submarine",
  "Transport",
  "Destroyer",
  "Cruiser",
  "Aircraft Carrier",
  "Battleship",
  "Industrial Complex",
];

export function groupUnitStacks(
  units: Record<string, WorldUnit>,
): Record<string, UnitStack[]> {
  const grouped: Record<string, Map<string, UnitStack>> = {};
  for (const unit of Object.values(units)) {
    if (!unit.space || unit.transportId) continue;
    grouped[unit.space] ??= new Map();
    const key = `${unit.owner}\0${unit.type}`;
    const current = grouped[unit.space].get(key);
    if (current) current.count++;
    else
      grouped[unit.space].set(key, {
        owner: unit.owner,
        type: unit.type,
        count: 1,
      });
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([space, stacks]) => [
      space,
      [...stacks.values()].sort(
        (a, b) =>
          ownerOrder.indexOf(a.owner) - ownerOrder.indexOf(b.owner) ||
          unitOrder.indexOf(a.type) - unitOrder.indexOf(b.type),
      ),
    ]),
  );
}
