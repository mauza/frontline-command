export type UnitSpec = { Cost: number; Move: number; Attack: number; Defense: number };
export type Player = { id: string; name: string; powers: string[]; isOwner: boolean };
export type GameEvent = { sequence: number; kind: string; message: string; at: string };

export type WorldUnit = {
  id: string;
  type: string;
  owner: string;
  space: string;
  damage?: number;
  moved?: number;
  transportId?: string;
  amphibious?: boolean;
  combatUsed?: boolean;
  assaultTransportId?: string;
  createdRound?: number;
};

export type PendingDecision = {
  kind: "choose-casualties" | "choose-submerge" | "choose-retreat" | "choose-fighter-landing";
  power?: string;
  hits?: number;
  eligible?: string[];
  destinations?: Record<string, string[]>;
  options?: string[];
  minHits?: number;
  group?: number;
};

export type Battle = {
  territory: string;
  attacker: string;
  round: number;
  pendingDecision?: PendingDecision;
  complete: boolean;
  winner?: string;
  bombarders?: string[];
  stage: string;
  started?: boolean;
};

export type BoardSpace = {
  id: string;
  name: string;
  kind: "land" | "sea";
  x: number;
  y: number;
  polygons: string[];
  ipc?: number;
  owner?: string;
  capital?: boolean;
  victoryCity?: boolean;
  impassable?: boolean;
};

export type BoardCatalog = {
  width: number;
  height: number;
  spaces: BoardSpace[];
  connections: { a: string; b: string }[];
};

export type MoveOrder = { unitId: string; path: string[] };
export type Placement = { Type: string; Space: string; Count: number };

export type Game = {
  id: string;
  name: string;
  joinCode: string;
  version: number;
  currentPower: string;
  currentPhase: string;
  updatedAt: string;
  me: Player;
  players: Player[];
  units: Record<string, UnitSpec>;
  events: GameEvent[];
  owners: Record<string, string>;
  worldUnits: Record<string, WorldUnit>;
  purchased?: string[];
  pendingDecisions: Record<string, PendingDecision>;
  battles: Record<string, Battle>;
  powers: Record<string, { ipc: number; capitalHeld: boolean }>;
  state: {
    status: string;
    round: number;
    ipcs: Record<string, number>;
    income: Record<string, number>;
    purchases: Record<string, Record<string, number>>;
    winner?: string;
    world?: { turnStart?: { units: Record<string, WorldUnit> } };
  };
};
