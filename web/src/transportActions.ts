import type { WorldUnit } from "./types";

const axis = new Set(["Germany", "Japan"]);

export function alliedPower(a: string, b: string) {
  return !!a && !!b && axis.has(a) === axis.has(b);
}

export function stationaryTransportOptions(
  units: Record<string, WorldUnit>,
  power: string,
) {
  return Object.values(units)
    .filter(
      (unit) =>
        unit.type === "Transport" &&
        !unit.transportId &&
        alliedPower(unit.owner, power),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function completeCargoManifest(
  units: Record<string, WorldUnit>,
  transportID: string,
  additions: string[] = [],
) {
  return [
    ...new Set([
      ...Object.values(units)
        .filter((unit) => unit.transportId === transportID)
        .map((unit) => unit.id),
      ...additions,
    ]),
  ].sort();
}
