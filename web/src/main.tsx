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
  DiceRoll,
  BoardCatalog,
  BoardSpace,
  Game,
  GameEvent,
  MoveOrder,
  WorldUnit,
} from "./types";
import {
  NARROW,
  color,
  powerColor,
  radius,
  shadow,
  space,
  type as t,
} from "./theme";
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
  currentPower?: string;
  currentPhase?: string;
  /** A4: whether you are the one holding things up is the whole reason to open
   *  this list in an asynchronous game. */
  myTurn?: boolean;
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
    // /join/CODE has served its purpose once we are in the game.
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
        <ErrorBanner message="This browser isn't signed in to that game." />
        <Button
          label="Back to my games"
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
        <Text style={s.eyebrow}>ONE SEC</Text>
        <Text style={s.title}>Loading your game…</Text>
        {!!error && <ErrorBanner message={error} />}
        {!!error && (
          <>
            <Button
              label="Back to my games"
              onPress={() => {
                history.pushState({}, "", "/");
                setGameID("");
                setGame(null);
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forget this game"
              dataSet={{ class: "fc-press" }}
              onPress={() => forget(gameID)}
            >
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
  const narrow = useWindowDimensions().width < NARROW;
  const invited = location.pathname.startsWith("/join/")
    ? decodeURIComponent(location.pathname.split("/")[2] || "").toUpperCase()
    : "";
  const [mode, setMode] = useState<"create" | "join">(
    invited ? "join" : "create",
  ),
    [gameName, setGameName] = useState(""),
    [playerName, setPlayerName] = useState(""),
    [code, setCode] = useState(invited),
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
          .sort(
            (a, b) =>
              Number(!!b.myTurn) - Number(!!a.myTurn) ||
              b.updatedAt.localeCompare(a.updatedAt),
          ),
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
        <Text style={s.kicker}>1942 · PLAY WITH YOUR FRIENDS</Text>
        <Text style={[s.heroTitle, narrow && s.heroTitleNarrow]}>
          Take over{"\n"}
          <Text style={s.gold}>the whole world.</Text>
        </Text>
        <Text style={s.heroCopy}>
          Axis & Allies 1942, online with your friends. Play a turn whenever
          you want — the game waits for you.
        </Text>
        <Text style={s.heroFoot}>5 POWERS · 6 PHASES · 1 WORLD MAP</Text>
      </View>
      <View style={[s.access, narrow && s.accessNarrow]}>
        <Text style={s.eyebrow}>GET STARTED</Text>
        <Text style={s.panelTitle}>
          {mode === "create" ? "Start a game" : "Join a game"}
        </Text>
        <View style={s.tabs}>
          <Tab
            active={mode === "create"}
            label="New game"
            onPress={() => setMode("create")}
          />
          <Tab
            active={mode === "join"}
            label="Have a code?"
            onPress={() => setMode("join")}
          />
        </View>
        {mode === "create" ? (
          <Field
            label="GAME NAME"
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
          label="YOUR NAME"
          value={playerName}
          onChange={setPlayerName}
          placeholder="Commander name"
        />
        {!!error && <ErrorBanner message={error} />}
        <Button
          label={mode === "create" ? "Create game" : "Join game"}
          onPress={submit}
          loading={busy}
        />
        {Object.keys(sessions).length > 0 && (
          <View style={s.campaignSection}>
            <Text style={s.eyebrow}>YOUR GAMES</Text>
            {loadingCampaigns && (
              <Text style={s.footnote}>Looking up your games…</Text>
            )}
            {campaigns.map((campaign) => (
              <View key={campaign.id} style={s.campaignCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${campaign.name}`}
                  dataSet={{ class: "fc-press fc-glow" }}
                  style={s.campaignOpen}
                  onPress={() => openGame(campaign.id)}
                >
                  <View style={s.flex}>
                    <Text style={s.campaignName}>{campaign.name}</Text>
                    <Text style={s.campaignMeta}>
                      {campaign.status === "active" && campaign.currentPower
                        ? `Round ${campaign.round} · ${campaign.currentPower} · ${campaign.currentPhase}`
                        : `${campaign.status.toUpperCase()} · Round ${campaign.round}`}
                    </Text>
                  </View>
                  {campaign.myTurn && campaign.status === "active" && (
                    <View style={s.yourMoveTag}>
                      <Text style={s.yourMoveText}>YOUR MOVE</Text>
                    </View>
                  )}
                  <Text style={s.campaignArrow}>→</Text>
                </Pressable>
                {campaign.isOwner && confirming !== campaign.id && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${campaign.name}`}
                    dataSet={{ class: "fc-press" }}
                    onPress={() => {
                      setConfirming(campaign.id);
                      setConfirmationName("");
                    }}
                  >
                    <Text style={s.campaignDelete}>Delete</Text>
                  </Pressable>
                )}
                {campaign.isOwner && confirming === campaign.id && (
                  <View style={s.deleteConfirm}>
                    <Text style={s.deleteWarning}>
                      Type "{campaign.name}" to delete this game for good.
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
                        label={deleting === campaign.id ? "Deleting…" : "Delete forever"}
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forget this game"
                  dataSet={{ class: "fc-press" }}
                  onPress={() => forget(id)}
                >
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
  const narrow = useWindowDimensions().width < NARROW,
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
    [concedeArmed, setConcedeArmed] = useState(false),
    // Territory the player just tried to route into illegally, for a one-shot
    // inline nudge instead of a silent no-op.
    [blocked, setBlocked] = useState("");
  const canConcede =
    ["Soviet Union", "United Kingdom", "United States"].every((power) =>
      game.me.powers.includes(power),
    ) ||
    ["Germany", "Japan"].every((power) => game.me.powers.includes(power));
  useEffect(() => {
    if (!blocked) return;
    const timer = setTimeout(() => setBlocked(""), 2600);
    return () => clearTimeout(timer);
  }, [blocked]);
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
      const adjacent = board.connections.some(
        (e) =>
          (e.a === last && e.b === space.id) ||
          (e.b === last && e.a === space.id),
      );
      // Clicking already restricts routes to adjacent spaces, but a land unit
      // could still be walked into the ocean and only find out after a server
      // round-trip. Domain is cheap to check here; everything subtler (canals,
      // hostility, landing capacity) stays with the engine so the two cannot
      // disagree.
      const domains = new Set(
        selectedUnits.map((id) => {
          const type = game.worldUnits[id]?.type || "";
          if (["Fighter", "Bomber"].includes(type)) return "air";
          return [
            "Submarine",
            "Transport",
            "Destroyer",
            "Cruiser",
            "Aircraft Carrier",
            "Battleship",
          ].includes(type)
            ? "sea"
            : "land";
        }),
      );
      // Land cargo rides a transport through the cargo manifest, never by
      // plotting its own path across water, so land -> sea is always illegal
      // here — the server rejects it with "cannot enter water".
      const legalDomain = domains.has("air")
        ? true
        : domains.has("sea")
          ? space.kind === "sea"
          : space.kind === "land";
      if (adjacent && legalDomain) setRoute([...current, space.id]);
      else if (adjacent && !legalDomain) setBlocked(space.id);
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
  // Every player sees where the fighting is, not just the attacker.
  const liveBattles = Object.values(game.battles)
    .filter((b) => !b.complete)
    .map((b) => b.territory);
  const resolvedBattles = Object.values(game.battles)
    .filter((b) => b.complete)
    .map((b) => b.territory);
  // A decision addressed to one of my powers outranks whose turn it is: the
  // banner used to tell the player who had to act right now that it was
  // "AWAITING COMMAND" from somebody else.
  // Resolve Combat, or any pending decision, makes the panels the primary task.
  const combatFirst =
    game.currentPhase === "Resolve Combat" ||
    Object.keys(game.pendingDecisions).length > 0;
  const myDecisions = Object.entries(game.pendingDecisions).filter(
    ([, d]) => !d.power || game.me.powers.includes(d.power),
  );
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to campaigns"
          dataSet={{ class: "fc-press" }}
          onPress={leave}
        >
          <Text style={s.quietLink}>Campaigns</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.dashboard}>
        <View style={s.gameHeader}>
          <View style={s.gameHeaderText}>
            <Text style={s.eyebrow}>ROUND {game.state.round}</Text>
            <Text style={s.title}>{game.name}</Text>
            <Text style={s.subtitle}>
              Invite code <Text style={s.code}>{game.joinCode}</Text>
            </Text>
          </View>
          <StatusPill status={game.state.status} />
        </View>
        {!!error && <ErrorBanner message={error} />}
        {!!notice && (
          <View style={s.noticeBanner}>
            <Text style={s.noticeText}>{notice}</Text>
          </View>
        )}
        {game.state.status === "lobby" ? (
          <Lobby game={game} busy={busy} command={command} />
        ) : game.state.status === "finished" ? (
          <View style={s.card}>
            <Text style={s.eyebrow}>GAME OVER</Text>
            <Text style={s.cardTitle}>{game.state.winner} wins!</Text>
            <Text style={s.subtitle}>That's the game. Good fight.</Text>
          </View>
        ) : (
          <>
            <View
              style={[
                s.turnCard,
                myTurn || myDecisions.length
                  ? s.turnCardMine
                  : s.turnCardTheirs,
              ]}
            >
              <View style={s.flex}>
                <Text style={s.eyebrow}>
                  {myDecisions.length
                    ? "THEY'RE WAITING ON YOU"
                    : myTurn
                      ? "YOUR MOVE"
                      : "WAITING ON ANOTHER PLAYER"}
                </Text>
                <Text style={s.turnPower}>{game.currentPower}</Text>
                <Text style={s.subtitle}>
                  Round {game.state.round} · {game.currentPhase}
                </Text>
              </View>
              <View style={s.ipcBadge}>
                <Text style={s.ipcValue}>
                  {game.state.ipcs[game.currentPower]}
                </Text>
                <Text style={s.ipcLabel}>IPC</Text>
              </View>
            </View>
            {/* One alert, only when the decision is actually mine. Every kind
                has a dedicated panel below, so listing each pending decision
                here restated the same sentence twice on screen. */}
            {myDecisions.length > 0 && (
              <View dataSet={{ class: "fc-rise" }} style={s.decisionAlert}>
                <Text style={s.decisionTitle}>YOUR CALL</Text>
                {myDecisions.map(([territory, d]) => (
                  <Text key={territory} style={s.decisionCopy}>
                    {spaceName(catalog, territory)} —{" "}
                    {decisionDescription(d.kind, d.power, d.hits, d.minHits)}
                  </Text>
                ))}
              </View>
            )}
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
            <BattleResults game={game} catalog={catalog} />
            <PhaseGuide
              phase={game.currentPhase}
              myTurn={myTurn}
              awaitingMe={myDecisions.length > 0}
            />
            {/* During Resolve Combat, and whenever a decision is
                waiting, the panels are rendered before the map — in the
                DOM, not with CSS order, so reading order and focus order
                match what you see. Otherwise every roll, casualty pick
                and retreat meant scrolling past the whole world. */}
            {combatFirst ? (
              <>
                <View style={[s.grid, narrow && s.column]}>
                  <View style={s.mainColumn}>
                    {movement && (
                      <MovementPanel
                        blocked={blocked ? spaceName(catalog, blocked) : ""}
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
                    )}
                    {movement && (
                      <StationaryTransportPanel
                        game={game}
                        catalog={catalog}
                        disabled={!myTurn || busy}
                        command={command}
                      />
                    )}
                    {movement && game.currentPhase === "Combat Move" && (
                      <IgnoreSeaUnitsPanel
                        game={game}
                        catalog={catalog}
                        moves={moves}
                        disabled={!myTurn || busy}
                        command={command}
                        clear={() => setMoves([])}
                      />
                    )}
                    {game.currentPhase === "Purchase" && (
                      <PurchasePanel
                        game={game}
                        catalog={catalog}
                        disabled={!myTurn || busy}
                        command={command}
                      />
                    )}
                    {game.currentPhase === "Resolve Combat" && (
                      <CombatPanel
                        game={game}
                        catalog={catalog}
                        disabled={busy}
                        command={command}
                      />
                    )}
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
                    )}
                    {game.currentPhase === "Collect Income" && (
                      <InfoCard
                        title="Payday"
                        copy={`${game.currentPower} banks ${game.state.income[game.currentPower]} IPC and the turn passes on.`}
                      />
                    )}
                    {/* Mirrored next to the control that caused it: the single
                        banner at the top of the dashboard could sit 3000px above
                        the button the player had just pressed. */}
                    {!!error && <ErrorBanner message={error} />}
                    {myTurn && (
                      <Button
                        label={
                          game.currentPhase === "Collect Income"
                            ? "Cash in & end turn"
                            : `Done with ${game.currentPhase}`
                        }
                        onPress={() => void command("complete_phase")}
                        loading={busy}
                      />
                    )}
                  </View>
                  <View style={[s.sideColumn, narrow && s.sideWide]}>
                    <MyPowers game={game} />
                <VictoryTracker game={game} catalog={catalog} />
                    <PowerLedger game={game} />
                    <Activity events={game.events} />
                  </View>
                </View>
                <View style={s.boardSection}>
                  <Board
                    owners={game.owners}
                    units={game.worldUnits}
                    battleSpaces={liveBattles}
                    resolvedSpaces={resolvedBattles}
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
              </>
            ) : (
              <>
                <View style={s.boardSection}>
                  <Board
                    owners={game.owners}
                    units={game.worldUnits}
                    battleSpaces={liveBattles}
                    resolvedSpaces={resolvedBattles}
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
                        blocked={blocked ? spaceName(catalog, blocked) : ""}
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
                    )}
                    {movement && (
                      <StationaryTransportPanel
                        game={game}
                        catalog={catalog}
                        disabled={!myTurn || busy}
                        command={command}
                      />
                    )}
                    {movement && game.currentPhase === "Combat Move" && (
                      <IgnoreSeaUnitsPanel
                        game={game}
                        catalog={catalog}
                        moves={moves}
                        disabled={!myTurn || busy}
                        command={command}
                        clear={() => setMoves([])}
                      />
                    )}
                    {game.currentPhase === "Purchase" && (
                      <PurchasePanel
                        game={game}
                        catalog={catalog}
                        disabled={!myTurn || busy}
                        command={command}
                      />
                    )}
                    {game.currentPhase === "Resolve Combat" && (
                      <CombatPanel
                        game={game}
                        catalog={catalog}
                        disabled={busy}
                        command={command}
                      />
                    )}
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
                    )}
                    {game.currentPhase === "Collect Income" && (
                      <InfoCard
                        title="Payday"
                        copy={`${game.currentPower} banks ${game.state.income[game.currentPower]} IPC and the turn passes on.`}
                      />
                    )}
                    {/* Mirrored next to the control that caused it: the single
                        banner at the top of the dashboard could sit 3000px above
                        the button the player had just pressed. */}
                    {!!error && <ErrorBanner message={error} />}
                    {myTurn && (
                      <Button
                        label={
                          game.currentPhase === "Collect Income"
                            ? "Cash in & end turn"
                            : `Done with ${game.currentPhase}`
                        }
                        onPress={() => void command("complete_phase")}
                        loading={busy}
                      />
                    )}
                  </View>
                  <View style={[s.sideColumn, narrow && s.sideWide]}>
                    <MyPowers game={game} />
                <VictoryTracker game={game} catalog={catalog} />
                    <PowerLedger game={game} />
                    <Activity events={game.events} />
                  </View>
                </View>
              </>
            )}
          </>
        )}
        {/* These used to be a bare underlined link inside a pink box plus a
            second bare link floating outside any container, which read as
            unfinished markup. */}
        {game.state.status === "active" &&
          (canConcede || game.me.isOwner) &&
          (concedeArmed ? (
            <View dataSet={{ class: "fc-rise" }} style={s.deleteConfirm}>
              <Text style={s.deleteWarning}>
                Conceding hands the win to the other side. No takebacks.
              </Text>
              <View style={s.confirmActions}>
                <SmallButton
                  label="Yes, I concede"
                  tone="danger"
                  disabled={busy}
                  onPress={() => void command("concede_game")}
                />
                <SmallButton
                  label="Never mind"
                  onPress={() => setConcedeArmed(false)}
                />
              </View>
            </View>
          ) : (
            <View style={s.dangerRow}>
              {canConcede && (
                <Pressable
                  accessibilityRole="button"
                  dataSet={{ class: "fc-press" }}
                  onPress={() => setConcedeArmed(true)}
                >
                  <Text style={s.dangerLink}>Concede</Text>
                </Pressable>
              )}
              {game.me.isOwner && (
                <Pressable
                  accessibilityRole="button"
                  dataSet={{ class: "fc-press" }}
                  onPress={() => void command("abandon_game")}
                >
                  <Text style={s.dangerLink}>Abandon this game</Text>
                </Pressable>
              )}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

function PhaseGuide({
  phase,
  myTurn,
  awaitingMe,
}: {
  phase: string;
  myTurn: boolean;
  /** A decision is waiting on me even though it is not my turn. Without this the
   *  guide told the player who had to act "sit tight", directly contradicting
   *  the "they're waiting on you" banner right above it. */
  awaitingMe: boolean;
}) {
  const instructions: Record<string, string> = {
    Purchase: "Spend your IPC on new units below the map.",
    "Combat Move":
      "Tap a space, pick your units, then tap where they're attacking.",
    "Resolve Combat": "Fight every battle below. You can't skip this one.",
    "Noncombat Move":
      "Reposition through friendly spaces. Planes have to land somewhere.",
    "Place Units": "Put your new units on a factory or the sea next to one.",
    "Collect Income": "Cash in and end your turn.",
  };
  return (
    <View style={s.phaseGuide}>
      <Text style={s.phaseGuideTitle}>
        {myTurn || awaitingMe ? "WHAT TO DO" : "WHAT'S HAPPENING"}
      </Text>
      <Text style={s.phaseGuideText}>
        {awaitingMe
          ? "A battle needs your call. Scroll to the decision above."
          : myTurn
            ? instructions[phase] || "Use the controls below the map."
            : `Someone else is doing their ${phase}. Sit tight.`}
      </Text>
    </View>
  );
}

function MovementPanel({
  blocked,
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
  /** Name of a space the player just tried to route into illegally. */
  blocked: string;
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
      <Text style={s.eyebrow}>MOVES</Text>
      <Text style={s.cardTitle}>Pick your targets</Text>
      <Text style={s.subtitle}>
        Tap a space, pick your units, then tap where they should go.
      </Text>
      {!!blocked && (
        <View dataSet={{ class: "fc-shake" }} style={s.warnBanner}>
          <Text style={s.warnText}>
            These units can't go into {blocked}.
          </Text>
        </View>
      )}
      {selected.length > 0 && (
        <View style={s.draft}>
          <Text style={s.draftText}>
            {plural(selected.length, "unit")} ready ·{" "}
            {route.length > 1
              ? route.map((id) => spaceName(catalog, id)).join(" → ")
              : "now tap where they're going"}
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
        <View key={m.unitId} style={s.orderRow}>
          <Text style={s.orderText}>{unitLabel(units, m.unitId)}</Text>
          <Text style={s.orderPath}>
            {m.path.map((id) => spaceName(catalog, id)).join(" → ")}
          </Text>
          <SmallButton
            label="Remove"
            tone="danger"
            onPress={() => remove(m.unitId)}
          />
        </View>
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
            <Text style={s.pendingTitle}>
              CARGO · {unitAt(units, catalog, move.unitId)}
            </Text>
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
                  UNLOAD DESTINATION · OPTIONAL
                </Text>
                <View style={s.chips}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: !unloads[move.unitId] }}
                    dataSet={{ class: "fc-press fc-glow" }}
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
                      accessibilityRole="button"
                      accessibilityLabel={space.name}
                      accessibilityState={{
                        selected: unloads[move.unitId] === space.id,
                      }}
                      dataSet={{ class: "fc-press fc-glow" }}
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
        label={`Send ${plural(moves.length + selected.length, "unit")}`}
        onPress={() => submit(orders)}
        disabled={disabled || (!moves.length && route.length < 2)}
      />
    </View>
  );
}

function PurchasePanel({
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
  const over = total > (game.state.ipcs[game.currentPower] || 0);
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
      <Text style={s.eyebrow}>SHOPPING</Text>
      <View style={s.cardHeading}>
        <Text style={s.cardTitle}>Build order</Text>
        <Text style={[s.total, over && s.totalOver]}>
          {total} / {game.state.ipcs[game.currentPower]} IPC
        </Text>
      </View>
      {over && (
        <View dataSet={{ class: "fc-rise" }} style={s.warnBanner}>
          <Text style={s.warnText}>
            That's {total - game.state.ipcs[game.currentPower]} IPC more than you
            have. Drop something before you can buy.
          </Text>
        </View>
      )}
      <View style={s.unitGrid}>
        {Object.entries(game.units).map(([name, spec]) => (
          <View key={name} style={s.unit}>
            <View style={s.unitTop}>
              <Text style={s.unitName}>{name}</Text>
              <Text style={s.unitCost}>{spec.Cost}</Text>
            </View>
            <StatPips
              attack={spec.Attack}
              defense={spec.Defense}
              move={spec.Move}
            />
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
          <Text style={s.sectionLabel}>FACTORY REPAIRS · 1 IPC EACH</Text>
          {factories.map((f) => (
            <View key={f.id} style={s.repairRow}>
              <Text style={s.orderText}>
                Factory in {spaceName(catalog, f.space)} ·{" "}
                {plural(f.damage || 0, "damage", "damage")}
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
  // Only targets you can actually hit right now get a row.
  const raidable = bombingTargets
    .map((target) => ({
      target,
      bombers: Object.values(game.worldUnits).filter(
        (u) =>
          u.owner === game.currentPower &&
          u.type === "Bomber" &&
          u.space === target,
      ),
    }))
    .filter((x) => x.bombers.length);
  return (
    <View style={s.stack}>
      <View style={s.card}>
        <Text style={s.eyebrow}>BATTLES</Text>
        <Text style={s.cardTitle}>
          {active.length
            ? `${plural(active.length, "battle")} to fight`
            : "Nothing to fight yet"}
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
        <Text style={s.eyebrow}>BOMBING RAIDS</Text>

        {raidable.map(({ target, bombers }) => (
          <View key={target} style={s.raidRow}>
            <View>
              <Text style={s.orderText}>{spaceName(catalog, target)}</Text>
              <Text style={s.hint}>
                {plural(bombers.length, "bomber")} in range
              </Text>
            </View>
            <SmallButton
              label="Bomb it"
              disabled={disabled}
              onPress={() =>
                void command("strategic_bomb", {
                  target,
                  bomberIds: bombers.map((u) => u.id),
                })
              }
            />
          </View>
        ))}
        {!raidable.length && (
          <Text style={s.hint}>
            {bombingTargets.length
              ? "Move a bomber onto an enemy factory to raid it."
              : "No enemy factories left standing."}
          </Text>
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
            Round {battle.round} ·{" "}
            {battle.complete
              ? `${battle.winner || "Nobody"} took it`
              : pending
                ? "Waiting on a decision"
                : stageLabel(battle.stage)}
          </Text>
        </View>
        {!battle.complete && !pending && battle.started && (
          <SmallButton
            label="Roll dice 🎲"
            disabled={disabled || !game.me.powers.includes(game.currentPower)}
            onPress={() =>
              void command("battle_step", { territory: battle.territory })
            }
          />
        )}
      </View>
      <DiceStrip rolls={battle.diceTranscript || []} />
      {battle.stage === "aaa" &&
        battle.round === 0 &&
        !battle.complete &&
        !battle.started && (
          <>
            {/* The bombardment picker is optional and only appears when ships
                can actually bombard, but the Fight! button below is the only
                way to start ANY battle and must never be gated on it. */}
            {bombardment.ids.length > 0 && (
              <>
                <Text style={s.sectionLabel}>SHORE BOMBARDMENT · OPTIONAL</Text>
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
              </>
            )}
            <SmallButton
              label="Fight!"
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
                specs={game.units}
                doomed
                atCap={choices.length >= requiredHits}
                counts
              />
              <Text style={s.hint}>
                {choices.length} of {plural(requiredHits, "hit")} assigned
              </Text>
              <SmallButton
                label="Lock it in"
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
  // Factories you own, with the capacity the engine enforces (territory IPC).
  const factories = Object.values(game.worldUnits)
    .filter(
      (u) =>
        u.type === "Industrial Complex" &&
        u.owner === game.currentPower &&
        game.owners[u.space] === game.currentPower,
    )
    .map((u) => {
      const space = catalog?.spaces.find((sp) => sp.id === u.space);
      const used = placements
        .filter((p) => p.Space === u.space)
        .reduce((n, p) => n + p.Count, 0);
      return {
        id: u.space,
        name: space?.name || u.space,
        capacity: space?.ipc || 0,
        used,
        damage: u.damage || 0,
      };
    })
    .sort((a, b) => b.capacity - a.capacity);
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
      <Text style={s.eyebrow}>DEPLOY</Text>
      <Text style={s.cardTitle}>Deploy your new stuff</Text>
      <Text style={s.subtitle}>
        Pick a unit, tap where it goes on the map, then add it. Land units go on
        a factory you own; ships go in the sea next to one.
      </Text>
      <Text style={s.sectionLabel}>WHERE YOU CAN BUILD</Text>
      {factories.length ? (
        <View style={s.chips}>
          {factories.map((f) => {
            const left = Math.max(0, f.capacity - f.damage - f.used);
            return (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                accessibilityLabel={`${f.name}, room for ${left}`}
                accessibilityState={{ selected: target === f.id }}
                dataSet={{ class: left ? "fc-press fc-glow" : "fc-off" }}
                disabled={!left}
                onPress={() => setTarget(f.id)}
                style={[
                  s.choiceChip,
                  target === f.id && s.choiceChipActive,
                  !left && s.choiceChipDisabled,
                ]}
              >
                <Text style={s.choiceText}>{f.name}</Text>
                <Text style={s.chipStats}>
                  room for {left}
                  {f.damage ? ` · ${f.damage} damaged` : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={s.hint}>
          You have no working factories, so there is nowhere to build this turn.
        </Text>
      )}
      <View style={s.chips}>
        {Object.entries(counts).map(([name, count]) => {
          const left = count - (planned[name] || 0);
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected: type === name, disabled: !left }}
              disabled={!left}
              dataSet={{ class: left ? "fc-press fc-glow" : "fc-off" }}
              onPress={() => setType(name)}
              style={[
                s.choiceChip,
                type === name && !!left && s.choiceChipActive,
                !left && s.choiceChipDisabled,
              ]}
            >
              <Text style={s.choiceText}>{name}</Text>
              <Text style={s.chipStats}>{left} left</Text>
            </Pressable>
          );
        })}
      </View>
      {!!type && (
        <View style={s.draft}>
          <Text style={s.draftText}>
            {type} → {target ? spaceName(catalog, target) : "tap the map"}
          </Text>
          <SmallButton label="Add it" onPress={add} disabled={!target} />
        </View>
      )}
      {placements.map((p, i) => (
        <View key={`${p.Type}-${p.Space}`} style={s.orderRow}>
          <Text style={s.orderText}>
            {p.Count} × {p.Type}
          </Text>
          <Text style={s.orderPath}>{spaceName(catalog, p.Space)}</Text>
          <SmallButton
            label="Remove"
            tone="danger"
            onPress={() => setPlacements((x) => x.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      <Button
        label="Deploy"
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
  const narrow = useWindowDimensions().width < NARROW;
  return (
    <>
      <View style={s.boardSection}>
        <Board owners={game.owners} units={game.worldUnits} />
      </View>
      <View style={[s.grid, narrow && s.column]}>
        <View style={s.mainColumn}>
          <View style={s.card}>
            <Text style={s.eyebrow}>WHO'S HERE</Text>
            <Text style={s.cardTitle}>
              {game.players.length} of 5 players here
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
              label="Deal powers & start"
              onPress={() => void command("start_game")}
              loading={busy}
              disabled={game.players.length < 2}
            />
          ) : (
            <Text style={s.notice}>
              Waiting for the host to kick things off.
            </Text>
          )}
        </View>
        <View style={[s.sideColumn, narrow && s.sideWide]}>
          <View style={s.card}>
            <Text style={s.eyebrow}>INVITE YOUR FRIENDS</Text>
            <Text selectable style={s.inviteCode}>
              {game.joinCode}
            </Text>
            <View style={s.inline}>
              <CopyButton label="Copy code" value={game.joinCode} />
              <CopyButton
                label="Copy link"
                value={`${location.origin}/join/${game.joinCode}`}
              />
            </View>
            <Text style={s.footnote}>
              Send this to your friends. 2–5 players.
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
  specs,
  doomed = false,
  atCap = false,
}: {
  ids: string[];
  units: Record<string, WorldUnit>;
  selected: string[];
  toggle: (id: string) => void;
  counts?: boolean;
  disabledIds?: string[];
  /** Unit stats, so a casualty choice shows what it actually costs you. */
  specs?: Record<string, { Cost: number; Attack: number; Defense: number }>;
  /** Selected units are being sent to die, not merely picked. */
  doomed?: boolean;
  /** Every hit is already assigned — unselected chips stop responding, so the
   *  click no longer silently no-ops with zero feedback. */
  atCap?: boolean;
}) {
  // Multiple identical units in a space used to be told apart only by their
  // internal id ("Infantry · u0213"), so they are numbered instead.
  const ordinals: Record<string, number> = {};
  const total: Record<string, number> = {};
  for (const id of ids) {
    const type = units[id]?.type || "Unit";
    total[type] = (total[type] || 0) + 1;
  }
  return (
    <View style={s.chips}>
      {ids.map((id, index) => {
        const count = selected.filter((x) => x === id).length;
        const type = units[id]?.type || "Unit";
        ordinals[type] = (ordinals[type] || 0) + 1;
        const spec = specs?.[type];
        const blocked = disabledIds.includes(id) || (atCap && count === 0);
        return (
          <Pressable
            key={`${id}-${index}`}
            accessibilityRole="button"
            accessibilityState={{ selected: count > 0, disabled: blocked }}
            accessibilityLabel={type}
            dataSet={{ class: blocked ? "fc-off" : "fc-press fc-glow" }}
            onPress={() => toggle(id)}
            disabled={blocked}
            style={[
              s.choiceChip,
              count > 0 && (doomed ? s.choiceChipDoomed : s.choiceChipActive),
              blocked && s.choiceChipDisabled,
            ]}
          >
            <Text style={s.choiceText}>
              {doomed && count > 0 ? "💀 " : ""}
              {type}
              {total[type] > 1 ? ` ${ordinals[type]}` : ""}
              {counts && count > 1 ? ` ×${count}` : ""}
            </Text>
            {!!spec && (
              <View style={s.unitStats}>
                <View style={s.unitStatItem}>
                  <StatIcon kind="atk" tint={color.danger} />
                  <Text style={s.chipStats}>{spec.Attack}</Text>
                </View>
                <View style={s.unitStatItem}>
                  <StatIcon kind="def" tint={color.cyan} />
                  <Text style={s.chipStats}>{spec.Defense}</Text>
                </View>
                <Text style={s.chipStats}>{spec.Cost} IPC</Text>
              </View>
            )}
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
      <Text style={s.eyebrow}>RETREAT · {spaceName(catalog, territory)}</Text>
      <DiceStrip rolls={game.battles[territory]?.diceTranscript || []} />
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
          label="Continue fighting"
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
        PICK YOUR LOSSES · {spaceName(catalog, territory)}
      </Text>
      <Text style={s.subtitle}>
        {minHits === maxHits
          ? `${pending.power} loses ${plural(maxHits, "unit")}.`
          : `${pending.power} loses ${minHits}–${maxHits} units.`}{" "}
        {/* This panel handles grouped losses for either side, so the follow-up
            sentence has to match which side is actually choosing. */}
        {pending.power === game.battles[territory]?.attacker
          ? "Your other attacking powers choose after you."
          : "The other defending powers choose after you."}
      </Text>
      <DiceStrip rolls={game.battles[territory]?.diceTranscript || []} />
      <ChipList
        ids={pending.eligible || []}
        units={game.worldUnits}
        selected={selected}
        toggle={add}
        specs={game.units}
        doomed
        atCap={selected.length >= maxHits}
        counts
      />
      <Text style={s.hint}>
        {selected.length} of {plural(maxHits, "hit")} assigned
      </Text>
      <View style={s.inline}>
        <SmallButton
          label="Clear"
          disabled={disabled || selected.length === 0}
          onPress={() => setSelected([])}
        />
        <SmallButton
          label="Lock it in"
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
      <Text style={s.eyebrow}>TRANSPORTS</Text>
      <Text style={s.subtitle}>
        Load or drop off cargo without moving the ship.
      </Text>
      <View style={s.chips}>
        {transports.map((u) => (
          <Pressable
            key={u.id}
            accessibilityRole="button"
            accessibilityLabel="Transport"
            accessibilityState={{ selected: transportID === u.id }}
            dataSet={{ class: "fc-press fc-glow" }}
            onPress={() => {
              setTransportID(u.id);
              setCargo([]);
              setUnload("");
            }}
            style={[s.choiceChip, transportID === u.id && s.choiceChipActive]}
          >
            <Text style={s.choiceText}>Transport</Text>
            <Text style={s.chipStats}>{spaceName(catalog, u.space)}</Text>
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
          <Text style={s.sectionLabel}>DROP OFF · OPTIONAL</Text>
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
                  accessibilityRole="button"
                  accessibilityLabel={spaceName(catalog, id)}
                  accessibilityState={{ selected: unload === id }}
                  dataSet={{ class: "fc-press fc-glow" }}
                  onPress={() => setUnload(unload === id ? "" : id)}
                  style={[s.choiceChip, unload === id && s.choiceChipActive]}
                >
                  <Text style={s.choiceText}>{spaceName(catalog, id)}</Text>
                </Pressable>
              ))}
          </View>
          <SmallButton
            label="Do it"
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
      <Text style={s.eyebrow}>SNEAK PAST</Text>
      <Text style={s.subtitle}>
        Normally you'd smash any lone enemy transports and hunt their subs. Pick
        a zone to slip through without a fight instead.
      </Text>
      <View style={s.chips}>
        {candidates.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={spaceName(catalog, id)}
            accessibilityState={{ selected: ignored.includes(id) }}
            dataSet={{ class: "fc-press fc-glow" }}
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
        label="Send moves"
        disabled={disabled}
        onPress={() => void submit()}
      />
    </View>
  );
}

/** C4: every player should be able to see how a battle turned out, not just the
 *  attacker who was clicking through it. Shown above the map so it is the first
 *  thing you meet when you come back to the game. */
const TURN_ORDER = [
  "Soviet Union",
  "Germany",
  "United Kingdom",
  "Japan",
  "United States",
];

/** A3: which powers are mine, and when do I act next. Neither was shown
 *  anywhere — players had to infer it from owner names in the ledger. */
function MyPowers({ game }: { game: Game }) {
  const mine = game.me.powers;
  if (!mine.length) return null;
  const current = TURN_ORDER.indexOf(game.currentPower);
  const nextMine = TURN_ORDER.map((power, i) => ({
    power,
    away: (i - current + TURN_ORDER.length) % TURN_ORDER.length,
  }))
    .filter((x) => mine.includes(x.power))
    .sort((a, b) => a.away - b.away)[0];
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>YOU CONTROL</Text>
      <View style={s.powerChips}>
        {mine.map((power) => (
          <View
            key={power}
            style={[
              s.powerChip,
              power === game.currentPower && s.powerChipActive,
            ]}
          >
            <View
              style={[
                s.ledgerSwatch,
                { backgroundColor: powerColor[power] || color.textDim },
              ]}
            />
            <Text style={s.powerChipText}>{power}</Text>
          </View>
        ))}
      </View>
      <Text style={s.hint}>
        {nextMine?.away === 0
          ? "It's your move right now."
          : nextMine
            ? `Your next turn: ${nextMine.power}, ${plural(nextMine.away, "turn")} away.`
            : "You have no powers this game."}
      </Text>
      <Text style={s.sectionLabel}>TURN ORDER</Text>
      <View style={s.turnOrderRow}>
        {TURN_ORDER.map((power) => {
          const isMine = mine.includes(power);
          const isNow = power === game.currentPower;
          return (
            <View
              key={power}
              style={[s.turnPip, isNow && s.turnPipNow, isMine && s.turnPipMine]}
            >
              <View
                style={[
                  s.turnPipDot,
                  { backgroundColor: powerColor[power] || color.textDim },
                ]}
              />
              <Text style={[s.turnPipText, isNow && s.turnPipTextNow]}>
                {power.replace("United ", "U. ").replace("Soviet Union", "USSR")}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
function BattleResults({
  game,
  catalog,
}: {
  game: Game;
  catalog: BoardCatalog | null;
}) {
  const done = Object.values(game.battles).filter((b) => b.complete);
  if (!done.length) return null;
  return (
    <View dataSet={{ class: "fc-rise" }} style={s.resultCard}>
      <Text style={s.resultTitle}>
        {done.length === 1 ? "BATTLE RESULT" : "BATTLE RESULTS"}
      </Text>
      {done.map((b) => {
        const mine = game.me.powers.includes(b.winner || "");
        return (
          <View key={b.territory} style={s.resultRow}>
            <Text style={s.resultIcon}>{mine ? "🎉" : "💥"}</Text>
            <Text style={s.resultText}>
              <Text style={s.resultWinner}>{b.winner || "Nobody"}</Text>
              {b.winner === b.attacker ? " took " : " held "}
              <Text style={s.resultPlace}>
                {spaceName(catalog, b.territory)}
              </Text>
              {` after ${plural(b.round, "round")}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SmallButton
      label={copied ? "Copied!" : label}
      onPress={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          },
          () => {},
        );
      }}
    />
  );
}
function VictoryTracker({
  game,
  catalog,
}: {
  game: Game;
  catalog: BoardCatalog | null;
}) {
  const cities = (catalog?.spaces || []).filter((sp) => sp.victoryCity);
  if (!cities.length) return null;
  const axisCities = cities.filter((sp) => {
    const owner = game.owners[sp.id];
    return owner === "Germany" || owner === "Japan";
  });
  const axis = axisCities.length;
  const allies = cities.length - axis;
  const rows = [
    { side: "Axis", held: axis, need: 9, tint: color.danger },
    { side: "Allies", held: allies, need: 10, tint: color.success },
  ];
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>ROAD TO VICTORY</Text>
      <Text style={s.subtitle}>
        {cities.length} victory cities on the board. First side to its number
        wins, checked after the United States turn.
      </Text>
      {rows.map((row) => (
        <View key={row.side} style={s.victoryRow}>
          <View style={s.victoryHead}>
            <Text style={s.ledgerPower}>{row.side}</Text>
            <Text style={s.victoryCount}>
              <Text style={{ color: row.tint }}>{row.held}</Text>
              <Text style={s.victoryNeed}> / {row.need}</Text>
            </Text>
          </View>
          <View style={s.victoryTrack}>
            {Array.from({ length: row.need }, (_, i) => (
              <View
                key={i}
                style={[
                  s.victoryPip,
                  i < row.held && { backgroundColor: row.tint },
                ]}
              />
            ))}
          </View>
          <Text style={s.hint}>
            {row.held >= row.need
              ? "Victory!"
              : `${row.need - row.held} more to win`}
          </Text>
        </View>
      ))}
    </View>
  );
}
function PowerLedger({ game }: { game: Game }) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>WHO'S WINNING</Text>
      {Object.entries(game.state.ipcs).map(([power, ipc]) => (
        <View key={power} style={s.ledgerRow}>
          <View style={s.flex}>
            <View style={s.ledgerPowerRow}>
              <View
                style={[
                  s.ledgerSwatch,
                  { backgroundColor: powerColor[power] || color.textDim },
                ]}
              />
              <Text style={s.ledgerPower}>{power}</Text>
            </View>
            <Text style={s.ledgerOwner}>
              {game.players.find((p) => p.powers.includes(power))?.name ||
                "Nobody"}{" "}
              · +{game.state.income[power]}/turn
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
      <Text style={s.eyebrow}>WHAT HAPPENED</Text>
      {events.slice(0, 10).map((e) => (
        <View key={e.sequence} style={s.event}>
          <View style={s.eventDot} />
          <View style={s.flex}>
            <Text style={s.eventText}>{e.message}</Text>
            <Text style={s.eventTime}>{timeAgo(e.at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
function InfoCard({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>UP NEXT</Text>
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
      return `${power || "A defender"} takes ${minHits}–${hits || 0} hits — pick who falls`;
    return `${power || "A defender"} takes ${plural(hits || 0, "hit")} — pick who falls`;
  }
  if (kind === "choose-submerge")
    return "Dive with your subs, or stay and fight";
  if (kind === "choose-fighter-landing")
    return "Extra fighters must land one space away or they're lost";
  return `${power || "The attacker"} can retreat or keep fighting`;
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
/** "just now" / "5m ago" — replaces raw `toLocaleString()` output. */
function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
/** "1 hit" / "2 hits" — replaces the "1 hit(s)" style throughout. */
function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
/** Player-facing name for a unit. The UI used to print internal keys such as
 *  "Infantry · u0213", "Tank u0052" and "u0001 / 10 Sea Zone". */
function unitLabel(units: Record<string, WorldUnit>, id: string) {
  return units[id]?.type || "Unit";
}
function unitAt(
  units: Record<string, WorldUnit>,
  catalog: BoardCatalog | null,
  id: string,
) {
  const u = units[id];
  return u ? `${u.type} in ${spaceName(catalog, u.space)}` : "Unit";
}
/** The battle card printed `battle.stage` verbatim, surfacing raw tokens like
 *  "aaa" and "queued" as "Round 1 / queued". */
const stageCopy: Record<string, string> = {
  aaa: "Anti-aircraft fire",
  queued: "Waiting to start",
  bombard: "Naval bombardment",
  main: "Fighting",
  complete: "Finished",
};
function stageLabel(stage: string) {
  return stageCopy[stage] || stage;
}
/** Small icon+number stats, replacing the "A2 D2 M1" codes. Inline SVG rather
 *  than emoji, which fall back to wildly different glyphs across platforms —
 *  ⚔ renders as a pair of scissors in the default Linux fallback font. */
function StatIcon({
  kind,
  tint,
}: {
  kind: "atk" | "def" | "mov";
  tint: string;
}) {
  const paths = {
    atk: "M13.5 2.5l2 2-7 7-2-2 7-7zM3 12l3 3-1.5 1.5L2 14l1-2z",
    def: "M9 1.5l6 2.5v5c0 4-2.6 6.6-6 7.5-3.4-.9-6-3.5-6-7.5v-5l6-2.5z",
    mov: "M2 9h11M9.5 5l4 4-4 4",
  };
  return (
    <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d={paths[kind]}
        fill={kind === "mov" ? "none" : tint}
        stroke={tint}
        strokeWidth={kind === "mov" ? 2 : 1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
/** One die face. Pips are drawn, not glyphs, so they read at 26px. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};
function Die({
  value,
  delay,
  hit,
}: {
  value: number;
  delay: number;
  /** undefined when the server did not record a target (older saved games). */
  hit?: boolean;
}) {
  const face = hit === true ? color.danger : color.text;
  const pip = hit === true ? "#FFFFFF" : color.bgDeep;
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 30 30"
      className="fc-tumble"
      style={{ animationDelay: `${delay}ms`, flexShrink: 0 }}
      aria-label={
        hit === undefined
          ? `Rolled ${value}`
          : `Rolled ${value}, ${hit ? "hit" : "miss"}`
      }
    >
      <rect
        width="30"
        height="30"
        rx="7"
        fill={face}
        stroke={hit === true ? "#7F1D2B" : color.violetDeep}
        strokeWidth="1.5"
        opacity={hit === false ? 0.45 : 1}
      />
      {(PIPS[value] || []).map(([cx, cy], i) => (
        <circle key={i} cx={6 + cx * 9} cy={6 + cy * 9} r="2.7" fill={pip} />
      ))}
    </svg>
  );
}
/** The real transcript the server already sends — no invented results.
 *  The server emits one entry per firing unit, so "attacker regular fire
 *  Infantry" x3 collapses into a single attacker row of three dice. */
function DiceStrip({ rolls }: { rolls: DiceRoll[] }) {
  if (!rolls.length) return null;
  const side = (purpose: string) =>
    purpose.startsWith("attacker")
      ? "Attackers"
      : purpose.startsWith("defender")
        ? "Defenders"
        : purpose.replace(/^\w/, (m) => m.toUpperCase());
  type Face = { value: number; hit?: boolean };
  const groups: { label: string; faces: Face[] }[] = [];
  for (const roll of rolls) {
    const label = side(roll.purpose);
    const faces: Face[] = roll.results.map((value) => ({
      value,
      hit: roll.target ? value <= roll.target : undefined,
    }));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.faces.push(...faces);
    else groups.push({ label, faces });
  }
  return (
    <View style={s.diceBlock}>
      <Text style={s.diceHeading}>THE DICE</Text>
      {groups.slice(-3).map((group, i) => {
        const hits = group.faces.filter((f) => f.hit === true).length;
        const scored = group.faces.some((f) => f.hit !== undefined);
        return (
          <View key={`${group.label}-${i}`} style={s.diceRow}>
            <View style={s.diceRowHead}>
              <Text style={s.dicePurpose}>{group.label}</Text>
              {scored && (
                <Text style={hits ? s.diceHits : s.diceNoHits}>
                  {hits ? `${plural(hits, "hit")}!` : "no hits"}
                </Text>
              )}
            </View>
            <View style={s.diceFaces}>
              {group.faces.map((face, j) => (
                <Die key={j} value={face.value} hit={face.hit} delay={j * 70} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
function StatPips({
  attack,
  defense,
  move,
}: {
  attack: number;
  defense: number;
  move: number;
}) {
  return (
    <View
      style={s.unitStats}
      accessibilityLabel={`Attack ${attack}, defence ${defense}, move ${move}`}
    >
      <View style={s.unitStatItem}>
        <StatIcon kind="atk" tint={color.danger} />
        <Text style={s.unitStat}>{attack}</Text>
      </View>
      <View style={s.unitStatItem}>
        <StatIcon kind="def" tint={color.cyan} />
        <Text style={s.unitStat}>{defense}</Text>
      </View>
      <View style={s.unitStatItem}>
        <StatIcon kind="mov" tint={color.lime} />
        <Text style={s.unitStat}>{move}</Text>
      </View>
    </View>
  );
}
function Brand() {
  return (
    <View style={s.brandRow}>
      <View style={s.brandMark}>
        <Text style={s.brandLetter}>◆</Text>
      </View>
      <Text style={s.brand}>FRONTLINE</Text>
    </View>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return <View style={s.shell}>{children}</View>;
}
let fieldSeq = 0;
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
  // Inputs previously had no label association at all: a <Text> floating above a
  // <TextInput>, no id/htmlFor, no aria-label. Screen readers announced nothing.
  const [id] = useState(() => `fc-field-${++fieldSeq}`);
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text nativeID={id} style={s.label}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textDim}
        accessibilityLabel={label}
        accessibilityLabelledBy={id}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[s.input, focused && s.inputFocused]}
      />
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "ghost";
}) {
  const dead = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: dead, busy: loading }}
      onPress={onPress}
      disabled={dead}
      // `fc-press`/`fc-lift` carry the hover + press transitions; RNW cannot
      // express :hover from the style prop.
      dataSet={{ class: dead ? "fc-press fc-off" : "fc-press fc-lift" }}
      style={[
        s.button,
        tone === "ghost" && s.buttonGhost,
        dead && s.buttonDisabled,
      ]}
    >
      <Text style={[s.buttonText, dead && s.buttonTextDisabled]}>{label}</Text>
      {loading ? (
        <View dataSet={{ class: "fc-spin" }} style={s.spinner} />
      ) : (
        <Text style={[s.buttonArrow, dead && s.buttonTextDisabled]}>→</Text>
      )}
    </Pressable>
  );
}
function SmallButton({
  label,
  onPress,
  disabled = false,
  tone = "default",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      dataSet={{ class: disabled ? "fc-press fc-off" : "fc-press fc-glow" }}
      // Without alignSelf this stretched to the full card width whenever it sat
      // in a column parent (e.g. "Add placement", "Start battle with selection").
      style={[
        s.smallButton,
        tone === "danger" && s.smallButtonDanger,
        disabled && s.smallButtonDisabled,
      ]}
    >
      <Text
        style={[
          s.smallButtonText,
          tone === "danger" && s.smallButtonTextDanger,
          disabled && s.smallButtonTextDisabled,
        ]}
      >
        {label}
      </Text>
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
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      dataSet={{ class: "fc-press" }}
      style={[s.tab, active && s.tabActive]}
    >
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}
function StatusPill({ status }: { status: string }) {
  const live = status === "active";
  return (
    <View style={[s.status, live && s.statusLive]}>
      <View
        dataSet={live ? { class: "fc-pulse" } : undefined}
        style={[s.statusDot, live && s.statusDotLive]}
      />
      <Text style={[s.statusText, live && s.statusTextLive]}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
}
function ErrorBanner({ message }: { message: string }) {
  return (
    <View
      accessibilityRole="alert"
      dataSet={{ class: "fc-shake" }}
      style={s.errorBanner}
    >
      <Text style={s.errorTitle}>THAT WON'T WORK</Text>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bgDeep },
  app: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  column: { flexDirection: "column" },

  // ---- Landing ----------------------------------------------------------
  // flexGrow (not minHeight:"100%") is what makes the split fill the viewport
  // once #root is a flex container.
  landing: { flexGrow: 1, flexDirection: "row" },
  hero: {
    flex: 1,
    padding: 64,
    justifyContent: "center",
    gap: space.xl,
    backgroundColor: color.bgDeep,
  },
  heroNarrow: { padding: space.xxl, paddingVertical: 44, minHeight: 420 },
  access: {
    width: "44%",
    maxWidth: 620,
    padding: 56,
    justifyContent: "center",
    backgroundColor: color.bg,
    borderLeftWidth: 1,
    borderLeftColor: color.borderSoft,
  },
  accessNarrow: {
    width: "100%",
    maxWidth: "100%",
    padding: space.xxl,
    borderLeftWidth: 0,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: color.violet,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: { color: color.onAccent, fontSize: 13 },
  brand: { ...t.label, color: color.text },
  kicker: { ...t.label, color: color.cyan },
  heroTitle: {
    ...t.display,
    fontSize: 60,
    lineHeight: 62,
    letterSpacing: -1.6,
    color: color.text,
  },
  heroTitleNarrow: { fontSize: 38, lineHeight: 41, letterSpacing: -0.9 },
  gold: { color: color.magenta },
  heroCopy: { ...t.body, fontSize: 17, lineHeight: 27, color: color.textSoft, maxWidth: 540 },
  heroFoot: { ...t.micro, color: color.textDim, letterSpacing: 0.6 },
  eyebrow: { ...t.label, color: color.cyan },
  panelTitle: { ...t.h1, color: color.text, marginBottom: space.xxl },
  tabs: {
    flexDirection: "row",
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    marginBottom: space.xxl,
    alignSelf: "flex-start",
  },
  tab: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: color.violet },
  tabText: { ...t.label, color: color.textSoft },
  tabTextActive: { color: color.onAccent },
  field: { marginBottom: space.xl },
  label: { ...t.label, color: color.textSoft, marginBottom: space.sm },
  input: {
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    ...t.body,
    color: color.text,
  },
  inputFocused: { borderColor: color.cyan, backgroundColor: color.surface2 },
  footnote: { ...t.micro, color: color.textDim, marginTop: space.lg },
  campaignSection: {
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    marginTop: space.xxxl,
    paddingTop: space.xxl,
    gap: space.md,
  },
  campaignCard: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  campaignOpen: {
    minHeight: 68,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
  },
  campaignName: { ...t.h3, color: color.text, marginBottom: 2 },
  campaignMeta: { ...t.micro, color: color.textDim },
  campaignArrow: { color: color.magenta, fontSize: 20 },
  yourMoveTag: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: color.magenta,
  },
  yourMoveText: { ...t.micro, fontWeight: "800", color: color.onAccent },
  campaignDelete: {
    ...t.micro,
    fontWeight: "700",
    color: color.danger,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  deleteConfirm: {
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: "rgba(255,77,94,.10)",
    padding: space.lg,
    borderRadius: radius.lg,
  },
  deleteWarning: { ...t.body, color: color.text, marginBottom: space.md },
  confirmActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  unavailableCampaign: {
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },

  // ---- Shell / dashboard -------------------------------------------------
  topbar: {
    minHeight: 60,
    paddingHorizontal: space.xxl,
    backgroundColor: color.bgDeep,
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quietLink: {
    ...t.label,
    color: color.textSoft,
    minHeight: 44,
    lineHeight: 44,
    paddingHorizontal: space.sm,
  },
  dashboard: {
    width: "100%",
    maxWidth: 1560,
    alignSelf: "center",
    padding: space.xxl,
    gap: space.lg,
  },
  // flexWrap + a shrinkable text block: without them the 30px title refused to
  // shrink and shoved the status pill off the right edge on phones.
  gameHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
  },
  gameHeaderText: { flex: 1, minWidth: 200 },
  title: { ...t.h1, color: color.text },
  subtitle: { ...t.body, color: color.textSoft },
  code: {
    fontWeight: "800",
    letterSpacing: 1.6,
    color: color.cyan,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: color.surface,
  },
  statusLive: {
    borderColor: "rgba(52,211,153,.5)",
    backgroundColor: "rgba(52,211,153,.12)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: color.textDim,
  },
  statusDotLive: { backgroundColor: color.success },
  statusText: { ...t.micro, fontWeight: "700", color: color.textSoft },
  statusTextLive: { color: color.success },

  turnCard: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.lg,
    borderLeftWidth: 5,
    boxShadow: shadow.card,
  },
  turnCardMine: { borderLeftColor: color.magenta },
  turnCardTheirs: { borderLeftColor: color.border },
  turnPower: { ...t.display, fontSize: 34, lineHeight: 38, color: color.text },
  ipcBadge: { alignItems: "center", minWidth: 92 },
  ipcValue: {
    ...t.display,
    fontSize: 38,
    lineHeight: 42,
    color: color.tangerine,
  },
  ipcLabel: { ...t.micro, fontWeight: "700", color: color.textDim },
  phaseGuide: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 5,
    borderLeftColor: color.cyan,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  phaseGuideTitle: { ...t.label, color: color.cyan, marginBottom: space.xs },
  phaseGuideText: { ...t.body, color: color.textSoft },
  boardSection: { width: "100%" },
  grid: { flexDirection: "row", alignItems: "stretch", gap: space.lg },
  // alignSelf:"stretch" is what stops this collapsing to content width once the
  // grid stacks into a column.
  mainColumn: { flex: 1, alignSelf: "stretch", gap: space.lg },
  sideColumn: { width: 360, gap: space.lg },
  sideWide: { width: "100%" },
  stack: { gap: space.lg },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.xl,
    boxShadow: shadow.card,
  },
  cardTitle: { ...t.h2, color: color.text, marginBottom: space.sm },
  cardHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
  },
  total: { ...t.h2, color: color.tangerine },
  totalOver: { color: color.danger },
  warnBanner: {
    backgroundColor: "rgba(255,77,94,.14)",
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: color.danger,
    padding: space.md,
    marginTop: space.sm,
  },
  warnText: { ...t.body, color: color.text },

  // ---- Buttons ------------------------------------------------------------
  button: {
    minHeight: 52,
    backgroundColor: color.violet,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    marginTop: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    boxShadow: shadow.button,
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: color.border,
    boxShadow: "none",
  },
  // A real disabled recipe rather than opacity:0.35, which made gold-on-cream
  // read as a half-painted element at 1.72:1.
  buttonDisabled: {
    backgroundColor: color.surface2,
    borderWidth: 1,
    borderColor: color.border,
    boxShadow: "none",
  },
  buttonText: { ...t.label, fontSize: 14, color: color.onAccent },
  buttonTextDisabled: { color: color.textSoft },
  buttonArrow: { color: color.onAccent, fontSize: 18 },
  spinner: {
    width: 15,
    height: 15,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,.28)",
    borderTopColor: color.onAccent,
  },
  smallButton: {
    alignSelf: "flex-start",
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
    minHeight: 44,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonDanger: {
    borderColor: "rgba(255,77,94,.55)",
    backgroundColor: "rgba(255,77,94,.14)",
  },
  smallButtonDisabled: {
    backgroundColor: color.surface,
    borderColor: color.borderSoft,
  },
  smallButtonText: { ...t.label, color: color.text },
  smallButtonTextDanger: { color: color.danger },
  smallButtonTextDisabled: { color: color.textDim },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.9 },

  // ---- Banners ------------------------------------------------------------
  errorBanner: {
    backgroundColor: "rgba(255,77,94,.14)",
    borderWidth: 1,
    borderColor: "rgba(255,77,94,.5)",
    borderRadius: radius.md,
    borderLeftWidth: 5,
    borderLeftColor: color.danger,
    padding: space.lg,
  },
  errorTitle: { ...t.label, color: color.danger, marginBottom: space.xs },
  errorText: { ...t.body, color: color.text },
  noticeBanner: {
    backgroundColor: "rgba(52,211,153,.12)",
    borderRadius: radius.md,
    borderLeftWidth: 5,
    borderLeftColor: color.success,
    padding: space.md,
    paddingHorizontal: space.lg,
  },
  noticeText: { ...t.body, color: color.textSoft },
  decisionAlert: {
    backgroundColor: "rgba(233,53,193,.14)",
    borderWidth: 1,
    borderColor: "rgba(233,53,193,.5)",
    borderRadius: radius.md,
    padding: space.lg,
  },
  decisionTitle: { ...t.label, color: color.magenta },
  decisionCopy: { ...t.body, color: color.text, marginTop: space.xs },

  // ---- Purchase -----------------------------------------------------------
  unitGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    marginTop: space.lg,
  },
  // flexBasis + flexGrow instead of a fixed width:150, which left ragged last
  // rows and ~190px of dead gutter at phone widths.
  unit: {
    flexBasis: 158,
    flexGrow: 1,
    minWidth: 158,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: color.surface2,
  },
  unitTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  unitName: { ...t.bodyEm, fontSize: 14, color: color.text, flex: 1 },
  unitCost: { ...t.h3, color: color.tangerine },
  unitStats: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.sm,
    flexWrap: "wrap",
  },
  unitStat: { ...t.micro, fontWeight: "700", color: color.textSoft },
  unitStatItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    marginTop: space.md,
  },
  stepCount: {
    minWidth: 26,
    textAlign: "center",
    ...t.h3,
    color: color.text,
  },
  sectionLabel: {
    ...t.label,
    color: color.textSoft,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  repairRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.md,
  },
  draft: {
    backgroundColor: color.surface2,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
    gap: space.sm,
  },
  draftText: { ...t.bodyEm, color: color.text },
  inline: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  orderRow: {
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  orderText: { ...t.bodyEm, color: color.text },
  orderPath: { ...t.micro, color: color.textSoft, flex: 1 },
  hint: { ...t.micro, color: color.textDim, marginTop: space.sm },

  // ---- Combat -------------------------------------------------------------
  battle: {
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.lg,
  },
  battleName: { ...t.h2, color: color.text },
  pending: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface2,
  },
  pendingTitle: { ...t.label, color: color.text, marginBottom: space.sm },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginVertical: space.md,
  },
  choiceChip: {
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: color.surface2,
  },
  choiceChipActive: {
    borderColor: color.cyan,
    backgroundColor: "rgba(34,211,238,.22)",
  },
  choiceChipDoomed: {
    borderColor: color.danger,
    backgroundColor: "rgba(255,77,94,.22)",
  },
  choiceChipDisabled: { opacity: 0.4, borderColor: color.borderSoft },
  choiceText: { ...t.micro, fontWeight: "700", color: color.text },
  chipStats: { ...t.micro, fontSize: 11, color: color.textSoft, marginTop: 2 },
  diceBlock: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface2,
    gap: space.sm,
  },
  diceHeading: { ...t.label, color: color.textSoft, marginBottom: space.xs },
  diceRow: { gap: space.xs },
  diceRowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  diceHits: { ...t.label, color: color.danger },
  diceNoHits: { ...t.micro, color: color.textDim },
  dicePurpose: { ...t.micro, color: color.textSoft },
  diceFaces: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  raidRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.md,
  },

  // ---- Ledger / activity --------------------------------------------------
  ledgerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.md,
  },
  powerChips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  powerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: color.surface2,
  },
  powerChipActive: {
    borderColor: color.magenta,
    backgroundColor: "rgba(233,53,193,.18)",
  },
  powerChipText: { ...t.bodyEm, fontSize: 14, color: color.text },
  turnOrderRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  turnPip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: 1,
    borderColor: "transparent",
  },
  turnPipNow: { backgroundColor: color.surfaceHi, borderColor: color.magenta },
  turnPipMine: { borderColor: color.border },
  turnPipDot: { width: 7, height: 7, borderRadius: radius.pill },
  turnPipText: { ...t.micro, color: color.textDim },
  turnPipTextNow: { color: color.text, fontWeight: "700" },
  resultCard: {
    backgroundColor: "rgba(255,159,28,.14)",
    borderWidth: 1,
    borderColor: "rgba(255,159,28,.5)",
    borderRadius: radius.md,
    borderLeftWidth: 5,
    borderLeftColor: color.tangerine,
    padding: space.lg,
    gap: space.sm,
  },
  resultTitle: { ...t.label, color: color.tangerine },
  resultRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  resultIcon: { fontSize: 18 },
  resultText: { ...t.body, color: color.text, flex: 1 },
  resultWinner: { fontWeight: "800" },
  resultPlace: { fontWeight: "800", color: color.tangerine },
  victoryRow: {
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.md,
    gap: space.sm,
  },
  victoryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  victoryCount: { ...t.h3 },
  victoryNeed: { color: color.textDim },
  victoryTrack: { flexDirection: "row", gap: 3, flexWrap: "wrap" },
  victoryPip: {
    width: 16,
    height: 8,
    borderRadius: 3,
    backgroundColor: color.surfaceHi,
  },
  ledgerPowerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  ledgerSwatch: { width: 10, height: 10, borderRadius: radius.pill },
  ledgerPower: { ...t.bodyEm, color: color.text },
  ledgerOwner: { ...t.micro, color: color.textSoft, marginTop: 2 },
  ledgerIPC: { ...t.h2, color: color.tangerine },
  event: {
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
  },
  eventDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: color.magenta,
    marginTop: 7,
  },
  eventText: { ...t.body, fontSize: 14, lineHeight: 20, color: color.textSoft },
  eventTime: { ...t.micro, color: color.textDim, marginTop: 2 },

  // ---- Lobby --------------------------------------------------------------
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderSoft,
    paddingVertical: space.lg,
  },
  playerNumber: { ...t.h3, color: color.magenta, width: 34 },
  playerName: { flex: 1, ...t.bodyEm, color: color.text },
  playerRole: {
    ...t.micro,
    fontWeight: "700",
    color: color.textSoft,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: "hidden",
  },
  inviteCode: {
    ...t.display,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: 5,
    color: color.cyan,
    marginVertical: space.md,
  },
  notice: {
    ...t.body,
    color: color.textSoft,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface2,
  },
  dangerLink: {
    ...t.label,
    color: color.danger,
    minHeight: 44,
    lineHeight: 44,
    paddingHorizontal: space.sm,
  },
  dangerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.lg,
    marginTop: space.sm,
  },
  shell: {
    flex: 1,
    padding: space.xxxl,
    justifyContent: "center",
    gap: space.lg,
    backgroundColor: color.bg,
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
