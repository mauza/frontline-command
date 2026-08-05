package main

import (
	cryptorand "crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/mauza/axis-and-allies/internal/board"
	gameengine "github.com/mauza/axis-and-allies/internal/game"
)

const maxActiveGames = 50

type unitSpec struct {
	Cost, Move, Attack, Defense int
}

var units = map[string]unitSpec{
	"Infantry":           {3, 1, 1, 2},
	"Artillery":          {4, 1, 2, 2},
	"Tank":               {6, 2, 3, 3},
	"AAA":                {5, 1, 0, 0},
	"Fighter":            {10, 4, 3, 4},
	"Bomber":             {12, 6, 4, 1},
	"Submarine":          {6, 2, 2, 1},
	"Transport":          {7, 2, 0, 0},
	"Destroyer":          {8, 2, 2, 2},
	"Cruiser":            {12, 2, 3, 3},
	"Aircraft Carrier":   {14, 2, 1, 2},
	"Battleship":         {20, 2, 4, 4},
	"Industrial Complex": {15, 0, 0, 0},
}

type app struct {
	dataDir   string
	catalog   *sql.DB
	lifecycle sync.RWMutex
}

type player struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Powers  []string `json:"powers"`
	IsOwner bool     `json:"isOwner"`
}

type gameState struct {
	Status       string                               `json:"status"`
	Round        int                                  `json:"round"`
	PowerIndex   int                                  `json:"powerIndex"`
	PhaseIndex   int                                  `json:"phaseIndex"`
	IPCs         map[string]int                       `json:"ipcs"`
	Income       map[string]int                       `json:"income"`
	Purchases    map[string]map[string]int            `json:"purchases"`
	Winner       string                               `json:"winner,omitempty"`
	RulesVersion string                               `json:"rulesVersion"`
	World        *gameengine.State                    `json:"world,omitempty"`
	Battles      map[string]gameengine.BattleSnapshot `json:"battles,omitempty"`
}

type gameView struct {
	ID               string                                     `json:"id"`
	Name             string                                     `json:"name"`
	JoinCode         string                                     `json:"joinCode,omitempty"`
	Version          int64                                      `json:"version"`
	State            gameState                                  `json:"state"`
	Players          []player                                   `json:"players"`
	Me               *player                                    `json:"me,omitempty"`
	Units            map[string]unitSpec                        `json:"units"`
	Power            string                                     `json:"currentPower"`
	Phase            string                                     `json:"currentPhase"`
	UpdatedAt        string                                     `json:"updatedAt"`
	Events           []event                                    `json:"events"`
	Owners           map[string]gameengine.Power                `json:"owners"`
	WorldUnits       map[string]*gameengine.Unit                `json:"worldUnits"`
	Powers           map[gameengine.Power]gameengine.PowerState `json:"powers"`
	Purchased        []gameengine.UnitType                      `json:"purchased,omitempty"`
	PendingDecisions map[string]*gameengine.PendingDecision     `json:"pendingDecisions"`
	Battles          map[string]gameengine.BattleSnapshot       `json:"battles"`
}

type event struct {
	Sequence int64  `json:"sequence"`
	Kind     string `json:"kind"`
	Message  string `json:"message"`
	At       string `json:"at"`
}

func main() {
	dataDir := env("DATA_DIR", "./data")
	if err := os.MkdirAll(filepath.Join(dataDir, "games"), 0o750); err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "archives"), 0o750); err != nil {
		panic(err)
	}
	catalog, err := openDB(filepath.Join(dataDir, "catalog.sqlite"))
	if err != nil {
		panic(err)
	}
	if _, err := catalog.Exec(`CREATE TABLE IF NOT EXISTS games (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT NOT NULL UNIQUE,
		status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	)`); err != nil {
		panic(err)
	}
	if err := reconcileCatalog(dataDir, catalog); err != nil {
		panic(err)
	}
	a := &app{dataDir: dataDir, catalog: catalog}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/board", a.board)
	mux.HandleFunc("GET /api/games", a.listGames)
	mux.HandleFunc("POST /api/games", a.createGame)
	mux.HandleFunc("POST /api/games/join", a.joinGame)
	mux.HandleFunc("GET /api/games/{id}", a.getGame)
	mux.HandleFunc("GET /api/games/{id}/summary", a.gameSummary)
	mux.HandleFunc("DELETE /api/games/{id}", a.deleteGame)
	mux.HandleFunc("POST /api/games/{id}/commands", a.command)
	mux.HandleFunc("POST /api/games/{id}/archive", a.archiveGame)
	webDir := env("WEB_DIR", "./web/dist")
	mux.Handle("/", spaHandler(webDir))
	server := &http.Server{Addr: env("ADDR", ":8080"), Handler: securityHeaders(requestLogger(mux)), ReadHeaderTimeout: 5 * time.Second}
	slog.Info("server listening", "address", server.Addr, "data", dataDir)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "file:"+path+"?_foreign_keys=on&_busy_timeout=5000&_journal_mode=DELETE&_synchronous=FULL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func reconcileCatalog(dataDir string, catalog *sql.DB) error {
	rows, err := catalog.Query(`SELECT id,status FROM games WHERE status IN ('creating','archiving','deleting')`)
	if err != nil {
		return err
	}
	type pendingGame struct{ id, status string }
	var pending []pendingGame
	for rows.Next() {
		var game pendingGame
		if err := rows.Scan(&game.id, &game.status); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, game)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, game := range pending {
		activePath := filepath.Join(dataDir, "games", game.id+".sqlite")
		archivePath := filepath.Join(dataDir, "archives", game.id+".sqlite")
		if game.status == "deleting" {
			if err := removeGameFiles(dataDir, game.id); err != nil {
				return err
			}
			if _, err := catalog.Exec(`DELETE FROM games WHERE id=?`, game.id); err != nil {
				return err
			}
			continue
		}
		if game.status == "creating" {
			if gameFileReady(activePath) {
				if _, err := catalog.Exec(`UPDATE games SET status='active' WHERE id=?`, game.id); err != nil {
					return err
				}
				continue
			}
			if err := os.Remove(activePath); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if _, err := catalog.Exec(`DELETE FROM games WHERE id=?`, game.id); err != nil {
				return err
			}
			continue
		}
		if _, err := os.Stat(archivePath); err == nil {
			if _, err := catalog.Exec(`UPDATE games SET status='archived' WHERE id=?`, game.id); err != nil {
				return err
			}
		} else if gameFileReady(activePath) {
			if _, err := catalog.Exec(`UPDATE games SET status='active' WHERE id=?`, game.id); err != nil {
				return err
			}
		} else if _, err := catalog.Exec(`DELETE FROM games WHERE id=?`, game.id); err != nil {
			return err
		}
	}
	return nil
}

