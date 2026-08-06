import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { groupUnitStacks, type UnitStack } from "./mapUnits";
import { NARROW, color, powerColor, radius, type as t } from "./theme";
import type { BoardCatalog, BoardSpace, WorldUnit } from "./types";

type MapView = { x: number; y: number; width: number; height: number };
type Gesture = {
  points: Map<number, { x: number; y: number }>;
  starts: Map<number, { x: number; y: number }>;
  base: MapView;
  distance: number;
  anchor: { x: number; y: number };
  moved: boolean;
};
type Props = {
  owners?: Record<string, string>;
  units?: Record<string, WorldUnit>;
  currentPower?: string;
  canSelectUnits?: boolean;
  selectedUnitIds?: string[];
  route?: string[];
  highlightedSpaces?: string[];
  /** Territories with a live battle, so every player — not just the attacker —
   *  can see where the fighting is. */
  battleSpaces?: string[];
  /** Territories whose battle just finished, for a one-shot burst. */
  resolvedSpaces?: string[];
  onToggleUnit?: (id: string) => void;
  onSpacePress?: (space: BoardSpace, catalog: BoardCatalog) => void;
  onCatalog?: (catalog: BoardCatalog) => void;
};

const BOARD_WIDTH = 3500,
  BOARD_HEIGHT = 2000,
  MIN_WIDTH = 720;
// Single source in theme.ts so a power looks identical on the map, in the
// ledger, and on every chip.
export const powerColors = powerColor;
const abbreviations: Record<string, string> = {
  Infantry: "INF",
  Artillery: "ART",
  Tank: "TNK",
  AAA: "AAA",
  Fighter: "FTR",
  Bomber: "BMR",
  Submarine: "SUB",
  Transport: "TRN",
  Destroyer: "DST",
  Cruiser: "CRS",
  "Aircraft Carrier": "CV",
  Battleship: "BB",
  "Industrial Complex": "IC",
};

