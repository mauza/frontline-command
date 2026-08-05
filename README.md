# Frontline Command

A private, asynchronous multiplayer implementation of Axis & Allies 1942 Second Edition. The current release provides a persistent multiplayer game, interactive movement, deterministic server-authoritative combat, purchases, mobilization, income, and victory checks.

This project is unofficial and is not affiliated with or endorsed by Hasbro, Avalon Hill, or Renegade Game Studios. It includes no official artwork, logos, or copied rulebook text.

## Run with Docker

```sh
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Data persists in the `frontline-data` Docker volume.

To stop without deleting games:

```sh
docker compose down
```

Do not use `docker compose down -v` unless you intend to remove all game data.

## Local Development

Run the API:

```sh
go run ./cmd/server
```

Run the React Native Web client in another terminal:

```sh
cd web
npm install
npm run dev
```

Vite proxies `/api` to port 8080. Production serves the static client from the Go process.

## Rules Baseline

The controlling rules source is the 2023 Renegade 1942 Second Edition rulebook, which integrates earlier errata and FAQ corrections. See [`docs/rules-1942-second-edition.md`](docs/rules-1942-second-edition.md) for pinned sources, important implementation decisions, and differences from Classic.

The intended board is the 1942 Second Edition 40 by 26 inch board with 161 spaces and sea zones 1 through 65. See [`docs/board-1942-second-edition.md`](docs/board-1942-second-edition.md).

## Storage and Lifecycle

- `data/catalog.sqlite` reserves and indexes games.
- `data/games/<id>.sqlite` is the standalone database for one active game.
- At most 50 games may be creating, active, or archiving.
- Games have no inactivity timeout.
- An owner must explicitly mark a game abandoned before archiving it.
- Archiving moves its database to `data/archives` and releases its active slot.
- Browsers list campaigns for which they still hold a valid player token, so players can return without keeping the original tab or URL.
- An owner can permanently delete an active or archived campaign by confirming its exact name. Deletion removes its database and cannot be undone.
- Player access tokens are generated with cryptographic randomness. Only SHA-256 token hashes are stored.

The service is designed for one replica with local persistent storage. Do not run multiple replicas against these SQLite files or place them on network storage. Add HTTPS and proper user accounts before exposing it beyond a trusted local network.

## Rules Coverage

Implemented:

- Official 2-5 player power allocations
- Soviet Union, Germany, United Kingdom, Japan, United States turn order
- Six turn phases
- Starting treasuries and income: 24, 41, 31, 30, and 42
- 1942 Second Edition unit roster, prices, and reference values
- Interactive 161-space strategic map with all 65 sea zones
- Initial ownership, IPC values, victory cities, unit stacks, and 403 adjacency edges
- Map pan, zoom, fit, selection, and territory inspection
- Purchases constrained by treasury and phase ownership
- Income collection and round progression
- Dynamic ownership and interactive land, sea, air, canal, carrier, and transport movement
- Combat movement aircraft-landing feasibility and mandatory noncombat landing validation
- Artillery support, AAA fire, naval bombardment, amphibious assaults, and strategic bombing damage
- Surprise Strike, pre-fire attacker/defender submergence, destroyer air-targeting effects, and owner-authorized multinational decisions
- Two-hit battleships, casualty selection, attacker retreats, dice transcripts, and combat persistence
- Defending-fighter one-space landing or destruction after carrier loss
- Factory production/damage/repair, mobilization capacity, refunds, capture/liberation, and victory-city checks

The current core-rule audit against `docs/rules-1942-second-edition.md` has no open gaps. This includes destroyer-dependent submarine traversal, stationary transport bridging, explicit submarine/transport ignore choices, automatic destruction of defenseless transports, aircraft retreat handling, deterministic owner-authorized multinational decisions, and non-greedy allocation of sea-unit production across adjacent factories.

Optional strategic-bombing escorts/interceptors and optional Total Victory are disabled. They are not offered by the API or UI; standard victory (9 Axis or 10 Allied victory cities) remains the default.

1942 Second Edition has no technology-research phase and does not use Classic's neutral-violation, component-limit, capital-victory, or Axis economic-victory rules.

## Verification

```sh
go test -race ./...
go vet ./...
cd web && npm run typecheck && npm run build
docker compose build
```