func gameFileReady(path string) bool {
	if _, err := os.Stat(path); err != nil {
		return false
	}
	db, err := openDB(path)
	if err != nil {
		return false
	}
	defer db.Close()
	var count int
	return db.QueryRow(`SELECT COUNT(*) FROM state WHERE singleton=1`).Scan(&count) == nil && count == 1
}

func (a *app) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (a *app) board(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(board.CatalogJSON)
}

func (a *app) listGames(w http.ResponseWriter, r *http.Request) {
	rows, err := a.catalog.QueryContext(r.Context(), `SELECT id,name,status,updated_at FROM games WHERE status='active' ORDER BY updated_at DESC`)
	if err != nil {
		problem(w, 500, "could not list games")
		return
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var id, name, status, updated string
		if rows.Scan(&id, &name, &status, &updated) == nil {
			result = append(result, map[string]any{"id": id, "name": name, "status": status, "updatedAt": updated})
		}
	}
	writeJSON(w, 200, result)
}

func (a *app) createGame(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	var in struct {
		Name       string `json:"name"`
		PlayerName string `json:"playerName"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name, in.PlayerName = strings.TrimSpace(in.Name), strings.TrimSpace(in.PlayerName)
	if len(in.Name) < 3 || len(in.Name) > 60 || len(in.PlayerName) < 2 || len(in.PlayerName) > 30 {
		problem(w, 400, "use a 3-60 character game name and 2-30 character player name")
		return
	}
	tx, err := a.catalog.BeginTx(r.Context(), nil)
	if err != nil {
		problem(w, 500, "could not reserve game")
		return
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM games WHERE status IN ('creating','active','archiving')`).Scan(&count); err != nil || count >= maxActiveGames {
		if count >= maxActiveGames {
			problem(w, 409, fmt.Sprintf("the %d active game limit has been reached", maxActiveGames))
		} else {
			problem(w, 500, "could not reserve game")
		}
		return
	}
	id, code, token, playerID := randomID(12), strings.ToUpper(randomID(4)[:6]), randomID(32), randomID(12)
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err = tx.Exec(`INSERT INTO games(id,name,join_code,status,created_at,updated_at) VALUES(?,?,?,'creating',?,?)`, id, in.Name, code, now, now); err != nil {
		problem(w, 500, "could not reserve game")
		return
	}
	if err = tx.Commit(); err != nil {
		problem(w, 500, "could not reserve game")
		return
	}
	db, err := a.initializeGame(id, in.Name, code, playerID, in.PlayerName, token)
	if err != nil {
		a.catalog.Exec(`DELETE FROM games WHERE id=?`, id)
		problem(w, 500, "could not initialize game")
		return
	}
	db.Close()
	if _, err := a.catalog.Exec(`UPDATE games SET status='active',updated_at=? WHERE id=?`, now, id); err != nil {
		problem(w, 500, "could not activate game")
		return
	}
	writeJSON(w, 201, map[string]string{"id": id, "token": token, "joinCode": code})
}

func (a *app) initializeGame(id, name, code, playerID, playerName, token string) (*sql.DB, error) {
	path := filepath.Join(a.dataDir, "games", id+".sqlite")
	db, err := openDB(path)
	if err != nil {
		return nil, err
	}
	schema := `CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
	CREATE TABLE players(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,is_owner INTEGER NOT NULL,powers_json TEXT NOT NULL DEFAULT '[]',joined_at TEXT NOT NULL);
	CREATE TABLE state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);
	CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
	CREATE TABLE commands(id TEXT PRIMARY KEY,response_json TEXT NOT NULL,created_at TEXT NOT NULL);`
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		os.Remove(path)
		return nil, err
	}
	state := initialState()
	raw, _ := json.Marshal(state)
	now := time.Now().UTC().Format(time.RFC3339)
	tx, _ := db.Begin()
	defer tx.Rollback()
	for k, v := range map[string]string{"id": id, "name": name, "join_code": code} {
		if _, err = tx.Exec(`INSERT INTO metadata VALUES(?,?)`, k, v); err != nil {
			return nil, err
		}
	}
	if _, err = tx.Exec(`INSERT INTO players VALUES(?,?,?,?,?,?)`, playerID, playerName, hashToken(token), 1, "[]", now); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(`INSERT INTO state VALUES(1,1,?,?)`, raw, now); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(`INSERT INTO events(kind,message,created_at) VALUES('game_created',?,?)`, playerName+" created the game", now); err != nil {
		return nil, err
	}
	return db, tx.Commit()
}

