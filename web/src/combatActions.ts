import type { Battle, WorldUnit } from "./types";

export function bombardmentOptions(battle: Battle, units: Record<string, WorldUnit>) {
  const assaultSeas = new Set<string>();
  let limit = 0;
  for (const unit of Object.values(units)) {
    if (unit.owner !== battle.attacker || unit.space !== battle.territory || !unit.amphibious || !unit.assaultTransportId) continue;
    const transport = units[unit.assaultTransportId];
    if (transport) assaultSeas.add(transport.space);
    limit++;
  }
  const ids = Object.values(units)
    .filter(unit => unit.owner === battle.attacker && (unit.type === "Cruiser" || unit.type === "Battleship") && !unit.combatUsed && assaultSeas.has(unit.space))
    .map(unit => unit.id)
    .sort();
  return { ids, limit };
}

export function toggleBombarder(selected: string[], id: string, valid: string[], limit: number) {
  if (selected.includes(id)) return selected.filter(candidate => candidate !== id);
  if (!valid.includes(id) || selected.length >= limit) return selected;
  return [...selected, id];
}

export function submergePayload(territory: string, unitIds: string[]) {
  return { territory, unitIds };
}