export function Board({
  owners = {},
  units = {},
  currentPower = "",
  canSelectUnits = false,
  selectedUnitIds = [],
  route = [],
  highlightedSpaces = [],
  battleSpaces = [],
  resolvedSpaces = [],
  onToggleUnit,
  onSpacePress,
  onCatalog,
}: Props) {
  const [catalog, setCatalog] = useState<BoardCatalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedID, setSelectedID] = useState("");
  const [view, setView] = useState<MapView>({
    x: 0,
    y: 0,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
  });
  const gesture = useRef<Gesture>({
    points: new Map(),
    starts: new Map(),
    base: view,
    distance: 0,
    anchor: { x: 0, y: 0 },
    moved: false,
  });
  const narrow = useWindowDimensions().width < NARROW;
  const stacksBySpace = useMemo(() => groupUnitStacks(units), [units]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/board?v=1942-se-polygons-2", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error("board request failed");
        return r.json();
      })
      .then((data: BoardCatalog) => {
        if (
          data.spaces.length !== 161 ||
          data.spaces.some(
            (space) =>
              !Array.isArray(space.polygons) || space.polygons.length === 0,
          )
        )
          throw new Error("incompatible board catalog");
        setCatalog(data);
        onCatalog?.(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setLoadError(true);
      });
    return () => controller.abort();
  }, [onCatalog]);
  const clamp = (next: MapView): MapView => ({
    ...next,
    x: Math.max(0, Math.min(BOARD_WIDTH - next.width, next.x)),
    y: Math.max(0, Math.min(BOARD_HEIGHT - next.height, next.y)),
  });
  const zoomAt = (factor: number, position = { x: 0.5, y: 0.5 }) =>
    setView((current) => {
      const width = Math.max(
        MIN_WIDTH,
        Math.min(BOARD_WIDTH, current.width * factor),
      );
      const height = (width * BOARD_HEIGHT) / BOARD_WIDTH;
      return clamp({
        x: current.x + current.width * position.x - width * position.x,
        y: current.y + current.height * position.y - height * position.y,
        width,
        height,
      });
    });
  if (!catalog)
    return (
      <View style={styles.loading}>
        {!loadError && (
          <View dataSet={{ class: "fc-spin" }} style={styles.loadingDot} />
        )}
        <Text style={styles.empty}>
          {loadError
            ? "Couldn't load the map. Try refreshing."
            : "Spinning up the world…"}
        </Text>
      </View>
    );
  const selected = catalog.spaces.find((s) => s.id === selectedID);
  const selectedUnits = selected
    ? Object.values(units).filter(
        (u) => u.space === selected.id && !u.transportId,
      )
    : [];
  const choose = (space: BoardSpace) => {
    setSelectedID(space.id);
    onSpacePress?.(space, catalog);
  };
  // Exactly one territory carries tabIndex=0 at a time.
  const focusedSpaceID = selectedID || catalog.spaces[0]?.id;
  const routeSet = new Set(route),
    highlightSet = new Set(highlightedSpaces),
    // Raised from 2200: at the default FIT view (width 3500) the map showed no
    // unit types at all, just a field of identical number badges.
    showUnitTypes = view.width <= 3600;
  return (
    <View style={styles.frame}>
      <View style={[styles.toolbar, narrow && styles.toolbarNarrow]}>
        <View>
          <Text style={styles.eyebrow}>1942 SECOND EDITION</Text>
          <Text style={[styles.heading, narrow && styles.headingNarrow]}>
            The world
          </Text>
        </View>
        <View style={styles.controls}>
          <MapButton label="−" title="Zoom out" onPress={() => zoomAt(1.35)} />
          <MapButton label="+" title="Zoom in" onPress={() => zoomAt(0.72)} />
          <MapButton
            label="FIT"
            title="Fit the whole map"
            onPress={() =>
              setView({ x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT })
            }
          />
        </View>
      </View>
      <View style={[styles.mapWrap, narrow && styles.mapWrapNarrow]}>
        {/* The hint used to read "SELECT ANY TERRITORY FOR DETAILS" even after
            you had selected one. It now tracks the actual state. */}
        <View style={styles.mapHint} pointerEvents="none">
          <Text style={styles.mapHintText}>
            {canSelectUnits
              ? selectedUnitIds.length
                ? route.length > 1
                  ? "KEEP CLICKING TO EXTEND · ADD ROUTE WHEN DONE"
                  : "NOW CLICK AN ADJACENT SPACE"
                : selected
                  ? "PICK YOUR UNITS BELOW"
                  : "TAP A TERRITORY TO START"
              : selected
                ? selected.name.toUpperCase()
                : "TAP ANY TERRITORY"}
          </Text>
        </View>
        <svg
          aria-label="Interactive Axis and Allies theater map"
          role="application"
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          preserveAspectRatio={narrow ? "xMidYMid slice" : "xMidYMid meet"}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            touchAction: "none",
            cursor: "grab",
          }}
          // role="application" tells screen readers the app owns every
          // keystroke, but the map previously implemented none — you could
          // select a space and then had no way to pan or zoom to see it.
          onKeyDown={(e) => {
            const step = view.width * 0.2;
            const pan = (dx: number, dy: number) => {
              e.preventDefault();
              setView((c) => clamp({ ...c, x: c.x + dx, y: c.y + dy }));
            };
            if (e.key === "ArrowLeft") pan(-step, 0);
            else if (e.key === "ArrowRight") pan(step, 0);
            else if (e.key === "ArrowUp") pan(0, -step);
            else if (e.key === "ArrowDown") pan(0, step);
            else if (e.key === "+" || e.key === "=") zoomAt(0.72);
            else if (e.key === "-" || e.key === "_") zoomAt(1.35);
            else if (e.key === "0")
              setView({ x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT });
          }}
          onDoubleClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            zoomAt(0.65, {
              x: (e.clientX - r.left) / r.width,
              y: (e.clientY - r.top) / r.height,
            });
          }}
          onWheel={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            zoomAt(e.deltaY > 0 ? 1.15 : 0.87, {
              x: (e.clientX - r.left) / r.width,
              y: (e.clientY - r.top) / r.height,
            });
          }}
          onPointerDown={(e) => {
            const points = gesture.current.points;
            points.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const starts = new Map(points),
              values = [...starts.values()],
              center =
                values.length > 1 ? midpoint(values[0], values[1]) : values[0],
              r = e.currentTarget.getBoundingClientRect();
            gesture.current = {
              points,
              starts,
              base: view,
              distance: values.length > 1 ? distance(values[0], values[1]) : 0,
              anchor: {
                x: view.x + ((center.x - r.left) / r.width) * view.width,
                y: view.y + ((center.y - r.top) / r.height) * view.height,
              },
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g.points.has(e.pointerId)) return;
            g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const points = [...g.points.values()],
              starts = [...g.starts.values()],
              r = e.currentTarget.getBoundingClientRect();
            if (points.length > 1 && starts.length > 1) {
              const center = midpoint(points[0], points[1]),
                width = Math.max(
                  MIN_WIDTH,
                  Math.min(
                    BOARD_WIDTH,
                    (g.base.width * g.distance) /
                      distance(points[0], points[1]),
                  ),
                ),
                height = (width * BOARD_HEIGHT) / BOARD_WIDTH;
              setView(
                clamp({
                  x: g.anchor.x - ((center.x - r.left) / r.width) * width,
                  y: g.anchor.y - ((center.y - r.top) / r.height) * height,
                  width,
                  height,
                }),
              );
              g.moved = true;
            } else if (points[0] && starts[0]) {
              const dx = points[0].x - starts[0].x,
                dy = points[0].y - starts[0].y;
              if (Math.abs(dx) + Math.abs(dy) > 4) {
                g.moved = true;
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              setView(
                clamp({
                  ...g.base,
                  x: g.base.x - (dx / r.width) * g.base.width,
                  y: g.base.y - (dy / r.height) * g.base.height,
                }),
              );
            }
          }}
          onPointerUp={(e) => {
            gesture.current.points.delete(e.pointerId);
          }}
          onPointerCancel={(e) => {
            gesture.current.points.delete(e.pointerId);
          }}
        >
          <defs>
            <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#315f70" />
              <stop offset=".55" stopColor="#234f60" />
              <stop offset="1" stopColor="#173f50" />
            </linearGradient>
            <linearGradient id="seaZone" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#477a87" stopOpacity=".38" />
              <stop offset="1" stopColor="#0e3444" stopOpacity=".24" />
            </linearGradient>
            <pattern
              id="oceanLines"
              width="90"
              height="90"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 30 Q22 18 45 30 T90 30 M0 62 Q22 50 45 62 T90 62"
                fill="none"
                stroke="#b8d6d9"
                strokeOpacity=".035"
                strokeWidth="5"
              />
            </pattern>
            <pattern
              id="hatch"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(24)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="22"
                stroke="#fff3c4"
                strokeOpacity=".075"
                strokeWidth="4"
              />
            </pattern>
          </defs>
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#ocean)" />
          <rect
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            fill="url(#oceanLines)"
          />
          <g
            fill="url(#seaZone)"
            stroke="#9fc2ca"
            strokeOpacity=".5"
            strokeWidth="2.5"
          >
            {catalog.spaces
              .filter((s) => s.kind === "sea")
              .map((s) => (
                <Territory
                  key={s.id}
                  space={s}
                  owner={owners[s.id]}
                  selected={selectedID === s.id}
                  routed={routeSet.has(s.id)}
                  highlighted={highlightSet.has(s.id)}
                  focusable={s.id === focusedSpaceID}
                  onChoose={choose}
                />
              ))}
          </g>
          <g stroke="#f0e3b5" strokeOpacity=".72" strokeWidth="2.5">
            {catalog.spaces
              .filter((s) => s.kind === "land")
              .map((s) => (
                <Territory
                  key={s.id}
                  space={s}
                  owner={owners[s.id]}
                  selected={selectedID === s.id}
                  routed={routeSet.has(s.id)}
                  highlighted={highlightSet.has(s.id)}
                  focusable={s.id === focusedSpaceID}
                  onChoose={choose}
                />
              ))}
          </g>
          <g pointerEvents="none">
            {catalog.spaces.map((s) => (
              <MapLabel
                key={s.id}
                space={s}
                count={(stacksBySpace[s.id] || []).reduce(
                  (sum, stack) => sum + stack.count,
                  0,
                )}
                detail={view.width < 2450}
                showCount={!showUnitTypes}
              />
            ))}
          </g>
          {showUnitTypes && (
            <g pointerEvents="none">
              {catalog.spaces.flatMap((space) =>
                (stacksBySpace[space.id] || []).map((stack, index, all) => (
                  <MapUnitStack
                    key={`${space.id}-${stack.owner}-${stack.type}`}
                    space={space}
                    stack={stack}
                    index={index}
                    total={all.length}
                  />
                )),
              )}
            </g>
          )}
          {/* Battle markers sit above the labels so they read at any zoom. */}
          <g pointerEvents="none">
            {battleSpaces.map((id) => {
              const sp = catalog.spaces.find((x) => x.id === id);
              return sp ? <BattleMarker key={id} x={sp.x} y={sp.y} /> : null;
            })}
            {resolvedSpaces.map((id) => {
              const sp = catalog.spaces.find((x) => x.id === id);
              return sp ? <ResolvedBurst key={id} x={sp.x} y={sp.y} /> : null;
            })}
          </g>
          {/* Drawn last so the route sits above labels and unit stacks — it used
              to be painted underneath them and disappeared at the default zoom. */}
          {route.length > 1 && (
            <RoutePath
              points={route.map((id) => {
                const s = catalog.spaces.find((x) => x.id === id);
                return { x: s?.x || 0, y: s?.y || 0 };
              })}
            />
          )}
        </svg>
        <View style={[styles.legend, narrow && styles.legendNarrow]}>
          {Object.entries(powerColors).map(([p, c]) => (
            <Legend
              key={p}
              color={c}
              label={p
                .replace("United ", "U. ")
                .replace("Soviet Union", "Soviet")}
            />
          ))}
        </View>
      </View>
      <View style={[styles.inspector, narrow && styles.inspectorNarrow]}>
        {selected ? (
          <>
            <View style={styles.inspectorTitle}>
              <View
                style={[
                  styles.ownerDot,
                  {
                    backgroundColor:
                      powerColors[owners[selected.id]] ||
                      (selected.kind === "sea" ? "#477a87" : "#b47a3d"),
                  },
                ]}
              />
              <View style={styles.flex}>
                <Text style={styles.spaceName}>{selected.name}</Text>
                <Text style={styles.spaceMeta}>
                  {selected.kind === "sea"
                    ? "SEA ZONE"
                    : selected.impassable
                      ? "IMPASSABLE"
                      : `${owners[selected.id] || "Neutral"}${selected.ipc ? ` · ${selected.ipc} IPC` : ""}`}
                </Text>
                {/* Victory cities decide the game and capitals swing the
                    economy; neither was surfaced anywhere. */}
                {(selected.victoryCity || selected.capital) && (
                  <View style={styles.tagRow}>
                    {selected.victoryCity && (
                      <Text style={[styles.tag, styles.tagVictory]}>
                        ★ VICTORY CITY
                      </Text>
                    )}
                    {selected.capital && (
                      <Text style={[styles.tag, styles.tagCapital]}>
                        CAPITAL
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={[styles.unitList, narrow && styles.unitListNarrow]}>
              {selectedUnits.map((u) => {
                const selectable =
                  canSelectUnits && u.owner === currentPower && !u.transportId;
                return (
                  <Pressable
                    key={u.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: selectedUnitIds.includes(u.id),
                      disabled: !selectable,
                    }}
                    accessibilityLabel={`${u.owner} ${u.type}`}
                    disabled={!selectable}
                    dataSet={{ class: selectable ? "fc-press fc-glow" : undefined }}
                    onPress={() => onToggleUnit?.(u.id)}
                    style={[
                      styles.unitChip,
                      selectedUnitIds.includes(u.id) && styles.unitChipSelected,
                      !selectable && styles.unitChipQuiet,
                    ]}
                  >
                    <View
                      style={[
                        styles.unitOwnerDot,
                        { backgroundColor: powerColors[u.owner] || "#C6B77C" },
                      ]}
                    />
                    {/* Was `{u.owner} · {u.id}` — leaking internal keys like
                        "United States · u0192" straight into the UI. */}
                    <Text style={styles.unitCount}>{u.type}</Text>
                    <Text style={styles.unitName}>
                      {u.damage ? `${u.damage} dmg` : ""}
                    </Text>
                  </Pressable>
                );
              })}
              {!selectedUnits.length && (
                <Text style={styles.empty}>No units in this space</Text>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.empty}>
            Select a territory or sea zone to inspect it.
          </Text>
        )}
      </View>
    </View>
  );
}

// The route used to be a single 12px dashed line in #ffe08a — the same hue as
// the selection stroke — painted under the labels. At the default zoom that is
// ~3.7px on screen and effectively invisible. Now: a dark casing for contrast
// against any terrain, a saturated animated core, an origin dot and an arrowhead.
function RoutePath({ points }: { points: { x: number; y: number }[] }) {
  const d = points.map((p) => `${p.x},${p.y}`).join(" ");
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
  return (
    <g pointerEvents="none">
      <polyline points={d} fill="none" stroke="#08111C" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".75" />
      <polyline points={d} fill="none" stroke={color.cyan} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <polyline
        points={d}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeDasharray="26 44"
        strokeLinecap="round"
        strokeOpacity=".95"
        className="fc-march"
      />
      <circle cx={points[0].x} cy={points[0].y} r="15" fill={color.cyan} stroke="#08111C" strokeWidth="5" />
      <g transform={`translate(${last.x} ${last.y}) rotate(${angle})`}>
        <path d="M -20 -20 L 22 0 L -20 20 Z" fill={color.cyan} stroke="#08111C" strokeWidth="5" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** A live battle: pulsing ring plus a burst, so it reads even zoomed out. */
function BattleMarker({ x, y }: { x: number; y: number }) {
  const spikes = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 === 0 ? 72 : 36;
    spikes.push(`${x + Math.cos(a) * r},${y + Math.sin(a) * r}`);
  }
  return (
    <g className="fc-pulse">
      <circle cx={x} cy={y} r="86" fill="#FF3D81" fillOpacity=".28" />
      <polygon
        points={spikes.join(" ")}
        fill="#FF9F1C"
        stroke="#7F1D2B"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx={x} cy={y} r="20" fill="#FFF3C4" />
    </g>
  );
}
/** A battle that just resolved. */
function ResolvedBurst({ x, y }: { x: number; y: number }) {
  return (
    <g className="fc-burst">
      <circle
        cx={x}
        cy={y}
        r="80"
        fill="none"
        stroke="#FFE14D"
        strokeWidth="14"
        strokeOpacity=".9"
      />
      <circle cx={x} cy={y} r="34" fill="#FF9F1C" fillOpacity=".85" />
    </g>
  );
}

function Territory({
  space,
  owner,
  selected,
  routed,
  highlighted,
  focusable,
  onChoose,
}: {
  space: BoardSpace;
  owner?: string;
  selected: boolean;
  routed: boolean;
  highlighted: boolean;
  /** Roving tabindex: only one territory is ever in the tab order, so reaching
   *  the panels below the map no longer costs 161 Tab presses. */
  focusable: boolean;
  onChoose: (s: BoardSpace) => void;
}) {
  const fill =
    space.kind === "sea"
      ? "url(#seaZone)"
      : space.impassable
        ? "#b8aa7d"
        : powerColors[owner || ""] || "#a86f39";
  // Each state gets its own hue. `routed` used to share #ffe08a with `selected`,
  // and `highlighted` painted an 8px mint outline that shouted louder than the
  // route itself — so the neighbour hint is now a soft fill tint instead.
  const stroke = selected ? "#FFFFFF" : routed ? color.cyan : undefined;
  return (
    <g
      role="button"
      tabIndex={focusable ? 0 : -1}
      aria-label={`Select ${space.name}`}
      data-space-id={space.id}
      onClick={() => onChoose(space)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onChoose(space);
      }}
      style={{ cursor: "pointer", outline: "none" }}
    >
      {space.polygons.map((p, i) => (
        <path
          key={i}
          d={p}
          fill={fill}
          fillOpacity={
            space.kind === "sea" ? 1 : space.impassable ? 0.88 : 0.92
          }
          stroke={stroke}
          strokeOpacity={stroke ? 1 : undefined}
          strokeWidth={stroke ? 9 : undefined}
        />
      ))}
      {highlighted &&
        space.polygons.map((p, i) => (
          <path
            key={`n${i}`}
            d={p}
            fill={color.lime}
            fillOpacity={0.3}
            stroke={color.lime}
            strokeOpacity={0.85}
            strokeWidth={4}
          />
        ))}
      {space.kind === "land" &&
        !space.impassable &&
        space.polygons.map((p, i) => (
          <path key={`h${i}`} d={p} fill="url(#hatch)" stroke="none" />
        ))}
      <circle cx={space.x} cy={space.y} r="30" fill="transparent" />
    </g>
  );
}
function MapLabel({
  space,
  count,
  detail,
  showCount,
}: {
  space: BoardSpace;
  count: number;
  detail: boolean;
  showCount: boolean;
}) {
  const sea = space.name.replace(" Sea Zone", ""),
    label = space.kind === "sea" ? sea : shortName(space.name, detail),
    fontSize =
      space.kind === "sea"
        ? 19
        : label.length > 17
          ? 13
          : label.length > 11
            ? 15
            : 17;
  return (
    <g>
      {space.victoryCity && (
        <circle
          cx={space.x}
          cy={space.y - 25}
          r="11"
          fill="#18231f"
          stroke="#f4c75f"
          strokeWidth="4"
        />
      )}
      <text
        x={space.x}
        y={space.y + (space.ipc && space.kind === "land" ? 1 : 6)}
        textAnchor="middle"
        fill={space.kind === "sea" ? "#d9ecee" : "#fff7dc"}
        fontSize={fontSize}
        fontWeight="700"
        paintOrder="stroke"
        stroke="#172721"
        strokeWidth="5"
      >
        {label}
      </text>
      {!!space.ipc && space.kind === "land" && (
        <text
          x={space.x}
          y={space.y + 20}
          textAnchor="middle"
          fill="#ffe29a"
          fontSize="13"
          fontWeight="800"
          paintOrder="stroke"
          stroke="#283128"
          strokeWidth="4"
        >
          {space.ipc} IPC
        </text>
      )}
      {showCount && count > 0 && (
        <g>
          <rect
            x={space.x + 18}
            y={space.y - 42}
            width="34"
            height="27"
            rx="5"
            fill="#111a16"
            stroke="#f3d17c"
            strokeWidth="3"
          />
          <text
            x={space.x + 35}
            y={space.y - 22}
            textAnchor="middle"
            fill="#fff"
            fontSize="16"
            fontWeight="800"
          >
            {count}
          </text>
        </g>
      )}
    </g>
  );
}

function MapUnitStack({
  space,
  stack,
  index,
  total,
}: {
  space: BoardSpace;
  stack: UnitStack;
  index: number;
  total: number;
}) {
  const columns = Math.min(total, total > 6 ? 4 : 3);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = space.x - ((columns - 1) * 86) / 2 + column * 86;
  // +52, not +34: the old offset put the first row of stacks straight through
  // the "N IPC" line that MapLabel draws at space.y + 20.
  const y = space.y + 52 + row * 38;
  const tint = powerColors[stack.owner] || "#C6B77C";
  return (
    <g transform={`translate(${x} ${y})`}>
      <title>{`${stack.owner}: ${stack.count} ${stack.type}`}</title>
      {/* Owner was previously carried only by the 4px border on a uniformly
          black badge, which was unreadable at a glance. */}
      <rect
        x="-40"
        y="-15"
        width="80"
        height="30"
        rx="8"
        fill="#0B0A1A"
        fillOpacity=".92"
        stroke={tint}
        strokeWidth="4"
      />
      <rect x="-40" y="-15" width="80" height="30" rx="8" fill={tint} fillOpacity=".26" />
      <UnitGlyph type={stack.type} />
      <text
        x="4"
        y="4.5"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="9"
        fontWeight="800"
      >
        {abbreviations[stack.type] || stack.type.slice(0, 3).toUpperCase()}
      </text>
      <text
        x="29"
        y="6"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="17"
        fontWeight="900"
        paintOrder="stroke"
        stroke="#0B0A1A"
        strokeWidth="3"
      >
        {stack.count}
      </text>
    </g>
  );
}

function UnitGlyph({ type }: { type: string }) {
  const common = { fill: "#e9eee9", stroke: "#e9eee9", strokeWidth: 2 };
  switch (type) {
    case "Infantry":
      return (
        <g transform="translate(-27 -1)" {...common}>
          <circle cy="-6" r="4" />
          <path d="M-7 9 L-4 0 0-3 5 0 8 9 M0-2 V9 M-5 3 H5" fill="none" />
        </g>
      );
    case "Artillery":
      return (
        <g transform="translate(-27 1)" {...common}>
          <circle cx="-5" cy="6" r="4" fill="none" />
          <circle cx="6" cy="6" r="4" fill="none" />
          <path d="M-9 2 H8 L15-8 M5 1 L15-8" fill="none" />
        </g>
      );
    case "Tank":
      return (
        <g transform="translate(-27 0)" {...common}>
          <rect x="-11" y="-5" width="22" height="11" rx="4" fill="none" />
          <rect x="-5" y="-9" width="10" height="5" />
          <path d="M4-7 H15" />
        </g>
      );
    case "AAA":
      return (
        <g transform="translate(-27 0)" {...common}>
          <circle cy="6" r="4" fill="none" />
          <path d="M0 2 L-9-9 M0 2 L9-9 M-6-6 H6" fill="none" />
        </g>
      );
    case "Fighter":
      return (
        <path
          d="M-35 5 L-27-11 -20 2 -11 7 -20 8 -24 13 -30 8 -38 8Z"
          {...common}
        />
      );
    case "Bomber":
      return (
        <path
          d="M-39 4 L-29-10 -24 0 -10 5 -10 9 -24 7 -28 13 -33 7 -39 8Z"
          {...common}
        />
      );
    case "Submarine":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-13 3 Q-8-5 8-4 L15 2 Q7 8-13 6Z" fill="none" />
          <path d="M-2-4 V-9 H5 V-4" fill="none" />
        </g>
      );
    case "Transport":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-15 1 H15 L10 9 H-10Z" fill="none" />
          <rect x="-8" y="-7" width="14" height="8" fill="none" />
        </g>
      );
    case "Destroyer":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-15 1 H15 L9 8 H-11Z" fill="none" />
          <path d="M-5 1 V-7 H4 V1 M4-5 H12" fill="none" />
        </g>
      );
    case "Cruiser":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-16 1 H16 L10 9 H-11Z" fill="none" />
          <path d="M-7 1 V-6 H7 V1 M-3-6 V-10 H3 V-6" fill="none" />
        </g>
      );
    case "Aircraft Carrier":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-17 0 H17 L11 8 H-12Z" fill="none" />
          <path d="M-13-5 H13 L17 0 H-17Z M5-5 V-10" fill="none" />
        </g>
      );
    case "Battleship":
      return (
        <g transform="translate(-27 1)" {...common}>
          <path d="M-17 1 H17 L10 9 H-12Z" fill="none" />
          <path d="M-8 1 V-6 H8 V1 M-5-6 H-14 M5-6 H15" fill="none" />
        </g>
      );
    case "Industrial Complex":
      return (
        <g transform="translate(-27 0)" {...common}>
          <path d="M-12 10 V-5 L-5-1 1-5 7-1 V-10 H12 V10Z" fill="none" />
          <path d="M-7 5 H-3 M2 5 H6" />
        </g>
      );
    default:
      return <circle cx="-27" r="8" fill="#e9eee9" />;
  }
}