func initialState() gameState {
	startingIncome := map[string]int{"Soviet Union": 24, "Germany": 41, "United Kingdom": 31, "Japan": 30, "United States": 42}
	world, err := gameengine.NewStandardGame()
	if err != nil {
		panic(err)
	}
	return gameState{
		Status:       "lobby",
		Round:        1,
		IPCs:         cloneInts(startingIncome),
		Income:       cloneInts(startingIncome),
		Purchases:    map[string]map[string]int{},
		RulesVersion: "1942 Second Edition (2023 integrated rules)",
		World:        world,
		Battles:      map[string]gameengine.BattleSnapshot{},
	}
}

func cloneInts(source map[string]int) map[string]int {
	result := make(map[string]int, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func (a *app) joinGame(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	var in struct {
		Code       string `json:"code"`
		PlayerName string `json:"playerName"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.PlayerName = strings.TrimSpace(in.PlayerName)
	var id string
	if err := a.catalog.QueryRowContext(r.Context(), `SELECT id FROM games WHERE join_code=? AND status='active'`, in.Code).Scan(&id); err != nil {
		problem(w, 404, "game not found")
		return
	}
	db, err := a.gameDB(id)
	if err != nil {
		problem(w, 500, "could not open game")
		return
	}
	defer db.Close()
	var status string
	if err = db.QueryRow(`SELECT json_extract(state_json,'$.status') FROM state WHERE singleton=1`).Scan(&status); err != nil || status != "lobby" {
		problem(w, 409, "game has already started")
		return
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM players`).Scan(&count)
	if count >= 5 {
		problem(w, 409, "game is full")
		return
	}
	if len(in.PlayerName) < 2 || len(in.PlayerName) > 30 {
		problem(w, 400, "player name must be 2-30 characters")
		return
	}
	idp, token, now := randomID(12), randomID(32), time.Now().UTC().Format(time.RFC3339)
	if _, err = db.Exec(`INSERT INTO players VALUES(?,?,?,?,?,?)`, idp, in.PlayerName, hashToken(token), 0, "[]", now); err != nil {
		problem(w, 500, "could not join game")
		return
	}
	db.Exec(`INSERT INTO events(kind,message,created_at) VALUES('player_joined',?,?)`, in.PlayerName+" joined the game", now)
	a.touch(id)
	writeJSON(w, 201, map[string]string{"id": id, "token": token})
}

func (a *app) getGame(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	id := r.PathValue("id")
	db, err := a.gameDB(id)
	if err != nil {
		problem(w, 404, "game not found")
		return
	}
	defer db.Close()
	me, err := authenticate(db, r)
	if err != nil {
		problem(w, 401, "valid game token required")
		return
	}
	view, err := loadView(db, id, me)
	if err != nil {
		problem(w, 500, "could not load game")
		return
	}
	writeJSON(w, 200, view)
}

func (a *app) gameSummary(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	id := r.PathValue("id")
	db, err := a.gameDB(id)
	if err != nil {
		problem(w, 404, "game not found")
		return
	}
	defer db.Close()
	me, err := authenticate(db, r)
	if err != nil {
		problem(w, 401, "valid game token required")
		return
	}
	var name, status, updated string
	var round int
	if err := db.QueryRow(`SELECT (SELECT value FROM metadata WHERE key='name'),json_extract(state_json,'$.status'),json_extract(state_json,'$.round'),updated_at FROM state WHERE singleton=1`).Scan(&name, &status, &round, &updated); err != nil {
		problem(w, 500, "could not load game summary")
		return
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "name": name, "status": status, "round": round,
		"updatedAt": updated, "playerName": me.Name, "isOwner": me.IsOwner,
	})
}

func loadView(db *sql.DB, id string, me *player) (gameView, error) {
	var v gameView
	v.ID = id
	v.Me = me
	v.Units = units
	if err := db.QueryRow(`SELECT (SELECT value FROM metadata WHERE key='name'),(SELECT value FROM metadata WHERE key='join_code'),version,state_json,updated_at FROM state WHERE singleton=1`).Scan(&v.Name, &v.JoinCode, &v.Version, newJSONScanner(&v.State), &v.UpdatedAt); err != nil {
		return v, err
	}
	if err := ensureWorld(&v.State); err != nil {
		return v, err
	}
	rows, err := db.Query(`SELECT id,name,is_owner,powers_json FROM players ORDER BY joined_at`)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var p player
		var owner int
		var raw string
		if err = rows.Scan(&p.ID, &p.Name, &owner, &raw); err != nil {
			return v, err
		}
		p.IsOwner = owner == 1
		json.Unmarshal([]byte(raw), &p.Powers)
		v.Players = append(v.Players, p)
		if me != nil && p.ID == me.ID {
			copy := p
			v.Me = &copy
		}
	}
	erows, err := db.Query(`SELECT sequence,kind,message,created_at FROM events ORDER BY sequence DESC LIMIT 30`)
	if err != nil {
		return v, err
	}
	defer erows.Close()
	for erows.Next() {
		var e event
		if erows.Scan(&e.Sequence, &e.Kind, &e.Message, &e.At) == nil {
			v.Events = append(v.Events, e)
		}
	}
	v.Power = string(v.State.World.CurrentPower())
	v.Phase = legacyPhaseName(v.State.World.Phase)
	v.Owners = v.State.World.Owners
	v.WorldUnits = v.State.World.Units
	v.Powers = v.State.World.Powers
	v.Purchased = v.State.World.Purchased
	v.Battles = v.State.Battles
	v.PendingDecisions = map[string]*gameengine.PendingDecision{}
	for territory, battle := range v.State.Battles {
		if !battle.Complete && battle.Pending != nil {
			v.PendingDecisions[territory] = battle.Pending
		}
	}
	return v, nil
}

