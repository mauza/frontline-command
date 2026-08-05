import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Board } from "./Board";
import {
  bombardmentOptions,
  submergePayload,
  toggleBombarder,
} from "./combatActions";
import {
  alliedPower as allied,
  completeCargoManifest,
  stationaryTransportOptions,
} from "./transportActions";
import type {
  Battle,
  BoardCatalog,
  BoardSpace,
  Game,
  GameEvent,
  MoveOrder,
  WorldUnit,
} from "./types";
import "./theme.css";

const API = "/api",
  storageKey = "frontline-games";
type Sessions = Record<string, string>;
type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  round: number;
  updatedAt: string;
  playerName: string;
  isOwner: boolean;
};
async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok)
    throw new Error(
      (body as { error?: string }).error ||
        `Request failed (${response.status})`,
    );
  return body as T;
}

function App() {
  const [sessions, setSessions] = useState<Sessions>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  });
  const [gameID, setGameID] = useState(() =>
    location.pathname.startsWith("/game/")
      ? location.pathname.split("/")[2]
      : "",
  );
  const [game, setGame] = useState<Game | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const remember = (id: string, token: string) => {
    const next = { ...sessions, [id]: token };
    setSessions(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    history.pushState({}, "", `/game/${id}`);
    setGameID(id);
  };
  const forget = (id: string) => {
    const next = { ...sessions };
    delete next[id];
    setSessions(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const openGame = (id: string) => {
    history.pushState({}, "", `/game/${id}`);
    setGame(null);
    setError("");
    setGameID(id);
  };
  const load = async () => {
    if (!gameID || !sessions[gameID]) return;
    try {
      setGame(await request<Game>(`/games/${gameID}`, {}, sessions[gameID]));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const timer = gameID ? window.setInterval(() => void load(), 10000) : 0;
    return () => clearInterval(timer);
  }, [gameID, sessions[gameID]]);
  useEffect(() => {
    const pop = () => {
      const id = location.pathname.startsWith("/game/")
        ? location.pathname.split("/")[2]
        : "";
      setGameID(id);
      if (!id) setGame(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  const command = async (type: string, payload: object = {}) => {
    if (!game || busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ message: string }>(
        `/games/${game.id}/commands`,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            expectedVersion: game.version,
            type,
            payload,
          }),
        },
        sessions[game.id],
      );
      setNotice(result.message);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!gameID)
    return (
      <Landing
        remember={remember}
        error={error}
        setError={setError}
        busy={busy}
        setBusy={setBusy}
        sessions={sessions}
        openGame={openGame}
        forget={forget}
      />
    );
  if (!sessions[gameID])
    return (
      <Shell>
        <ErrorBanner message="This browser does not have a token for that private game." />
        <Button
          label="Return home"
          onPress={() => {
            history.pushState({}, "", "/");
            setGameID("");
          }}
        />
      </Shell>
    );
  if (!game)
    return (
      <Shell>
        <Text style={s.eyebrow}>OPENING SECURE CHANNEL</Text>
        <Text style={s.title}>Loading war room...</Text>
        {error && <ErrorBanner message={error} />}
        {error && (
          <>
            <Button
              label="Return to campaigns"
              onPress={() => {
                history.pushState({}, "", "/");
                setGameID("");
                setGame(null);
              }}
            />
            <Pressable onPress={() => forget(gameID)}>
              <Text style={s.dangerLink}>Forget this campaign on this browser</Text>
            </Pressable>
          </>
        )}
      </Shell>
    );
  return (
    <WarRoom
      game={game}
      busy={busy}
      error={error}
      notice={notice}
      command={command}
      leave={() => {
        history.pushState({}, "", "/");
        setGameID("");
        setGame(null);
      }}
    />
  );
}

function Landing({
  remember,
  error,
  setError,
  busy,
  setBusy,
  sessions,
  openGame,
  forget,
}: {
  remember: (id: string, t: string) => void;
  error: string;
  setError: (v: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  sessions: Sessions;
  openGame: (id: string) => void;
  forget: (id: string) => void;
}) {
  const narrow = useWindowDimensions().width < 850;
  const [mode, setMode] = useState<"create" | "join">("create"),
    [gameName, setGameName] = useState(""),
    [playerName, setPlayerName] = useState(""),
    [code, setCode] = useState(""),
    [campaigns, setCampaigns] = useState<CampaignSummary[]>([]),
    [unavailable, setUnavailable] = useState<string[]>([]),
    [loadingCampaigns, setLoadingCampaigns] = useState(false),
    [confirming, setConfirming] = useState(""),
    [confirmationName, setConfirmationName] = useState(""),
    [deleting, setDeleting] = useState("");
  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(sessions);
    if (!entries.length) {
      setCampaigns([]);
      setUnavailable([]);
      return;
    }
    setLoadingCampaigns(true);
    void Promise.all(
      entries.map(async ([id, token]) => {
        try {
          return await request<CampaignSummary>(`/games/${id}/summary`, {}, token);
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setCampaigns(
        results
          .filter((campaign): campaign is CampaignSummary => campaign !== null)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      setUnavailable(
        entries
          .filter((_, index) => results[index] === null)
          .map(([id]) => id),
      );
      setLoadingCampaigns(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sessions]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "create"
          ? await request<{ id: string; token: string }>("/games", {
              method: "POST",
              body: JSON.stringify({ name: gameName, playerName }),
            })
          : await request<{ id: string; token: string }>("/games/join", {
              method: "POST",
              body: JSON.stringify({ code, playerName }),
            });
      remember(result.id, result.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteCampaign = async (campaign: CampaignSummary) => {
    setDeleting(campaign.id);
    setError("");
    try {
      await request(
        `/games/${campaign.id}`,
        { method: "DELETE", body: JSON.stringify({ name: confirmationName }) },
        sessions[campaign.id],
      );
      forget(campaign.id);
      setConfirming("");
      setConfirmationName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting("");
    }
  };
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[s.landing, narrow && s.column]}
    >
      <View style={[s.hero, narrow && s.heroNarrow]}>
        <Brand />
        <Text style={s.kicker}>CLASSIC 1942 / PRIVATE MULTIPLAYER</Text>
        <Text style={[s.heroTitle, narrow && s.heroTitleNarrow]}>
          The long game,{"\n"}
          <Text style={s.gold}>beautifully organized.</Text>
        </Text>
        <Text style={s.heroCopy}>
          A persistent, authoritative war room for Axis & Allies 1942 Second
          Edition.
        </Text>
        <Text style={s.heroFoot}>5 POWERS / 6 PHASES / ONE WORLD MAP</Text>
      </View>
      <View style={[s.access, narrow && s.accessNarrow]}>
        <Text style={s.eyebrow}>ESTABLISH COMMAND</Text>
        <Text style={s.panelTitle}>
          {mode === "create" ? "Open a campaign" : "Join your allies"}
        </Text>
        <View style={s.tabs}>
          <Tab
            active={mode === "create"}
            label="Create game"
            onPress={() => setMode("create")}
          />
          <Tab
            active={mode === "join"}
            label="Join by code"
            onPress={() => setMode("join")}
          />
        </View>
        {mode === "create" ? (
          <Field
            label="CAMPAIGN NAME"
            value={gameName}
            onChange={setGameName}
            placeholder="Sunday Night 1942"
          />
        ) : (
          <Field
            label="INVITE CODE"
            value={code}
            onChange={(v) => setCode(v.toUpperCase())}
            placeholder="A7K9QZ"
          />
        )}
        <Field
          label="YOUR CALLSIGN"
          value={playerName}
          onChange={setPlayerName}
          placeholder="Commander name"
        />
        {error && <ErrorBanner message={error} />}
        <Button
          label={
            busy
              ? "Establishing..."
              : mode === "create"
                ? "Create campaign"
                : "Enter war room"
          }
          onPress={submit}
          disabled={busy}
        />
        {Object.keys(sessions).length > 0 && (
          <View style={s.campaignSection}>
            <Text style={s.eyebrow}>YOUR CAMPAIGNS</Text>
            {loadingCampaigns && (
              <Text style={s.footnote}>Checking secure campaign access...</Text>
            )}
            {campaigns.map((campaign) => (
              <View key={campaign.id} style={s.campaignCard}>
                <Pressable
                  style={s.campaignOpen}
                  onPress={() => openGame(campaign.id)}
                >
                  <View style={s.flex}>
                    <Text style={s.campaignName}>{campaign.name}</Text>
                    <Text style={s.campaignMeta}>
                      {campaign.status.toUpperCase()} / ROUND {campaign.round} / {campaign.playerName}
                    </Text>
                  </View>
                  <Text style={s.campaignArrow}>→</Text>
                </Pressable>
                {campaign.isOwner && confirming !== campaign.id && (
                  <Pressable
                    onPress={() => {
                      setConfirming(campaign.id);
                      setConfirmationName("");
                    }}
                  >
                    <Text style={s.campaignDelete}>Delete permanently</Text>
                  </Pressable>
                )}
                {campaign.isOwner && confirming === campaign.id && (
                  <View style={s.deleteConfirm}>
                    <Text style={s.deleteWarning}>
                      Type "{campaign.name}" to permanently delete this campaign.
                    </Text>
                    <TextInput
                      value={confirmationName}
                      onChangeText={setConfirmationName}
                      placeholder={campaign.name}
                      placeholderTextColor="#8c8f88"
                      style={s.input}
                    />
                    <View style={s.confirmActions}>
                      <SmallButton
                        label={deleting === campaign.id ? "Deleting..." : "Delete forever"}
                        disabled={
                          deleting === campaign.id ||
                          confirmationName !== campaign.name
                        }
                        onPress={() => void deleteCampaign(campaign)}
                      />
                      <SmallButton
                        label="Cancel"
                        disabled={deleting === campaign.id}
                        onPress={() => {
                          setConfirming("");
                          setConfirmationName("");
                        }}
                      />
                    </View>
                  </View>
                )}
              </View>
            ))}
            {unavailable.map((id) => (
              <View key={id} style={s.unavailableCampaign}>
                <Text style={s.campaignMeta}>UNAVAILABLE / {id}</Text>
                <Pressable onPress={() => forget(id)}>
                  <Text style={s.campaignDelete}>Forget from this browser</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function WarRoom({
  game,
  busy,
  error,
  notice,
  command,
  leave,
}: {
  game: Game;
  busy: boolean;
  error: string;
  notice: string;
  command: (t: string, p?: object) => Promise<boolean>;
  leave: () => void;
}) {
  const narrow = useWindowDimensions().width < 900,
    myTurn = game.me.powers.includes(game.currentPower),
    movement =
      game.currentPhase === "Combat Move" ||
      game.currentPhase === "Noncombat Move";
  const [catalog, setCatalog] = useState<BoardCatalog | null>(null),
    [selectedUnits, setSelectedUnits] = useState<string[]>([]),
    [route, setRoute] = useState<string[]>([]),
    [moves, setMoves] = useState<MoveOrder[]>([]),
    [placeType, setPlaceType] = useState(""),
    [placeTarget, setPlaceTarget] = useState(""),
    [concedeArmed, setConcedeArmed] = useState(false);
  const canConcede =
    ["Soviet Union", "United Kingdom", "United States"].every((power) =>
      game.me.powers.includes(power),
    ) ||
    ["Germany", "Japan"].every((power) => game.me.powers.includes(power));
  useEffect(() => {
    setSelectedUnits([]);
    setRoute([]);
    setMoves([]);
    setPlaceType("");
    setPlaceTarget("");
  }, [game.currentPhase, game.currentPower]);
  const toggleUnit = (id: string) => {
    setSelectedUnits((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      const origin = game.worldUnits[id]?.space;
      return current.some(
        (selected) => game.worldUnits[selected]?.space !== origin,
      )
        ? [id]
        : [...current, id];
    });
    setRoute([]);
  };
  const boardClick = (space: BoardSpace, board: BoardCatalog) => {
    if (movement && selectedUnits.length) {
      const origins = [
        ...new Set(selectedUnits.map((id) => game.worldUnits[id]?.space)),
      ];
      if (origins.length !== 1) return;
      const current = route.length ? route : [origins[0]];
      const last = current[current.length - 1];
      if (space.id === last) return;
      if (
        board.connections.some(
          (e) =>
            (e.a === last && e.b === space.id) ||
            (e.b === last && e.a === space.id),
        )
      )
        setRoute([...current, space.id]);
      return;
    }
    if (game.currentPhase === "Place Units" && placeType)
      setPlaceTarget(space.id);
  };
  const addRoute = () => {
    if (route.length < 2) return;
    setMoves((current) => [
      ...current.filter((m) => !selectedUnits.includes(m.unitId)),
      ...selectedUnits.map((unitId) => ({ unitId, path: route })),
    ]);
    setSelectedUnits([]);
    setRoute([]);
  };
  const submitMoves = async (
    transports: { transportId: string; landUnits: string[]; unload?: string }[],
  ) => {
    const all =
      route.length > 1
        ? [
            ...moves,
            ...selectedUnits.map((unitId) => ({ unitId, path: route })),
          ]
        : moves;
    if (await command("movement_plan", { moves: all, transports }))
      setMoves([]);
  };
  const routeNeighbors =
    route.length && catalog
      ? catalog.connections.flatMap((e) =>
          e.a === route.at(-1) ? [e.b] : e.b === route.at(-1) ? [e.a] : [],
        )
      : [];
  return (
    <View style={s.app}>
      <View style={s.topbar}>
        <Brand />
        <Pressable onPress={leave}>
          <Text style={s.quietLink}>Campaigns</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.dashboard}>
        <View style={s.gameHeader}>
          <View>
            <Text style={s.eyebrow}>CAMPAIGN / ROUND {game.state.round}</Text>
            <Text style={s.title}>{game.name}</Text>
            <Text style={s.subtitle}>
              Invite code <Text style={s.code}>{game.joinCode}</Text>
            </Text>
          </View>
          <StatusPill status={game.state.status} />
        </View>
        {error && <ErrorBanner message={error} />}{" "}
        {notice && (
          <View style={s.noticeBanner}>
            <Text style={s.noticeText}>{notice}</Text>
          </View>
        )}
        {game.state.status === "lobby" ? (
          <Lobby game={game} busy={busy} command={command} />
        ) : game.state.status === "finished" ? (
          <View style={s.card}>
            <Text style={s.eyebrow}>CAMPAIGN COMPLETE</Text>
            <Text style={s.cardTitle}>{game.state.winner} victory</Text>
            <Text style={s.subtitle}>
              The server has declared this campaign finished.
            </Text>
          </View>
        ) : (
          <>
            <View style={s.turnCard}>
              <View>
                <Text style={s.eyebrow}>
                  {myTurn ? "YOUR ORDERS ARE REQUIRED" : "AWAITING COMMAND"}
                </Text>
                <Text style={s.turnPower}>{game.currentPower}</Text>
                <Text style={s.subtitle}>
                  Round {game.state.round} / {game.currentPhase}
                </Text>
              </View>
              <View style={s.ipcBadge}>
                <Text style={s.ipcValue}>
                  {game.state.ipcs[game.currentPower]}
                </Text>
                <Text style={s.ipcLabel}>IPC</Text>
              </View>
            </View>
            {Object.entries(game.pendingDecisions).map(([territory, d]) => (
              <View key={territory} style={s.decisionAlert}>
                <Text style={s.decisionTitle}>
                  DECISION PENDING / {spaceName(catalog, territory)}
                </Text>
                <Text style={s.decisionCopy}>
                  {decisionDescription(d.kind, d.power, d.hits, d.minHits)}
                </Text>
              </View>
            ))}
            {Object.entries(game.pendingDecisions)
              .filter(([, d]) => d.kind === "choose-fighter-landing")
              .map(([territory]) => (
                <FighterLandingDecision
                  key={territory}
                  territory={territory}
                  game={game}
                  catalog={catalog}
                  disabled={busy}
                  command={command}
                />
              ))}
            {Object.entries(game.pendingDecisions)
              .filter(([, d]) => d.kind === "choose-retreat")
              .map(([territory]) => (
                <RetreatDecision
                  key={territory}
                  territory={territory}
                  game={game}
                  catalog={catalog}
                  disabled={busy}
                  command={command}
                />
              ))}
            {Object.entries(game.pendingDecisions)
              .filter(([, d]) => d.kind === "choose-casualties" && !!d.group)
              .map(([territory]) => (
                <OwnerCasualtyDecision
                  key={territory}
                  territory={territory}
                  game={game}
                  catalog={catalog}
                  disabled={busy}
                  command={command}
                />
              ))}
            <PhaseGuide phase={game.currentPhase} myTurn={myTurn} />
            <View style={s.boardSection}>
              <Board
                owners={game.owners}
                units={game.worldUnits}
                currentPower={game.currentPower}
                canSelectUnits={myTurn && movement}
                selectedUnitIds={selectedUnits}
                route={route}
                highlightedSpaces={routeNeighbors}
                onToggleUnit={toggleUnit}
                onSpacePress={boardClick}
                onCatalog={setCatalog}
              />
            </View>
            <View style={[s.grid, narrow && s.column]}>
              <View style={s.mainColumn}>
                {movement && (
                  <MovementPanel
                    moves={moves}
                    route={route}
                    selected={selectedUnits}
                    units={game.worldUnits}
                    power={game.currentPower}
                    catalog={catalog}
                    addRoute={addRoute}
                    clear={() => {
                      setSelectedUnits([]);
                      setRoute([]);
                    }}
                    remove={(id) =>
                      setMoves((x) => x.filter((m) => m.unitId !== id))
                    }
                    submit={submitMoves}
                    disabled={!myTurn || busy}
                  />
                )}{" "}
                {movement && (
                  <StationaryTransportPanel
                    game={game}
                    catalog={catalog}
                    disabled={!myTurn || busy}
                    command={command}
                  />
                )}{" "}
                {movement && game.currentPhase === "Combat Move" && (
                  <IgnoreSeaUnitsPanel
                    game={game}
                    catalog={catalog}
                    moves={moves}
                    disabled={!myTurn || busy}
                    command={command}
                    clear={() => setMoves([])}
                  />
                )}{" "}
                {game.currentPhase === "Purchase" && (
                  <PurchasePanel
                    game={game}
                    disabled={!myTurn || busy}
                    command={command}
                  />
                )}{" "}
                {game.currentPhase === "Resolve Combat" && (
                  <CombatPanel
                    game={game}
                    catalog={catalog}
                    disabled={busy}
                    command={command}
                  />
                )}{" "}
                {game.currentPhase === "Place Units" && (
                  <PlacementPanel
                    game={game}
                    type={placeType}
                    target={placeTarget}
                    setType={setPlaceType}
                    setTarget={setPlaceTarget}
                    catalog={catalog}
                    disabled={!myTurn || busy}
                    command={command}
                  />
                )}{" "}
                {game.currentPhase === "Collect Income" && (
                  <InfoCard
                    title="Collect income"
                    copy={`${game.currentPower} will collect ${game.state.income[game.currentPower]} IPCs and end its turn.`}
                  />
                )}{" "}
                {myTurn && (
                  <Button
                    label={
                      busy
                        ? "Recording orders..."
                        : game.currentPhase === "Collect Income"
                          ? "Collect income & end turn"
                          : `Complete ${game.currentPhase}`
                    }
                    onPress={() => void command("complete_phase")}
                    disabled={busy}
                  />
                )}
              </View>
              <View style={[s.sideColumn, narrow && s.sideWide]}>
                <PowerLedger game={game} />
                <Activity events={game.events} />
              </View>
            </View>
          </>
        )}
        {game.state.status === "active" && canConcede && (
          <View style={s.deleteConfirm}>
            {concedeArmed ? (
              <>
                <Text style={s.deleteWarning}>
                  Conceding immediately awards victory to the opposing alliance.
                </Text>
                <View style={s.inline}>
                  <Pressable
                    disabled={busy}
                    onPress={() => void command("concede_game")}
                  >
                    <Text style={s.dangerLink}>Confirm concession</Text>
                  </Pressable>
                  <Pressable onPress={() => setConcedeArmed(false)}>
                    <Text style={s.quietLink}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable onPress={() => setConcedeArmed(true)}>
                <Text style={s.dangerLink}>Concede campaign</Text>
              </Pressable>
            )}
          </View>
        )}
        {game.me.isOwner && game.state.status === "active" && (
          <Pressable onPress={() => void command("abandon_game")}>
            <Text style={s.dangerLink}>Mark campaign abandoned</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function PhaseGuide({ phase, myTurn }: { phase: string; myTurn: boolean }) {
  const instructions: Record<string, string> = {
    Purchase:
      "Purchase and repair below the map, then complete this phase to unlock Combat Move.",
    "Combat Move":
      "Select a territory, choose one or more of your units in the map inspector, then click adjacent spaces to plot a route. Add the route and submit the movement plan.",
    "Resolve Combat":
      "Resolve every highlighted battle below the map. Combat cannot be skipped while a battle or decision remains.",
    "Noncombat Move":
      "Select your units on the map and plot movement through friendly spaces. All aircraft must finish with a legal landing.",
    "Place Units":
      "Choose purchased units below the map, then select a legal factory territory or adjacent sea zone.",
    "Collect Income":
      "Review your controlled territories and collect income to finish the turn.",
  };
  return (
    <View style={s.phaseGuide}>
      <Text style={s.phaseGuideTitle}>
        {myTurn ? "HOW TO PLAY THIS PHASE" : "CURRENT PHASE"}
      </Text>
      <Text style={s.phaseGuideText}>
        {myTurn
          ? instructions[phase] || "Use the controls below the map to continue."
          : `Waiting for the ${phase} orders from the active commander.`}
      </Text>
    </View>
  );
}

function MovementPanel({
  moves,
  route,
  selected,
  units,
  power,
  catalog,
  addRoute,
  clear,
  remove,
  submit,
  disabled,
}: {
  moves: MoveOrder[];
  route: string[];
  selected: string[];
  units: Record<string, WorldUnit>;
  power: string;
  catalog: BoardCatalog | null;
  addRoute: () => void;
  clear: () => void;
  remove: (id: string) => void;
  submit: (
    orders: { transportId: string; landUnits: string[]; unload?: string }[],
  ) => void;
  disabled: boolean;
}) {
  const [cargo, setCargo] = useState<Record<string, string[]>>({}),
    [unloads, setUnloads] = useState<Record<string, string>>({});
  const transportMoves = moves.filter(
    (m) => units[m.unitId]?.type === "Transport",
  );
  const adjacent = (a: string, b: string) =>
    !!catalog?.connections.some(
      (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
    );
  const landTypes = new Set(["Infantry", "Artillery", "Tank", "AAA"]);
  const toggleCargo = (transport: string, id: string) =>
    setCargo((x) => {
      const current = x[transport] || [];
      return {
        ...x,
        [transport]: current.includes(id)
          ? current.filter((v) => v !== id)
          : completeCargoManifest(units, transport, current).length < 2
            ? [...current, id]
            : current,
      };
    });
  const orders = transportMoves
    .filter((m) => (cargo[m.unitId] || []).length || unloads[m.unitId])
    .map((m) => ({
      transportId: m.unitId,
      landUnits: completeCargoManifest(units, m.unitId, cargo[m.unitId]),
      ...(unloads[m.unitId] ? { unload: unloads[m.unitId] } : {}),
    }));
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>MOVEMENT PLAN</Text>
      <Text style={s.cardTitle}>Plot routes on the map</Text>
      <Text style={s.subtitle}>
        Select your unit chips in a space, then click adjacent spaces in order.
        The server checks movement, domains, hostility, canals, and landing
        capacity.
      </Text>
      {selected.length > 0 && (
        <View style={s.draft}>
          <Text style={s.draftText}>
            {selected.length} selected /{" "}
            {route.length > 1
              ? route.map((id) => spaceName(catalog, id)).join(" → ")
              : "choose an adjacent destination"}
          </Text>
          <View style={s.inline}>
            <SmallButton label="Clear" onPress={clear} />
            <SmallButton
              label="Add route"
              onPress={addRoute}
              disabled={route.length < 2}
            />
          </View>
        </View>
      )}
      {moves.map((m) => (
        <Pressable
          key={m.unitId}
          onPress={() => remove(m.unitId)}
          style={s.orderRow}
        >
          <Text style={s.orderText}>
            {units[m.unitId]?.type} {m.unitId}
          </Text>
          <Text style={s.orderPath}>
            {m.path.map((id) => spaceName(catalog, id)).join(" → ")} ×
          </Text>
        </Pressable>
      ))}
      {transportMoves.map((move) => {
        const available = Object.values(units).filter(
          (u) =>
            (u.owner === power || u.transportId === move.unitId) &&
            landTypes.has(u.type) &&
            (u.transportId === move.unitId ||
              (!u.transportId && adjacent(u.space, move.path[0]))),
        );
        const destinations =
          catalog?.spaces.filter(
            (space) =>
              space.kind === "land" &&
              adjacent(space.id, move.path.at(-1) || ""),
          ) || [];
        return (
          <View key={`cargo-${move.unitId}`} style={s.pending}>
            <Text style={s.pendingTitle}>CARGO / {move.unitId}</Text>
            <Text style={s.hint}>
              Select one or two land units. Two-unit loads require infantry.
            </Text>
            <ChipList
              ids={available.map((u) => u.id)}
              units={units}
              selected={completeCargoManifest(
                units,
                move.unitId,
                cargo[move.unitId],
              )}
              toggle={(id) => toggleCargo(move.unitId, id)}
              disabledIds={available
                .filter((u) => u.transportId === move.unitId)
                .map((u) => u.id)}
            />
            {completeCargoManifest(units, move.unitId, cargo[move.unitId])
              .length > 0 && (
              <>
                <Text style={s.sectionLabel}>
                  UNLOAD DESTINATION / OPTIONAL
                </Text>
                <View style={s.chips}>
                  <Pressable
                    onPress={() =>
                      setUnloads((x) => ({ ...x, [move.unitId]: "" }))
                    }
                    style={[
                      s.choiceChip,
                      !unloads[move.unitId] && s.choiceChipActive,
                    ]}
                  >
                    <Text style={s.choiceText}>Keep aboard</Text>
                  </Pressable>
                  {destinations.map((space) => (
                    <Pressable
                      key={space.id}
                      onPress={() =>
                        setUnloads((x) => ({ ...x, [move.unitId]: space.id }))
                      }
                      style={[
                        s.choiceChip,
                        unloads[move.unitId] === space.id && s.choiceChipActive,
                      ]}
                    >
                      <Text style={s.choiceText}>{space.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        );
      })}
      <Button
        label={`Submit movement plan (${moves.length + (route.length > 1 ? selected.length : 0)} units)`}
        onPress={() => submit(orders)}
        disabled={disabled || (!moves.length && route.length < 2)}
      />
    </View>
  );
}

function PurchasePanel({
  game,
  disabled,
  command,
}: {
  game: Game;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const [units, setUnits] = useState<Record<string, number>>({}),
    [repairs, setRepairs] = useState<Record<string, number>>({});
  const factories = Object.values(game.worldUnits).filter(
    (u) =>
      u.owner === game.currentPower &&
      u.type === "Industrial Complex" &&
      (u.damage || 0) > 0,
  );
  const total =
    Object.entries(units).reduce(
      (n, [type, count]) => n + (game.units[type]?.Cost || 0) * count,
      0,
    ) + Object.values(repairs).reduce((a, b) => a + b, 0);
  const adjust = (type: string, delta: number) =>
    setUnits((x) => ({ ...x, [type]: Math.max(0, (x[type] || 0) + delta) }));
  const submit = async () => {
    const clean = Object.fromEntries(
      Object.entries(units).filter(([, n]) => n),
    );
    if (await command("purchase", { units: clean, repairs })) {
      setUnits({});
      setRepairs({});
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>PURCHASE & REPAIR</Text>
      <View style={s.cardHeading}>
        <Text style={s.cardTitle}>Build order</Text>
        <Text style={s.total}>
          {total} / {game.state.ipcs[game.currentPower]} IPC
        </Text>
      </View>
      <View style={s.unitGrid}>
        {Object.entries(game.units).map(([name, spec]) => (
          <View key={name} style={s.unit}>
            <View style={s.unitTop}>
              <Text style={s.unitName}>{name}</Text>
              <Text style={s.unitCost}>{spec.Cost}</Text>
            </View>
            <Text style={s.unitStats}>
              A{spec.Attack} D{spec.Defense} M{spec.Move}
            </Text>
            <View style={s.stepper}>
              <SmallButton
                label="−"
                onPress={() => adjust(name, -1)}
                disabled={!units[name]}
              />
              <Text style={s.stepCount}>{units[name] || 0}</Text>
              <SmallButton label="+" onPress={() => adjust(name, 1)} />
            </View>
          </View>
        ))}
      </View>
      {factories.length > 0 && (
        <>
          <Text style={s.sectionLabel}>FACTORY REPAIRS / 1 IPC EACH</Text>
          {factories.map((f) => (
            <View key={f.id} style={s.repairRow}>
              <Text style={s.orderText}>
                {f.id} / {f.damage} damage / {f.space}
              </Text>
              <View style={s.stepper}>
                <SmallButton
                  label="−"
                  onPress={() =>
                    setRepairs((x) => ({
                      ...x,
                      [f.id]: Math.max(0, (x[f.id] || 0) - 1),
                    }))
                  }
                />
                <Text style={s.stepCount}>{repairs[f.id] || 0}</Text>
                <SmallButton
                  label="+"
                  disabled={(repairs[f.id] || 0) >= (f.damage || 0)}
                  onPress={() =>
                    setRepairs((x) => ({ ...x, [f.id]: (x[f.id] || 0) + 1 }))
                  }
                />
              </View>
            </View>
          ))}
        </>
      )}
      <Button
        label="Submit purchase plan"
        onPress={submit}
        disabled={
          disabled || total < 1 || total > game.state.ipcs[game.currentPower]
        }
      />
    </View>
  );
}

function CombatPanel({
  game,
  catalog,
  disabled,
  command,
}: {
  game: Game;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const [choices, setChoices] = useState<Record<string, string[]>>({}),
    [bombarders, setBombarders] = useState<Record<string, string[]>>({});
  useEffect(() => setChoices({}), [game.version]);
  const toggle = (territory: string, id: string) =>
    setChoices((x) => {
      const list = x[territory] || [];
      return {
        ...x,
        [territory]: list.includes(id)
          ? list.filter((v) => v !== id)
          : [...list, id],
      };
    });
  const casualty = (territory: string, id: string, hits: number) =>
    setChoices((x) => {
      const list = x[territory] || [],
        unit = game.worldUnits[id];
      if (
        list.length >= hits ||
        (list.includes(id) && (unit?.type !== "Battleship" || !!unit.damage))
      )
        return x;
      return { ...x, [territory]: [...list, id] };
    });
  const active = Object.values(game.battles);
  const bombingTargets = [
    ...new Set(
      Object.values(game.worldUnits)
        .filter(
          (u) =>
            u.type === "Industrial Complex" &&
            !allied(u.owner, game.currentPower),
        )
        .map((u) => u.space),
    ),
  ];
  return (
    <View style={s.stack}>
      <View style={s.card}>
        <Text style={s.eyebrow}>BATTLE BOARD</Text>
        <Text style={s.cardTitle}>
          {active.length
            ? `${active.length} contested space(s)`
            : "No battles declared"}
        </Text>
        {active.map((b) => (
          <BattleCard
            key={b.territory}
            battle={b}
            game={game}
            catalog={catalog}
            choices={choices[b.territory] || []}
            bombarders={bombarders[b.territory] || []}
            setBombarders={(ids) =>
              setBombarders((x) => ({ ...x, [b.territory]: ids }))
            }
            toggle={(id) => toggle(b.territory, id)}
            casualty={(id) =>
              casualty(b.territory, id, casualtyHits(b, game.worldUnits))
            }
            disabled={disabled}
            command={command}
          />
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.eyebrow}>STRATEGIC BOMBING</Text>
        <Text style={s.subtitle}>
          Bombers already moved into an enemy factory territory may raid instead
          of joining battle.
        </Text>
        {bombingTargets.map((target) => {
          const bombers = Object.values(game.worldUnits).filter(
            (u) =>
              u.owner === game.currentPower &&
              u.type === "Bomber" &&
              u.space === target,
          );
          return (
            <View key={target} style={s.raidRow}>
              <View>
                <Text style={s.orderText}>{spaceName(catalog, target)}</Text>
                <Text style={s.hint}>{bombers.length} bomber(s) in target</Text>
              </View>
              <SmallButton
                label="Bomb"
                disabled={disabled || !bombers.length}
                onPress={() =>
                  void command("strategic_bomb", {
                    target,
                    bomberIds: bombers.map((u) => u.id),
                  })
                }
              />
            </View>
          );
        })}
        {!bombingTargets.length && (
          <Text style={s.hint}>No enemy industrial complexes remain.</Text>
        )}
      </View>
    </View>
  );
}

function BattleCard({
  battle,
  game,
  catalog,
  choices,
  bombarders,
  setBombarders,
  toggle,
  casualty,
  disabled,
  command,
}: {
  battle: Battle;
  game: Game;
  catalog: BoardCatalog | null;
  choices: string[];
  bombarders: string[];
  setBombarders: (v: string[]) => void;
  toggle: (id: string) => void;
  casualty: (id: string) => void;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const pending = battle.pendingDecision,
    canDecide = !pending?.power || game.me.powers.includes(pending.power),
    eligible = pending?.eligible || [],
    requiredHits = casualtyHits(battle, game.worldUnits);
  const adjacent =
    catalog?.connections.flatMap((e) =>
      e.a === battle.territory ? [e.b] : e.b === battle.territory ? [e.a] : [],
    ) || [];
  const bombardment = bombardmentOptions(battle, game.worldUnits);
  const starts = game.state.world?.turnStart?.units || {};
  const retreatSpaces = adjacent.filter(
    (id) =>
      eligible.some(
        (unitID) =>
          starts[unitID]?.space === id &&
          !["Fighter", "Bomber"].includes(starts[unitID]?.type),
      ) &&
      !Object.values(game.worldUnits).some(
        (u) => u.space === id && !allied(u.owner, battle.attacker),
      ),
  );
  return (
    <View style={s.battle}>
      <View style={s.cardHeading}>
        <View>
          <Text style={s.battleName}>
            {spaceName(catalog, battle.territory)}
          </Text>
          <Text style={s.hint}>
            Round {battle.round} /{" "}
            {battle.complete
              ? `complete · ${battle.winner || "no victor"}`
              : battle.stage}
          </Text>
        </View>
        {!battle.complete && !pending && battle.started && (
          <SmallButton
            label="Advance battle"
            disabled={disabled || !game.me.powers.includes(game.currentPower)}
            onPress={() =>
              void command("battle_step", { territory: battle.territory })
            }
          />
        )}
      </View>
      {battle.stage === "aaa" &&
        battle.round === 0 &&
        !battle.complete &&
        !battle.started && (
        <>
          <Text style={s.sectionLabel}>OPTIONAL NAVAL BOMBARDMENT</Text>
          <ChipList
            ids={bombardment.ids}
            units={game.worldUnits}
            selected={bombarders}
            toggle={(id) =>
              setBombarders(
                toggleBombarder(
                  bombarders,
                  id,
                  bombardment.ids,
                  bombardment.limit,
                ),
              )
            }
          />
          <SmallButton
            label="Start battle with selection"
            disabled={disabled || !game.me.powers.includes(game.currentPower)}
            onPress={() =>
              void command("start_battle", {
                territory: battle.territory,
                bombarders,
              })
            }
          />
        </>
      )}
      {pending && (
        <View style={s.pending}>
          <Text style={s.pendingTitle}>
            {decisionDescription(
              pending.kind,
              pending.power,
              pending.hits,
              pending.minHits,
            )}
          </Text>
          {pending.kind === "choose-casualties" && !pending.group && (
            <>
              <ChipList
                ids={eligible}
                units={game.worldUnits}
                selected={choices}
                toggle={casualty}
                counts
              />
              <Text style={s.hint}>
                {choices.length} / {requiredHits} hits assigned
              </Text>
              <SmallButton
                label="Confirm casualties"
                disabled={
                  disabled || !canDecide || choices.length !== requiredHits
                }
                onPress={() =>
                  void command("choose_casualties", {
                    territory: battle.territory,
                    unitIds: choices,
                  })
                }
              />
            </>
          )}
          {pending.kind === "choose-submerge" && (
            <>
              <ChipList
                ids={eligible}
                units={game.worldUnits}
                selected={choices}
                toggle={toggle}
              />
              <SmallButton
                label={
                  choices.length
                    ? `Submerge selected (${choices.length})`
                    : "Continue without submerging"
                }
                disabled={disabled || !canDecide}
                onPress={() =>
                  void command(
                    "submerge",
                    submergePayload(battle.territory, choices),
                  )
                }
              />
            </>
          )}
          {pending.kind === "choose-retreat" && (
            <View style={s.inline}>
              <SmallButton
                label="Continue fighting"
                disabled={disabled || !canDecide}
                onPress={() =>
                  void command("continue_battle", {
                    territory: battle.territory,
                  })
                }
              />
              {retreatSpaces.map((id) => (
                <SmallButton
                  key={id}
                  label={`Retreat: ${spaceName(catalog, id)}`}
                  disabled={disabled || !canDecide}
                  onPress={() =>
                    void command("retreat", {
                      territory: battle.territory,
                      destination: id,
                    })
                  }
                />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function PlacementPanel({
  game,
  type,
  target,
  setType,
  setTarget,
  catalog,
  disabled,
  command,
}: {
  game: Game;
  type: string;
  target: string;
  setType: (v: string) => void;
  setTarget: (v: string) => void;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const [placements, setPlacements] = useState<
    { Type: string; Space: string; Count: number }[]
  >([]);
  const counts = (game.purchased || []).reduce<Record<string, number>>(
    (a, t) => ({ ...a, [t]: (a[t] || 0) + 1 }),
    {},
  );
  const planned = placements.reduce<Record<string, number>>(
    (a, p) => ({ ...a, [p.Type]: (a[p.Type] || 0) + p.Count }),
    {},
  );
  const add = () => {
    if (!type || !target) return;
    setPlacements((x) => {
      const found = x.find((p) => p.Type === type && p.Space === target);
      return found
        ? x.map((p) => (p === found ? { ...p, Count: p.Count + 1 } : p))
        : [...x, { Type: type, Space: target, Count: 1 }];
    });
    setTarget("");
  };
  const submit = async () => {
    if (await command("placements", { placements })) setPlacements([]);
  };
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>MOBILIZATION</Text>
      <Text style={s.cardTitle}>Place purchased units</Text>
      <Text style={s.subtitle}>
        Choose a unit, click its destination on the map, then add it. The server
        validates factory eligibility and capacity.
      </Text>
      <View style={s.chips}>
        {Object.entries(counts).map(([name, count]) => (
          <Pressable
            key={name}
            disabled={(planned[name] || 0) >= count}
            onPress={() => setType(name)}
            style={[s.choiceChip, type === name && s.choiceChipActive]}
          >
            <Text style={s.choiceText}>
              {name} {count - (planned[name] || 0)}
            </Text>
          </Pressable>
        ))}
      </View>
      {type && (
        <View style={s.draft}>
          <Text style={s.draftText}>
            {type} /{" "}
            {target ? spaceName(catalog, target) : "click destination on map"}
          </Text>
          <SmallButton label="Add placement" onPress={add} disabled={!target} />
        </View>
      )}
      {placements.map((p, i) => (
        <Pressable
          key={`${p.Type}-${p.Space}`}
          onPress={() => setPlacements((x) => x.filter((_, j) => j !== i))}
          style={s.orderRow}
        >
          <Text style={s.orderText}>
            {p.Count} × {p.Type}
          </Text>
          <Text style={s.orderPath}>{spaceName(catalog, p.Space)} ×</Text>
        </Pressable>
      ))}
      <Button
        label="Submit placements"
        disabled={disabled || !placements.length}
        onPress={submit}
      />
    </View>
  );
}

function Lobby({
  game,
  busy,
  command,
}: {
  game: Game;
  busy: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const narrow = useWindowDimensions().width < 900;
  return (
    <>
      <View style={s.boardSection}>
        <Board owners={game.owners} units={game.worldUnits} />
      </View>
      <View style={[s.grid, narrow && s.column]}>
        <View style={s.mainColumn}>
          <View style={s.card}>
            <Text style={s.eyebrow}>COMMAND ROSTER</Text>
            <Text style={s.cardTitle}>
              {game.players.length} of 5 commanders assembled
            </Text>
            {game.players.map((p, i) => (
              <View key={p.id} style={s.playerRow}>
                <Text style={s.playerNumber}>0{i + 1}</Text>
                <Text style={s.playerName}>{p.name}</Text>
                <Text style={s.playerRole}>{p.isOwner ? "HOST" : "READY"}</Text>
              </View>
            ))}
          </View>
          {game.me.isOwner ? (
            <Button
              label={busy ? "Starting..." : "Assign powers & start"}
              onPress={() => void command("start_game")}
              disabled={busy || game.players.length < 2}
            />
          ) : (
            <Text style={s.notice}>
              The host will start when everyone arrives.
            </Text>
          )}
        </View>
        <View style={[s.sideColumn, narrow && s.sideWide]}>
          <View style={s.card}>
            <Text style={s.eyebrow}>INVITE YOUR FRIENDS</Text>
            <Text style={s.inviteCode}>{game.joinCode}</Text>
            <Text style={s.subtitle}>
              Share this private code. Supports 2-5 commanders.
            </Text>
          </View>
          <Activity events={game.events} />
        </View>
      </View>
    </>
  );
}

function ChipList({
  ids,
  units,
  selected,
  toggle,
  counts = false,
  disabledIds = [],
}: {
  ids: string[];
  units: Record<string, WorldUnit>;
  selected: string[];
  toggle: (id: string) => void;
  counts?: boolean;
  disabledIds?: string[];
}) {
  return (
    <View style={s.chips}>
      {ids.map((id, index) => {
        const count = selected.filter((x) => x === id).length;
        return (
          <Pressable
            key={`${id}-${index}`}
            onPress={() => toggle(id)}
            disabled={disabledIds.includes(id)}
            style={[s.choiceChip, count > 0 && s.choiceChipActive]}
          >
            <Text style={s.choiceText}>
              {units[id]?.type || id} · {id}
              {counts && count > 1 ? ` ×${count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function FighterLandingDecision({
  territory,
  game,
  catalog,
  disabled,
  command,
}: {
  territory: string;
  game: Game;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const pending = game.pendingDecisions[territory];
  const fighters = (pending?.eligible || []).filter((id) =>
    game.me.powers.includes(game.worldUnits[id]?.owner),
  );
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>
        EMERGENCY FIGHTER LANDING / {spaceName(catalog, territory)}
      </Text>
      <Text style={s.subtitle}>
        Choose an excess defending fighter and its legal one-space landing. A
        fighter with no legal destination must be destroyed.
      </Text>
      {fighters.map((id) => {
        const destinations = pending?.destinations?.[id] || [];
        return (
          <View key={id} style={s.orderRow}>
            <Text style={s.orderText}>
              {game.worldUnits[id]?.owner} Fighter · {id}
            </Text>
            <View style={s.inline}>
              {destinations.map((destination) => (
                <SmallButton
                  key={destination}
                  label={spaceName(catalog, destination)}
                  disabled={disabled}
                  onPress={() =>
                    void command("land_fighter", {
                      territory,
                      unitId: id,
                      destination,
                    })
                  }
                />
              ))}
              {destinations.length === 0 && (
                <SmallButton
                  label="Destroy fighter"
                  disabled={disabled}
                  onPress={() =>
                    void command("land_fighter", {
                      territory,
                      unitId: id,
                      destination: "",
                    })
                  }
                />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
function RetreatDecision({
  territory,
  game,
  catalog,
  disabled,
  command,
}: {
  territory: string;
  game: Game;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const pending = game.pendingDecisions[territory],
    canDecide = !!pending && game.me.powers.includes(pending.power || "");
  if (!canDecide) return null;
  const options = pending.options || [],
    airOnly = (pending.eligible || []).every((id) =>
      ["Fighter", "Bomber"].includes(game.worldUnits[id]?.type),
    );
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>RETREAT / {spaceName(catalog, territory)}</Text>
      <Text style={s.subtitle}>
        Surface and land units retreat together. Aircraft remain in the battle
        space and complete landing during noncombat movement.
      </Text>
      <View style={s.inline}>
        {options.map((destination) => (
          <SmallButton
            key={destination}
            label={`Retreat to ${spaceName(catalog, destination)}`}
            disabled={disabled}
            onPress={() => void command("retreat", { territory, destination })}
          />
        ))}
        {airOnly && (
          <SmallButton
            label="Retreat aircraft"
            disabled={disabled}
            onPress={() =>
              void command("retreat", { territory, destination: "" })
            }
          />
        )}
        <SmallButton
          label="Continue battle"
          disabled={disabled}
          onPress={() => void command("continue_battle", { territory })}
        />
      </View>
    </View>
  );
}

function OwnerCasualtyDecision({
  territory,
  game,
  catalog,
  disabled,
  command,
}: {
  territory: string;
  game: Game;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const pending = game.pendingDecisions[territory],
    [selected, setSelected] = useState<string[]>([]);
  if (!pending || !game.me.powers.includes(pending.power || "")) return null;
  const maxHits = pending.hits || 0,
    minHits = pending.minHits || 0;
  const add = (id: string) => {
    const unit = game.worldUnits[id],
      count = selected.filter((x) => x === id).length;
    if (
      selected.length < maxHits &&
      count < (unit?.type === "Battleship" && !unit.damage ? 2 : 1)
    )
      setSelected((current) => [...current, id]);
  };
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>
        MULTINATIONAL CASUALTIES / {spaceName(catalog, territory)}
      </Text>
      <Text style={s.subtitle}>
        {pending.power} must assign between {minHits} and {maxHits} hit(s).
        Other defending powers decide afterward in turn order.
      </Text>
      <ChipList
        ids={pending.eligible || []}
        units={game.worldUnits}
        selected={selected}
        toggle={add}
        counts
      />
      <View style={s.inline}>
        <SmallButton
          label="Clear"
          disabled={disabled || selected.length === 0}
          onPress={() => setSelected([])}
        />
        <SmallButton
          label="Submit casualties"
          disabled={
            disabled || selected.length < minHits || selected.length > maxHits
          }
          onPress={() =>
            void command("choose_casualties", { territory, unitIds: selected })
          }
        />
      </View>
    </View>
  );
}

function StationaryTransportPanel({
  game,
  catalog,
  disabled,
  command,
}: {
  game: Game;
  catalog: BoardCatalog | null;
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
}) {
  const [transportID, setTransportID] = useState(""),
    [cargo, setCargo] = useState<string[]>([]),
    [unload, setUnload] = useState("");
  const transports = stationaryTransportOptions(
    game.worldUnits,
    game.currentPower,
  );
  const transport = game.worldUnits[transportID];
  const adjacent = (id: string) =>
    catalog?.connections.flatMap((e) =>
      e.a === id ? [e.b] : e.b === id ? [e.a] : [],
    ) || [];
  const neighbors = transport ? adjacent(transport.space) : [];
  const existing = Object.values(game.worldUnits).filter(
    (u) => u.transportId === transportID,
  );
  const loadable = Object.values(game.worldUnits).filter(
    (u) =>
      (u.owner === game.currentPower || u.transportId === transportID) &&
      ["Infantry", "Artillery", "Tank", "AAA"].includes(u.type) &&
      (!u.transportId || u.transportId === transportID) &&
      (u.transportId === transportID || neighbors.includes(u.space)),
  );
  const selected = completeCargoManifest(game.worldUnits, transportID, cargo);
  const toggle = (id: string) =>
    setCargo((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : selected.length < 2
          ? [...current, id]
          : current,
    );
  const submit = async () => {
    if (
      await command("movement_plan", {
        moves: [],
        transports: [
          {
            transportId: transportID,
            landUnits: selected,
            ...(unload ? { unload } : {}),
          },
        ],
      })
    ) {
      setTransportID("");
      setCargo([]);
      setUnload("");
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>STATIONARY TRANSPORT</Text>
      <Text style={s.subtitle}>
        Load, unload, or bridge cargo without plotting a sea route.
      </Text>
      <View style={s.chips}>
        {transports.map((u) => (
          <Pressable
            key={u.id}
            onPress={() => {
              setTransportID(u.id);
              setCargo([]);
              setUnload("");
            }}
            style={[s.choiceChip, transportID === u.id && s.choiceChipActive]}
          >
            <Text style={s.choiceText}>
              {u.id} / {spaceName(catalog, u.space)}
            </Text>
          </Pressable>
        ))}
      </View>
      {transport && (
        <>
          <Text style={s.sectionLabel}>CARGO</Text>
          <ChipList
            ids={loadable.map((u) => u.id)}
            units={game.worldUnits}
            selected={selected}
            toggle={toggle}
            disabledIds={existing.map((u) => u.id)}
          />
          <Text style={s.sectionLabel}>OPTIONAL UNLOAD</Text>
          <View style={s.chips}>
            {neighbors
              .filter(
                (id) =>
                  catalog?.spaces.find((space) => space.id === id)?.kind ===
                  "land",
              )
              .map((id) => (
                <Pressable
                  key={id}
                  onPress={() => setUnload(unload === id ? "" : id)}
                  style={[s.choiceChip, unload === id && s.choiceChipActive]}
                >
                  <Text style={s.choiceText}>{spaceName(catalog, id)}</Text>
                </Pressable>
              ))}
          </View>
          <SmallButton
            label="Submit stationary transport order"
            disabled={disabled || selected.length === 0}
            onPress={() => void submit()}
          />
        </>
      )}
    </View>
  );
}

function IgnoreSeaUnitsPanel({
  game,
  catalog,
  moves,
  disabled,
  command,
  clear,
}: {
  game: Game;
  catalog: BoardCatalog | null;
  moves: MoveOrder[];
  disabled: boolean;
  command: (t: string, p?: object) => Promise<boolean>;
  clear: () => void;
}) {
  const [ignored, setIgnored] = useState<string[]>([]);
  const candidates = [
    ...new Set(
      moves
        .map((move) => move.path.at(-1) || "")
        .filter((space) => {
          const enemies = Object.values(game.worldUnits).filter(
            (u) => u.space === space && !allied(u.owner, game.currentPower),
          );
          return (
            enemies.length > 0 &&
            enemies.every(
              (u) => u.type === "Submarine" || u.type === "Transport",
            )
          );
        }),
    ),
  ];
  if (candidates.length === 0) return null;
  const submit = async () => {
    if (
      await command("movement_plan", {
        moves,
        transports: [],
        ignoreSeaZones: ignored,
      })
    )
      clear();
  };
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>IGNORE STEALTH UNITS</Text>
      <Text style={s.subtitle}>
        By default, enemy-only transports are destroyed and enemy submarines are
        attacked. Select a zone to pass through or coexist without combat.
      </Text>
      <View style={s.chips}>
        {candidates.map((id) => (
          <Pressable
            key={id}
            onPress={() =>
              setIgnored((current) =>
                current.includes(id)
                  ? current.filter((x) => x !== id)
                  : [...current, id],
              )
            }
            style={[s.choiceChip, ignored.includes(id) && s.choiceChipActive]}
          >
            <Text style={s.choiceText}>{spaceName(catalog, id)}</Text>
          </Pressable>
        ))}
      </View>
      <SmallButton
        label="Submit drafted moves with ignore choices"
        disabled={disabled}
        onPress={() => void submit()}
      />
    </View>
  );
}

function PowerLedger({ game }: { game: Game }) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>WORLD ECONOMY</Text>
      {Object.entries(game.state.ipcs).map(([power, ipc]) => (
        <View key={power} style={s.ledgerRow}>
          <View>
            <Text style={s.ledgerPower}>{power}</Text>
            <Text style={s.ledgerOwner}>
              {game.players.find((p) => p.powers.includes(power))?.name ||
                "Unassigned"}{" "}
              / income {game.state.income[power]}
            </Text>
          </View>
          <Text style={s.ledgerIPC}>{ipc}</Text>
        </View>
      ))}
    </View>
  );
}
function Activity({ events }: { events: GameEvent[] }) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>FIELD LOG</Text>
      {events.slice(0, 10).map((e) => (
        <View key={e.sequence} style={s.event}>
          <View style={s.eventDot} />
          <View style={s.flex}>
            <Text style={s.eventText}>{e.message}</Text>
            <Text style={s.eventTime}>{new Date(e.at).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
function InfoCard({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>PHASE CONTROL</Text>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.subtitle}>{copy}</Text>
    </View>
  );
}
function decisionDescription(
  kind: string,
  power?: string,
  hits?: number,
  minHits?: number,
) {
  if (kind === "choose-casualties") {
    if (minHits !== undefined && minHits !== hits)
      return `${power || "A defender"} must assign between ${minHits} and ${hits || 0} hit(s)`;
    return `${power || "A defender"} must assign ${hits || 0} hit(s)`;
  }
  if (kind === "choose-submerge")
    return "Choose submarines to submerge, or submit none";
  if (kind === "choose-fighter-landing")
    return "Excess defending fighters must land one space away or be destroyed";
  return `${power || "The attacker"} must retreat or continue fighting`;
}
function casualtyHits(battle: Battle, units: Record<string, WorldUnit>) {
  const pending = battle.pendingDecision;
  if (!pending) return 0;
  const capacity = (pending.eligible || []).reduce(
    (n, id) =>
      n + (units[id]?.type === "Battleship" && !units[id]?.damage ? 2 : 1),
    0,
  );
  return Math.min(pending.hits || 0, capacity);
}
function spaceName(catalog: BoardCatalog | null, id: string) {
  return catalog?.spaces.find((s) => s.id === id)?.name || id;
}
function Brand() {
  return (
    <View style={s.brandRow}>
      <View style={s.brandMark}>
        <Text style={s.brandLetter}>F</Text>
      </View>
      <Text style={s.brand}>FRONTLINE COMMAND</Text>
    </View>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return <View style={s.shell}>{children}</View>;
}
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#7d847e"
        style={s.input}
      />
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={s.buttonText}>{label}</Text>
      <Text style={s.buttonArrow}>→</Text>
    </Pressable>
  );
}
function SmallButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.smallButton, disabled && s.disabled]}
    >
      <Text style={s.smallButtonText}>{label}</Text>
    </Pressable>
  );
}
function Tab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.tab, active && s.tabActive]}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}
function StatusPill({ status }: { status: string }) {
  return (
    <View style={s.status}>
      <View style={s.statusDot} />
      <Text style={s.statusText}>{status.toUpperCase()}</Text>
    </View>
  );
}
function ErrorBanner({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={s.errorBanner}>
      <Text style={s.errorTitle}>ORDER REJECTED</Text>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101714" },
  app: { flex: 1, backgroundColor: "#ece9df" },
  flex: { flex: 1 },
  column: { flexDirection: "column" },
  landing: { minHeight: "100%", flexDirection: "row" },
  hero: {
    flex: 1,
    padding: 70,
    justifyContent: "space-between",
    backgroundColor: "#17211d",
  },
  heroNarrow: { padding: 28, minHeight: 530 },
  access: {
    width: "42%",
    maxWidth: 620,
    padding: 68,
    justifyContent: "center",
    backgroundColor: "#ece9df",
  },
  accessNarrow: {
    width: "100%",
    maxWidth: "100%",
    padding: 28,
    minHeight: 540,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandMark: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: "#d8a94d",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
  },
  brandLetter: {
    color: "#d8a94d",
    fontFamily: "serif",
    fontSize: 16,
    transform: [{ rotate: "-45deg" }],
  },
  brand: {
    fontSize: 11,
    letterSpacing: 2.3,
    fontWeight: "700",
    color: "#d9ddd8",
  },
  kicker: {
    color: "#d8a94d",
    fontSize: 10,
    letterSpacing: 2.5,
    fontWeight: "700",
    marginTop: 65,
  },
  heroTitle: {
    fontFamily: "serif",
    fontSize: 62,
    lineHeight: 68,
    color: "#f1eee5",
    marginTop: 20,
  },
  heroTitleNarrow: { fontSize: 43, lineHeight: 49 },
  gold: { fontStyle: "italic", color: "#d8a94d" },
  heroCopy: {
    fontSize: 17,
    lineHeight: 28,
    color: "#aeb7b0",
    maxWidth: 570,
    marginTop: 25,
  },
  heroFoot: { fontSize: 9, letterSpacing: 2, color: "#7e8d84", marginTop: 60 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2.1,
    fontWeight: "700",
    color: "#9b792f",
    marginBottom: 9,
  },
  panelTitle: {
    fontFamily: "serif",
    fontSize: 36,
    color: "#16201c",
    marginBottom: 26,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbc7bc",
    marginBottom: 26,
  },
  tab: { paddingVertical: 12, marginRight: 28 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#9b792f" },
  tabText: { fontSize: 12, color: "#72766f", fontWeight: "600" },
  tabTextActive: { color: "#16201c" },
  field: { marginBottom: 20 },
  label: {
    fontSize: 9,
    letterSpacing: 1.8,
    fontWeight: "700",
    color: "#5a605b",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#b8b5ab",
    backgroundColor: "#f7f5ee",
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: "#17211d",
  },
  footnote: { fontSize: 11, color: "#757a73", marginTop: 18 },
  campaignSection: {
    borderTopWidth: 1,
    borderTopColor: "#cbc7bc",
    marginTop: 30,
    paddingTop: 24,
    gap: 10,
  },
  campaignCard: {
    borderWidth: 1,
    borderColor: "#c9c5ba",
    backgroundColor: "#f7f5ee",
  },
  campaignOpen: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  campaignName: {
    fontFamily: "serif",
    fontSize: 19,
    color: "#18201d",
    marginBottom: 4,
  },
  campaignMeta: {
    fontSize: 9,
    letterSpacing: 1.1,
    color: "#687069",
  },
  campaignArrow: { color: "#9b792f", fontSize: 20 },
  campaignDelete: {
    color: "#8f3d32",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  deleteConfirm: {
    borderTopWidth: 1,
    borderTopColor: "#d8c5bd",
    backgroundColor: "#f4e9e4",
    padding: 14,
  },
  deleteWarning: {
    color: "#6e3028",
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 10,
  },
  confirmActions: { flexDirection: "row", gap: 8 },
  unavailableCampaign: {
    borderWidth: 1,
    borderColor: "#cbc7bc",
    padding: 14,
    gap: 10,
  },
  topbar: {
    minHeight: 58,
    paddingHorizontal: 28,
    backgroundColor: "#101714",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quietLink: { color: "#b9c1bb", fontSize: 11, letterSpacing: 1.1 },
  dashboard: {
    width: "100%",
    maxWidth: 1440,
    alignSelf: "center",
    padding: 24,
    gap: 18,
  },
  gameHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
  },
  title: { fontFamily: "serif", fontSize: 39, color: "#18201d" },
  subtitle: { fontSize: 12, lineHeight: 19, color: "#667069" },
  code: { fontWeight: "800", letterSpacing: 2, color: "#29352f" },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "#aeb5ad",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#638154",
  },
  statusText: {
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: "800",
    color: "#3e4943",
  },
  turnCard: {
    backgroundColor: "#17211d",
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderLeftWidth: 4,
    borderLeftColor: "#d8a94d",
  },
  turnPower: { fontFamily: "serif", fontSize: 31, color: "#f1eee5" },
  ipcBadge: { alignItems: "center", minWidth: 80 },
  ipcValue: { fontFamily: "serif", fontSize: 34, color: "#d8a94d" },
  ipcLabel: { fontSize: 8, letterSpacing: 1.7, color: "#9eaaa2" },
  phaseGuide: {
    backgroundColor: "#f5f0df",
    borderLeftWidth: 4,
    borderLeftColor: "#aa8132",
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  phaseGuideTitle: {
    color: "#9b792f",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  phaseGuideText: { color: "#424b46", fontSize: 12, lineHeight: 18 },
  boardSection: { width: "100%" },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  mainColumn: { flex: 1, gap: 16 },
  sideColumn: { width: 350, gap: 16 },
  sideWide: { width: "100%" },
  stack: { gap: 16 },
  card: {
    backgroundColor: "#f8f6ef",
    borderWidth: 1,
    borderColor: "#d2cfc5",
    padding: 20,
  },
  cardTitle: {
    fontFamily: "serif",
    fontSize: 25,
    color: "#18201d",
    marginBottom: 7,
  },
  cardHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  total: { fontFamily: "serif", fontSize: 22, color: "#9b792f" },
  button: {
    minHeight: 49,
    backgroundColor: "#9b792f",
    paddingHorizontal: 17,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  buttonText: {
    color: "#fffaf0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  buttonArrow: { color: "#fff", fontSize: 18 },
  smallButton: {
    borderWidth: 1,
    borderColor: "#8e897d",
    backgroundColor: "#f4f1e8",
    minHeight: 34,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: { fontSize: 10, fontWeight: "800", color: "#343c37" },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  errorBanner: {
    backgroundColor: "#f4ded7",
    borderLeftWidth: 4,
    borderLeftColor: "#a94135",
    padding: 14,
  },
  errorTitle: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
    color: "#8d2e27",
    marginBottom: 4,
  },
  errorText: { fontSize: 13, color: "#672a26" },
  noticeBanner: {
    backgroundColor: "#dfe9dc",
    borderLeftWidth: 4,
    borderLeftColor: "#65805c",
    padding: 12,
  },
  noticeText: { fontSize: 12, color: "#3d5437" },
  decisionAlert: {
    backgroundColor: "#fff0c9",
    borderWidth: 1,
    borderColor: "#cf9f34",
    padding: 14,
  },
  decisionTitle: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    color: "#725416",
  },
  decisionCopy: { fontSize: 13, color: "#4e4021", marginTop: 4 },
  unitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  unit: {
    width: 150,
    borderWidth: 1,
    borderColor: "#d4d0c5",
    padding: 10,
    backgroundColor: "#eeece4",
  },
  unitTop: { flexDirection: "row", justifyContent: "space-between", gap: 5 },
  unitName: { fontSize: 10, fontWeight: "800", color: "#242d28", flex: 1 },
  unitCost: { fontFamily: "serif", fontSize: 17, color: "#9b792f" },
  unitStats: { fontSize: 9, color: "#747b75", marginTop: 5 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginTop: 7,
  },
  stepCount: {
    minWidth: 22,
    textAlign: "center",
    fontWeight: "800",
    fontSize: 12,
    color: "#27312b",
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: "800",
    color: "#77736a",
    marginTop: 18,
    marginBottom: 8,
  },
  repairRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#ddd9ce",
    paddingVertical: 8,
  },
  draft: { backgroundColor: "#e7e3d7", padding: 12, marginTop: 14, gap: 9 },
  draftText: { fontSize: 12, color: "#35413b", fontWeight: "600" },
  inline: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  orderRow: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd9ce",
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  orderText: { fontSize: 12, fontWeight: "700", color: "#2a342f" },
  orderPath: { fontSize: 10, color: "#6b746e", textAlign: "right", flex: 1 },
  hint: { fontSize: 10, lineHeight: 15, color: "#7d837e", marginTop: 7 },
  battle: { borderTopWidth: 1, borderTopColor: "#d4d0c5", paddingVertical: 15 },
  battleName: { fontFamily: "serif", fontSize: 20, color: "#1e2823" },
  pending: { marginTop: 12, padding: 12, backgroundColor: "#eee4c9" },
  pendingTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#514325",
    marginBottom: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginVertical: 9 },
  choiceChip: {
    borderWidth: 1,
    borderColor: "#aaa69b",
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: "#f7f4eb",
  },
  choiceChipActive: { borderColor: "#9b792f", backgroundColor: "#e7d6a9" },
  choiceText: { fontSize: 9, fontWeight: "700", color: "#343b37" },
  raidRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#d8d4c9",
    paddingVertical: 10,
  },
  ledgerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#dedbd1",
    paddingVertical: 11,
  },
  ledgerPower: { fontSize: 11, fontWeight: "800", color: "#26312b" },
  ledgerOwner: { fontSize: 9, color: "#7a817c", marginTop: 3 },
  ledgerIPC: { fontFamily: "serif", fontSize: 22, color: "#9b792f" },
  event: {
    flexDirection: "row",
    gap: 9,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "#dfdcd3",
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9b792f",
    marginTop: 5,
  },
  eventText: { fontSize: 11, lineHeight: 16, color: "#3e4742" },
  eventTime: { fontSize: 8, color: "#8b918c", marginTop: 3 },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#ddd9ce",
    paddingVertical: 14,
  },
  playerNumber: {
    fontFamily: "serif",
    fontSize: 16,
    color: "#9b792f",
    width: 42,
  },
  playerName: { flex: 1, fontSize: 13, fontWeight: "700", color: "#28322d" },
  playerRole: { fontSize: 8, letterSpacing: 1.3, color: "#727a74" },
  inviteCode: {
    fontFamily: "serif",
    fontSize: 42,
    letterSpacing: 6,
    color: "#9b792f",
    marginVertical: 10,
  },
  notice: {
    fontSize: 12,
    color: "#6f7771",
    padding: 15,
    backgroundColor: "#ddd9ce",
  },
  dangerLink: {
    fontSize: 10,
    color: "#8b3a32",
    textDecorationLine: "underline",
    marginVertical: 10,
  },
  shell: {
    flex: 1,
    padding: 35,
    justifyContent: "center",
    gap: 15,
    backgroundColor: "#ece9df",
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