function shortName(name: string, detail: boolean) {
  const n = name.replace("S.S.R.", "SSR").replace("United States", "US");
  if (detail || n.length <= 18) return n;
  const w = n.split(" ");
  return w.length > 2 ? w.map((x) => x[0]).join("") : n;
}
function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}
function MapButton({
  label,
  title,
  onPress,
}: {
  label: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      dataSet={{ class: "fc-press fc-glow" }}
      onPress={onPress}
      style={styles.mapButton}
    >
      <Text style={styles.mapButtonText}>{label}</Text>
    </Pressable>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: color.bgDeep,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  toolbar: {
    minHeight: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    backgroundColor: color.surface,
  },
  toolbarNarrow: { paddingHorizontal: 12 },
  eyebrow: {
    ...t.label,
    color: color.cyan,
  },
  heading: { ...t.h2, color: color.text },
  headingNarrow: { fontSize: 19, lineHeight: 24 },
  controls: { flexDirection: "row", gap: 6 },
  mapButton: {
    minWidth: 48,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  mapButtonText: { ...t.label, color: color.text },
  // aspectRatio instead of a fixed pixel height: the SVG scales to width, so a
  // hard `height: 620` letterboxed the map against a flat slab at every width
  // below 1440 (53% of the frame at 700px).
  mapWrap: {
    width: "100%",
    aspectRatio: 3500 / 2000,
    maxHeight: 760,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#0A2432",
  },
  mapWrapNarrow: { aspectRatio: 1.05, minHeight: 320, maxHeight: 460 },
  mapHint: {
    position: "absolute",
    zIndex: 2,
    top: 10,
    right: 10,
    backgroundColor: "rgba(11,10,26,.9)",
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  mapHintText: { ...t.micro, fontWeight: "700", color: color.cyan },
  legend: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    backgroundColor: "rgba(11,10,26,.9)",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: "88%",
  },
  legendNarrow: {
    left: 6,
    right: 6,
    bottom: 6,
    gap: 8,
    paddingHorizontal: 8,
    justifyContent: "center",
    maxWidth: undefined,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 10, height: 10, borderRadius: radius.pill },
  legendText: { ...t.micro, color: color.textSoft },
  inspector: {
    padding: 16,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    gap: 12,
  },
  inspectorNarrow: { padding: 12 },
  inspectorTitle: { flexDirection: "row", alignItems: "center", gap: 12 },
  ownerDot: { width: 14, height: 14, borderRadius: radius.pill },
  spaceName: { ...t.h2, color: color.text },
  spaceMeta: { ...t.micro, color: color.textSoft, marginTop: 2 },
  // Left-aligned, not justifyContent:"flex-end" — that left a ~900px hole
  // between the title and the chips and ragged-wrapped past 8 units.
  unitList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  unitListNarrow: {},
  unitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
  },
  unitChipSelected: {
    borderColor: color.cyan,
    backgroundColor: "rgba(34,211,238,.22)",
  },
  unitChipQuiet: { opacity: 0.55 },
  unitCount: { ...t.bodyEm, color: color.text },
  unitName: { ...t.micro, color: color.textSoft },
  unitOwnerDot: { width: 9, height: 9, borderRadius: radius.pill },
  flex: { flex: 1 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tag: {
    ...t.micro,
    fontWeight: "800",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: "hidden",
  },
  tagVictory: { color: "#0B0A1A", backgroundColor: "#FFE14D" },
  tagCapital: { color: color.text, backgroundColor: color.violet },
  empty: { ...t.body, color: color.textDim },
  loading: {
    width: "100%",
    aspectRatio: 3500 / 2000,
    maxHeight: 760,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#0A2432",
  },
  loadingDot: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: "rgba(244,241,255,.18)",
    borderTopColor: color.cyan,
  },
});