func legacyPhaseName(phase gameengine.Phase) string {
	switch phase {
	case gameengine.Purchase:
		return "Purchase"
	case gameengine.CombatMove:
		return "Combat Move"
	case gameengine.ConductCombat:
		return "Resolve Combat"
	case gameengine.NoncombatMove:
		return "Noncombat Move"
	case gameengine.Mobilize:
		return "Place Units"
	case gameengine.CollectIncome:
		return "Collect Income"
	default:
		return string(phase)
	}
}

type jsonScanner struct{ target any }

func newJSONScanner(target any) *jsonScanner { return &jsonScanner{target} }
func (s *jsonScanner) Scan(src any) error {
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return fmt.Errorf("invalid json value")
	}
	return json.Unmarshal(b, s.target)
}

func (a *app) command(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	id := r.PathValue("id")
	db, err := a.gameDB(id)
	if err != nil {
		problem(w, 404, "game not found")
		return
	}
	defer db.Close()
	me, err := authenticate(db, r)
	if err != nil {
		problem(w, 401, "valid game token required")
		return
	}
	var in struct {
		CommandID       string          `json:"commandId"`
		ExpectedVersion int64           `json:"expectedVersion"`
		Type            string          `json:"type"`
		Payload         json.RawMessage `json:"payload"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.CommandID == "" {
		problem(w, 400, "commandId is required")
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		problem(w, 500, "could not begin command")
		return
	}
	defer tx.Rollback()
	var cached string
	if tx.QueryRow(`SELECT response_json FROM commands WHERE id=?`, in.CommandID).Scan(&cached) == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(cached))
		return
	}
	var version int64
	var state gameState
	if err = tx.QueryRow(`SELECT version,state_json FROM state WHERE singleton=1`).Scan(&version, newJSONScanner(&state)); err != nil {
		problem(w, 500, "could not load state")
		return
	}
	if version != in.ExpectedVersion {
		problem(w, 409, "state changed; refresh and try again")
		return
	}
	if err = ensureWorld(&state); err != nil {
		problem(w, 500, "could not migrate game state")
		return
	}
	message, err := applyCommand(tx, me, &state, in.Type, in.Payload)
	if err != nil {
		problem(w, 422, err.Error())
		return
	}
	syncLegacyState(&state)
	version++
	now := time.Now().UTC().Format(time.RFC3339)
	raw, _ := json.Marshal(state)
	if _, err = tx.Exec(`UPDATE state SET version=?,state_json=?,updated_at=? WHERE singleton=1`, version, raw, now); err != nil {
		problem(w, 500, "could not save command")
		return
	}
	if _, err = tx.Exec(`INSERT INTO events(kind,message,created_at) VALUES(?,?,?)`, in.Type, message, now); err != nil {
		problem(w, 500, "could not save event")
		return
	}
	response, _ := json.Marshal(map[string]any{"version": version, "message": message})
	if _, err = tx.Exec(`INSERT INTO commands VALUES(?,?,?)`, in.CommandID, response, now); err != nil {
		problem(w, 500, "could not save command")
		return
	}
	if err = tx.Commit(); err != nil {
		problem(w, 500, "could not commit command")
		return
	}
	a.touch(id)
	writeJSON(w, 200, map[string]any{"version": version, "message": message})
}

func applyCommand(tx *sql.Tx, me *player, state *gameState, kind string, payload json.RawMessage) (string, error) {
	if err := ensureWorld(state); err != nil {
		return "", err
	}
	world := state.World
	switch kind {
	case "start_game":
		if !me.IsOwner {
			return "", errors.New("only the game owner can start")
		}
		if state.Status != "lobby" {
			return "", errors.New("game has already started")
		}
		rows, err := tx.Query(`SELECT id,name FROM players ORDER BY joined_at`)
		if err != nil {
			return "", err
		}
		defer rows.Close()
		var ids, names []string
		for rows.Next() {
			var id, name string
			rows.Scan(&id, &name)
			ids = append(ids, id)
			names = append(names, name)
		}
		if len(ids) < 2 {
			return "", errors.New("at least two players are required")
		}
		assign := powerAssignments(len(ids))
		for i, id := range ids {
			raw, _ := json.Marshal(assign[i])
			if _, err = tx.Exec(`UPDATE players SET powers_json=? WHERE id=?`, raw, id); err != nil {
				return "", err
			}
		}
		state.Status = "active"
		syncLegacyState(state)
		return names[0] + " started round 1", nil
	case "purchase":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		var p struct {
			Unit     string                      `json:"unit"`
			Quantity int                         `json:"quantity"`
			Units    map[gameengine.UnitType]int `json:"units"`
			Repairs  map[string]int              `json:"repairs"`
		}
		if json.Unmarshal(payload, &p) != nil {
			return "", errors.New("invalid purchase")
		}
		order := gameengine.PurchaseOrder{Units: p.Units, Repairs: p.Repairs}
		if p.Unit != "" || p.Quantity != 0 {
			if p.Quantity < 1 || p.Quantity > 20 || len(p.Units) != 0 || len(p.Repairs) != 0 {
				return "", errors.New("invalid purchase")
			}
			order.Units = map[gameengine.UnitType]int{gameengine.UnitType(p.Unit): p.Quantity}
		}
		if len(order.Units) == 0 && len(order.Repairs) == 0 {
			return "", errors.New("purchase plan is empty")
		}
		before := world.Powers[world.CurrentPower()].IPC
		if err := world.Purchase(order); err != nil {
			return "", err
		}
		spent := before - world.Powers[world.CurrentPower()].IPC
		syncLegacyState(state)
		return fmt.Sprintf("%s submitted a purchase plan for %d IPCs", world.CurrentPower(), spent), nil
	case "move", "movement_plan":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		var plan gameengine.MovementPlan
		if err := json.Unmarshal(payload, &plan); err != nil {
			return "", errors.New("invalid movement plan")
		}
		if err := world.Move(plan); err != nil {
			return "", err
		}
		return fmt.Sprintf("%s moved %d units", world.CurrentPower(), len(plan.Moves)), nil
	case "place", "placements":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		var in struct {
			Placements []gameengine.Placement `json:"placements"`
		}
		if err := json.Unmarshal(payload, &in); err != nil {
			return "", errors.New("invalid placements")
		}
		if in.Placements == nil && json.Unmarshal(payload, &in.Placements) != nil {
			return "", errors.New("invalid placements")
		}
		if err := world.Place(in.Placements); err != nil {
			return "", err
		}
		syncLegacyState(state)
		return fmt.Sprintf("%s placed new units", world.CurrentPower()), nil
	case "advance_phase", "complete_phase":
		return completePhase(me, state)
	case "collect_income":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		if world.Phase != gameengine.CollectIncome {
			return "", errors.New("command is not valid in this phase")
		}
		power, income := world.CurrentPower(), world.Income(world.CurrentPower())
		if err := world.Collect(); err != nil {
			return "", err
		}
		syncLegacyState(state)
		return fmt.Sprintf("%s collected %d IPCs", power, income), nil
	case "start_battle":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		var in struct {
			Territory  string   `json:"territory"`
			Bombarders []string `json:"bombarders"`
		}
		if json.Unmarshal(payload, &in) != nil {
			return "", errors.New("invalid battle")
		}
		if world.Phase != gameengine.ConductCombat {
			return "", errors.New("battles can only be started during conduct combat")
		}
		existing, ok := state.Battles[in.Territory]
		if !ok {
			return "", errors.New("battle was not declared during combat movement")
		}
		if existing.Complete || existing.Started || existing.Round != 0 || existing.Pending != nil || existing.Stage != "aaa" {
			return "", errors.New("battle has already started")
		}
		battle, err := gameengine.RestoreBattle(world, existing, randomDice{})
		if err != nil {
			return "", err
		}
		if err := battle.Start(in.Bombarders); err != nil {
			return "", err
		}
		state.Battles[in.Territory] = battle.Snapshot()
		return fmt.Sprintf("%s started battle in %s", world.CurrentPower(), in.Territory), nil
	case "battle_step":
		var in struct {
			Territory string `json:"territory"`
		}
		if json.Unmarshal(payload, &in) != nil || !state.Battles[in.Territory].Started {
			return "", errors.New("battle must be started before it can advance")
		}
		battle, territory, err := loadBattleCommand(me, state, payload, false)
		if err != nil {
			return "", err
		}
		if err = battle.Step(); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("battle in %s advanced", territory), nil
	case "choose_casualties":
		battle, territory, ids, err := loadBattleIDsCommand(me, state, payload)
		if err != nil {
			return "", err
		}
		if err = battle.ChooseCasualties(ids); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("casualties assigned in %s", territory), nil
	case "submerge":
		battle, territory, ids, err := loadBattleIDsCommand(me, state, payload)
		if err != nil {
			return "", err
		}
		if err = battle.Submerge(ids); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("submarine decision completed in %s", territory), nil
	case "land_fighter":
		battle, territory, err := loadBattleCommand(me, state, payload, true)
		if err != nil {
			return "", err
		}
		var in struct {
			UnitID      string `json:"unitId"`
			Destination string `json:"destination"`
		}
		if json.Unmarshal(payload, &in) != nil || in.UnitID == "" {
			return "", errors.New("invalid fighter landing decision")
		}
		fighter := state.World.Units[in.UnitID]
		if fighter == nil || !playerControls(me, fighter.Owner) {
			return "", fmt.Errorf("player does not control fighter %s", in.UnitID)
		}
		if err = battle.LandFighter(in.UnitID, in.Destination); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("fighter landing resolved in %s", territory), nil
	case "retreat":
		battle, territory, err := loadBattleCommand(me, state, payload, true)
		if err != nil {
			return "", err
		}
		var in struct {
			Destination string `json:"destination"`
		}
		_ = json.Unmarshal(payload, &in)
		if err = battle.Retreat(in.Destination); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("attackers retreated from %s", territory), nil
	case "continue_battle":
		battle, territory, err := loadBattleCommand(me, state, payload, true)
		if err != nil {
			return "", err
		}
		if err = battle.Continue(); err != nil {
			return "", err
		}
		state.Battles[territory] = battle.Snapshot()
		return fmt.Sprintf("battle in %s continues", territory), nil
	case "strategic_bomb":
		if err := requireEngineTurn(me, state); err != nil {
			return "", err
		}
		var in struct {
			Target    string   `json:"target"`
			BomberIDs []string `json:"bomberIds"`
		}
		if json.Unmarshal(payload, &in) != nil {
			return "", errors.New("invalid strategic bombing raid")
		}
		damage, err := world.StrategicBomb(in.Target, in.BomberIDs, randomDice{})
		if err != nil {
			return "", err
		}
		contested := false
		for _, territory := range world.BattleTerritories(world.CurrentPower()) {
			contested = contested || territory == in.Target
		}
		if !contested {
			if battle, ok := state.Battles[in.Target]; ok && battle.Round == 0 && battle.Pending == nil {
				battle.Complete = true
				state.Battles[in.Target] = battle
			}
		}
		return fmt.Sprintf("strategic bombing caused %d damage", damage), nil
	case "concede_game":
		if state.Status != "active" {
			return "", errors.New("game is not active")
		}
		winner, ok := concessionWinner(me.Powers)
		if !ok {
			return "", errors.New("only a player controlling an entire alliance can concede")
		}
		world.Winner = winner
		state.Winner = string(winner)
		state.Status = "finished"
		return fmt.Sprintf("%s conceded; %s wins", oppositeAlliance(winner), winner), nil
	case "abandon_game":
		if !me.IsOwner {
			return "", errors.New("only the owner can abandon the game")
		}
		state.Status = "abandoned"
		return me.Name + " marked the game abandoned", nil
	default:
		return "", errors.New("unsupported command")
	}
}

func concessionWinner(powers []string) (gameengine.Alliance, bool) {
	controlled := map[string]bool{}
	for _, power := range powers {
		controlled[power] = true
	}
	if controlsAll(controlled, []string{"Soviet Union", "United Kingdom", "United States"}) {
		return gameengine.Axis, true
	}
	if controlsAll(controlled, []string{"Germany", "Japan"}) {
		return gameengine.Allies, true
	}
	return "", false
}

func controlsAll(controlled map[string]bool, powers []string) bool {
	for _, power := range powers {
		if !controlled[power] {
			return false
		}
	}
	return true
}

func oppositeAlliance(alliance gameengine.Alliance) gameengine.Alliance {
	if alliance == gameengine.Axis {
		return gameengine.Allies
	}
	return gameengine.Axis
}

func ensureWorld(state *gameState) error {
	if state.World != nil {
		if state.Battles == nil {
			state.Battles = map[string]gameengine.BattleSnapshot{}
		}
		return nil
	}
	world, err := gameengine.NewStandardGame()
	if err != nil {
		return err
	}
	if state.Round > 0 {
		world.Round = state.Round
	}
	if state.PowerIndex >= 0 && state.PowerIndex < len(gameengine.TurnOrder) {
		world.Turn = state.PowerIndex
	}
	if state.PhaseIndex >= 0 && state.PhaseIndex < len(gameengine.PhaseOrder) {
		world.Phase = gameengine.PhaseOrder[state.PhaseIndex]
	}
	for power, amount := range state.IPCs {
		p := gameengine.Power(power)
		ps, ok := world.Powers[p]
		if ok {
			ps.IPC = amount
			world.Powers[p] = ps
		}
	}
	world.RefreshTurnSnapshot()
	state.World = world
	state.Battles = map[string]gameengine.BattleSnapshot{}
	syncLegacyState(state)
	return nil
}

func syncLegacyState(state *gameState) {
	if state.World == nil {
		return
	}
	world := state.World
	state.Round = world.Round
	state.PowerIndex = world.Turn
	state.PhaseIndex = 0
	for i, phase := range gameengine.PhaseOrder {
		if world.Phase == phase {
			state.PhaseIndex = i
			break
		}
	}
	state.IPCs = map[string]int{}
	state.Income = map[string]int{}
	state.Purchases = map[string]map[string]int{}
	for _, power := range gameengine.TurnOrder {
		name := string(power)
		state.IPCs[name] = world.Powers[power].IPC
		state.Income[name] = world.Income(power)
	}
	if len(world.Purchased) > 0 {
		name := string(world.CurrentPower())
		state.Purchases[name] = map[string]int{}
		for _, unitType := range world.Purchased {
			state.Purchases[name][string(unitType)]++
		}
	}
	state.Winner = string(world.Winner)
	if world.Winner != "" {
		state.Status = "finished"
	}
}

func requireEngineTurn(me *player, state *gameState) error {
	if state.Status != "active" {
		return errors.New("game is not active")
	}
	power := state.World.CurrentPower()
	if playerControls(me, power) {
		return nil
	}
	return fmt.Errorf("it is %s's turn", power)
}

func playerControls(me *player, power gameengine.Power) bool {
	for _, assigned := range me.Powers {
		if assigned == string(power) {
			return true
		}
	}
	return false
}

func completePhase(me *player, state *gameState) (string, error) {
	if err := requireEngineTurn(me, state); err != nil {
		return "", err
	}
	world := state.World
	power, phase := world.CurrentPower(), world.Phase
	if phase == gameengine.ConductCombat {
		for _, territory := range world.BattleTerritories(power) {
			if _, ok := state.Battles[territory]; !ok {
				return "", fmt.Errorf("battle in %s was not declared", territory)
			}
		}
		for territory, battle := range state.Battles {
			if !battle.Complete {
				return "", fmt.Errorf("battle in %s is unresolved", territory)
			}
		}
	}
	refund := 0
	if phase == gameengine.Mobilize {
		refund = world.RefundUnplaced()
	}
	if phase == gameengine.CollectIncome {
		income := world.Income(power)
		if err := world.Collect(); err != nil {
			return "", err
		}
		syncLegacyState(state)
		return fmt.Sprintf("%s collected %d IPCs; %s begins %s", power, income, world.CurrentPower(), world.Phase), nil
	}
	if err := world.AdvancePhase(); err != nil {
		return "", err
	}
	if phase == gameengine.CombatMove {
		state.Battles = map[string]gameengine.BattleSnapshot{}
		for _, territory := range world.BattleTerritories(power) {
			battle, err := gameengine.NewBattle(world, territory, power, randomDice{})
			if err != nil {
				return "", err
			}
			state.Battles[territory] = battle.Snapshot()
		}
	}
	syncLegacyState(state)
	if refund > 0 {
		return fmt.Sprintf("%s completed %s and received a %d IPC refund", power, phase, refund), nil
	}
	return fmt.Sprintf("%s completed %s", power, phase), nil
}

func loadBattleCommand(me *player, state *gameState, payload json.RawMessage, decision bool) (*gameengine.Battle, string, error) {
	var in struct {
		Territory string `json:"territory"`
	}
	if json.Unmarshal(payload, &in) != nil || in.Territory == "" {
		return nil, "", errors.New("battle territory is required")
	}
	snapshot, ok := state.Battles[in.Territory]
	if !ok || snapshot.Complete {
		return nil, "", errors.New("battle is not active")
	}
	if state.World.Board.Spaces[in.Territory].Kind == "land" {
		for _, unit := range state.World.UnitsAt(in.Territory) {
			if unit.Owner != snapshot.Attacker || unit.AssaultFrom == "" {
				continue
			}
			transport := state.World.Units[unit.AssaultFrom]
			if transport == nil {
				return nil, "", errors.New("amphibious assault transport was destroyed")
			}
			if seaBattle, exists := state.Battles[transport.Space]; exists && !seaBattle.Complete {
				return nil, "", fmt.Errorf("sea battle in %s must be resolved before amphibious assault", transport.Space)
			}
		}
	}
	if decision && snapshot.Pending != nil {
		if snapshot.Pending.Power != "" && !playerControls(me, snapshot.Pending.Power) {
			return nil, "", fmt.Errorf("decision belongs to %s", snapshot.Pending.Power)
		}
	} else if err := requireEngineTurn(me, state); err != nil {
		return nil, "", err
	}
	battle, err := gameengine.RestoreBattle(state.World, snapshot, randomDice{})
	return battle, in.Territory, err
}

func loadBattleIDsCommand(me *player, state *gameState, payload json.RawMessage) (*gameengine.Battle, string, []string, error) {
	var in struct {
		Territory string   `json:"territory"`
		UnitIDs   []string `json:"unitIds"`
	}
	if json.Unmarshal(payload, &in) != nil {
		return nil, "", nil, errors.New("invalid battle decision")
	}
	battle, territory, err := loadBattleCommand(me, state, payload, true)
	if err == nil && battle.Pending != nil && battle.Pending.Power == "" {
		for _, id := range in.UnitIDs {
			unit := state.World.Units[id]
			if unit == nil || !playerControls(me, unit.Owner) {
				return nil, "", nil, fmt.Errorf("player does not control casualty %s", id)
			}
		}
	}
	return battle, territory, in.UnitIDs, err
}

type randomDice struct{}

func (randomDice) Roll(count int) []int {
	rolls := make([]int, count)
	for i := range rolls {
		n, err := cryptorand.Int(cryptorand.Reader, big.NewInt(6))
		if err != nil {
			panic(err)
		}
		rolls[i] = int(n.Int64()) + 1
	}
	return rolls
}

func powerAssignments(n int) [][]string {
	switch n {
	case 2:
		return [][]string{{"Soviet Union", "United Kingdom", "United States"}, {"Germany", "Japan"}}
	case 3:
		return [][]string{{"Soviet Union", "United Kingdom", "United States"}, {"Germany"}, {"Japan"}}
	case 4:
		return [][]string{{"Soviet Union", "United States"}, {"United Kingdom"}, {"Germany"}, {"Japan"}}
	default:
		return [][]string{{"Soviet Union"}, {"Germany"}, {"United Kingdom"}, {"Japan"}, {"United States"}}
	}
}

func (a *app) archiveGame(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.Lock()
	defer a.lifecycle.Unlock()
	id := r.PathValue("id")
	db, err := a.gameDB(id)
	if err != nil {
		problem(w, 404, "game not found")
		return
	}
	me, err := authenticate(db, r)
	if err != nil || !me.IsOwner {
		db.Close()
		problem(w, 403, "only the owner can archive this game")
		return
	}
	var state gameState
	db.QueryRow(`SELECT state_json FROM state WHERE singleton=1`).Scan(newJSONScanner(&state))
	if state.Status != "abandoned" && state.Status != "finished" {
		db.Close()
		problem(w, 409, "mark the game abandoned before archiving")
		return
	}
	db.Close()
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err = a.catalog.Exec(`UPDATE games SET status='archiving',updated_at=? WHERE id=?`, now, id); err != nil {
		problem(w, 500, "could not begin archiving game")
		return
	}
	src := filepath.Join(a.dataDir, "games", id+".sqlite")
	dst := filepath.Join(a.dataDir, "archives", id+".sqlite")
	if err = os.Rename(src, dst); err != nil {
		a.catalog.Exec(`UPDATE games SET status='active' WHERE id=?`, id)
		problem(w, 500, "could not archive game")
		return
	}
	if _, err = a.catalog.Exec(`UPDATE games SET status='archived',updated_at=? WHERE id=?`, now, id); err != nil {
		problem(w, 500, "could not finish archiving game")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "archived"})
}

func (a *app) deleteGame(w http.ResponseWriter, r *http.Request) {
	a.lifecycle.Lock()
	defer a.lifecycle.Unlock()
	id := r.PathValue("id")
	if !validGameID(id) {
		problem(w, 404, "game not found")
		return
	}
	var status, name string
	if err := a.catalog.QueryRowContext(r.Context(), `SELECT status,name FROM games WHERE id=?`, id).Scan(&status, &name); err != nil || (status != "active" && status != "archived") {
		problem(w, 404, "game not found")
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	path := filepath.Join(a.dataDir, "games", id+".sqlite")
	if status == "archived" {
		path = filepath.Join(a.dataDir, "archives", id+".sqlite")
	}
	db, err := openDB(path)
	if err != nil {
		problem(w, 500, "could not open game")
		return
	}
	me, authErr := authenticate(db, r)
	db.Close()
	if authErr != nil {
		problem(w, 401, "valid game token required")
		return
	}
	if !me.IsOwner {
		problem(w, 403, "only the owner can delete this game")
		return
	}
	if in.Name != name {
		problem(w, 409, "campaign name does not match")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := a.catalog.Exec(`UPDATE games SET status='deleting',updated_at=? WHERE id=?`, now, id); err != nil {
		problem(w, 500, "could not begin deleting game")
		return
	}
	if err := removeGameFiles(a.dataDir, id); err != nil {
		problem(w, 500, "could not delete game")
		return
	}
	if _, err := a.catalog.Exec(`DELETE FROM games WHERE id=?`, id); err != nil {
		problem(w, 500, "could not finish deleting game")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func removeGameFiles(dataDir, id string) error {
	for _, dir := range []string{"games", "archives"} {
		base := filepath.Join(dataDir, dir, id+".sqlite")
		for _, suffix := range []string{"", "-journal", "-wal", "-shm"} {
			if err := os.Remove(base + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

func (a *app) gameDB(id string) (*sql.DB, error) {
	if !validGameID(id) {
		return nil, errors.New("invalid id")
	}
	var status string
	if err := a.catalog.QueryRow(`SELECT status FROM games WHERE id=?`, id).Scan(&status); err != nil || status != "active" {
		return nil, errors.New("not active")
	}
	return openDB(filepath.Join(a.dataDir, "games", id+".sqlite"))
}
func validGameID(id string) bool { return id != "" && !strings.ContainsAny(id, "/\\.") }
func authenticate(db *sql.DB, r *http.Request) (*player, error) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		return nil, errors.New("missing token")
	}
	var p player
	var owner int
	var raw string
	if err := db.QueryRow(`SELECT id,name,is_owner,powers_json FROM players WHERE token_hash=?`, hashToken(token)).Scan(&p.ID, &p.Name, &owner, &raw); err != nil {
		return nil, err
	}
	p.IsOwner = owner == 1
	json.Unmarshal([]byte(raw), &p.Powers)
	return &p, nil
}
func (a *app) touch(id string) {
	a.catalog.Exec(`UPDATE games SET updated_at=? WHERE id=?`, time.Now().UTC().Format(time.RFC3339), id)
}
func hashToken(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
func randomID(bytes int) string {
	b := make([]byte, bytes)
	if _, err := cryptorand.Read(b); err != nil {
		panic(err)
	}
	return strings.TrimRight(base64.RawURLEncoding.EncodeToString(b), "=")
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		problem(w, 400, "invalid JSON request")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message, "status": status})
}
func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}
func spaHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err != nil {
			problem(w, 404, "frontend not built")
			return
		}
		http.ServeFile(w, r, index)
	})
}
