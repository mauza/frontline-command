package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	gameengine "github.com/mauza/axis-and-allies/internal/game"
)

func TestPowerAssignments(t *testing.T) {
	tests := []struct {
		players int
		want    [][]string
	}{
		{2, [][]string{{"Soviet Union", "United Kingdom", "United States"}, {"Germany", "Japan"}}},
		{3, [][]string{{"Soviet Union", "United Kingdom", "United States"}, {"Germany"}, {"Japan"}}},
		{4, [][]string{{"Soviet Union", "United States"}, {"United Kingdom"}, {"Germany"}, {"Japan"}}},
		{5, [][]string{{"Soviet Union"}, {"Germany"}, {"United Kingdom"}, {"Japan"}, {"United States"}}},
	}
	for _, test := range tests {
		got := powerAssignments(test.players)
		if string(mustJSON(got)) != string(mustJSON(test.want)) {
			t.Fatalf("%d players: got %v, want %v", test.players, got, test.want)
		}
	}
}

func TestPurchaseIsServerValidated(t *testing.T) {
	state := initialState()
	state.Status = "active"
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}

	message, err := applyCommand(nil, me, &state, "purchase", json.RawMessage(`{"unit":"Tank","quantity":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if message == "" || state.IPCs["Soviet Union"] != 12 || state.Purchases["Soviet Union"]["Tank"] != 2 {
		t.Fatalf("unexpected purchase result: %#v", state)
	}

	_, err = applyCommand(nil, me, &state, "purchase", json.RawMessage(`{"unit":"Battleship","quantity":1}`))
	if err == nil {
		t.Fatal("expected insufficient IPC error")
	}
	if state.IPCs["Soviet Union"] != 12 {
		t.Fatal("failed purchase changed treasury")
	}
}

func Test1942SecondEditionUnitCatalog(t *testing.T) {
	want := map[string]unitSpec{
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
	if string(mustJSON(units)) != string(mustJSON(want)) {
		t.Fatalf("unit catalog does not match 1942 Second Edition: got %v", units)
	}
}

func Test1942SecondEditionStartingEconomy(t *testing.T) {
	state := initialState()
	want := map[string]int{"Soviet Union": 24, "Germany": 41, "United Kingdom": 31, "Japan": 30, "United States": 42}
	if string(mustJSON(state.IPCs)) != string(mustJSON(want)) || string(mustJSON(state.Income)) != string(mustJSON(want)) {
		t.Fatalf("unexpected starting economy: %#v", state)
	}
	state.IPCs["Germany"]--
	if state.Income["Germany"] != 41 {
		t.Fatal("treasury and income must not share mutable state")
	}
}

func TestTurnOwnershipAndIncome(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.CollectIncome
	russian := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	german := &player{Name: "Rommel", Powers: []string{"Germany"}}

	if _, err := applyCommand(nil, german, &state, "advance_phase", nil); err == nil {
		t.Fatal("out-of-turn player advanced phase")
	}
	if _, err := applyCommand(nil, russian, &state, "advance_phase", nil); err != nil {
		t.Fatal(err)
	}
	if state.IPCs["Soviet Union"] != 48 || state.PowerIndex != 1 || state.PhaseIndex != 0 {
		t.Fatalf("unexpected next turn state: %#v", state)
	}
}

func TestEntireAllianceCanConcede(t *testing.T) {
	state := initialState()
	state.Status = "active"
	allies := &player{Name: "Allied command", Powers: []string{"Soviet Union", "United Kingdom", "United States"}}

	message, err := applyCommand(nil, allies, &state, "concede_game", nil)
	if err != nil {
		t.Fatal(err)
	}
	if message != "Allies conceded; Axis wins" || state.Status != "finished" || state.World.Winner != gameengine.Axis {
		t.Fatalf("unexpected concession result: message=%q status=%q winner=%q", message, state.Status, state.World.Winner)
	}
}

func TestSinglePowerCannotConcedeForAlliance(t *testing.T) {
	state := initialState()
	state.Status = "active"
	player := &player{Name: "Soviet command", Powers: []string{"Soviet Union"}}

	if _, err := applyCommand(nil, player, &state, "concede_game", nil); err == nil {
		t.Fatal("expected partial-alliance concession to fail")
	}
	if state.Status != "active" || state.World.Winner != "" {
		t.Fatal("failed concession changed game state")
	}
}

func TestAPIPersistsAndExposesCompleteEngineWorld(t *testing.T) {
	a := newTestApp(t)
	created := requestJSON(t, a.createGame, "POST", "/api/games", "", map[string]any{"name": "Eastern Front", "playerName": "Zhukov"}, 201)
	id, token, code := stringValue(created, "id"), stringValue(created, "token"), stringValue(created, "joinCode")
	joined := requestJSON(t, a.joinGame, "POST", "/api/games/join", "", map[string]any{"code": code, "playerName": "Rommel"}, 201)
	_ = joined

	started := requestGameCommand(t, a, id, token, 1, "start_game", map[string]any{})
	if got := int(started["version"].(float64)); got != 2 {
		t.Fatalf("start version=%d", got)
	}
	purchased := requestGameCommand(t, a, id, token, 2, "purchase", map[string]any{"units": map[string]int{"Infantry": 2, "Tank": 1}})
	if got := int(purchased["version"].(float64)); got != 3 {
		t.Fatalf("purchase version=%d", got)
	}

	view := requestGame(t, a, id, token)
	world := view["state"].(map[string]any)["world"].(map[string]any)
	if len(world["owners"].(map[string]any)) == 0 || len(world["units"].(map[string]any)) != 227 || world["board"] == nil {
		t.Fatal("GET did not expose a complete identity-bearing world")
	}
	if world["phase"] != string(gameengine.Purchase) || view["currentPhase"] != "Purchase" {
		t.Fatalf("unexpected phase: world=%v view=%v", world["phase"], view["currentPhase"])
	}
	powersView := view["powers"].(map[string]any)
	if powersView["Soviet Union"].(map[string]any)["ipc"].(float64) != 12 {
		t.Fatalf("purchase treasury was not persisted: %v", powersView)
	}
	if len(view["worldUnits"].(map[string]any)) != 227 || view["owners"] == nil || view["pendingDecisions"] == nil {
		t.Fatal("dynamic world fields missing from GET view")
	}
}

func TestCampaignSummaryAndActiveGameLimit(t *testing.T) {
	a := newTestApp(t)
	now := time.Now().UTC().Format(time.RFC3339)
	for i := 0; i < maxActiveGames-1; i++ {
		id := fmt.Sprintf("reserved-%d", i)
		if _, err := a.catalog.Exec(`INSERT INTO games VALUES(?,?,?,'active',?,?)`, id, id, id+"-code", now, now); err != nil {
			t.Fatal(err)
		}
	}
	created := requestJSON(t, a.createGame, "POST", "/api/games", "", map[string]any{"name": "Last Campaign", "playerName": "Owner"}, 201)
	id, token := stringValue(created, "id"), stringValue(created, "token")

	req := httptest.NewRequest("GET", "/api/games/"+id+"/summary", nil)
	req.SetPathValue("id", id)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	a.gameSummary(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("summary status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var summary map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary["name"] != "Last Campaign" || summary["status"] != "lobby" || summary["isOwner"] != true {
		t.Fatalf("unexpected summary: %#v", summary)
	}

	requestJSON(t, a.createGame, "POST", "/api/games", "", map[string]any{"name": "One Too Many", "playerName": "Owner"}, http.StatusConflict)
}

func TestOwnerCanPermanentlyDeleteActiveAndArchivedGames(t *testing.T) {
	tests := []string{"active", "archived"}
	for _, lifecycle := range tests {
		t.Run(lifecycle, func(t *testing.T) {
			a := newTestApp(t)
			created := requestJSON(t, a.createGame, "POST", "/api/games", "", map[string]any{"name": "Old Campaign", "playerName": "Owner"}, 201)
			id, ownerToken, code := stringValue(created, "id"), stringValue(created, "token"), stringValue(created, "joinCode")
			joined := requestJSON(t, a.joinGame, "POST", "/api/games/join", "", map[string]any{"code": code, "playerName": "Guest"}, 201)
			guestToken := stringValue(joined, "token")
			if lifecycle == "archived" {
				if err := os.Rename(filepath.Join(a.dataDir, "games", id+".sqlite"), filepath.Join(a.dataDir, "archives", id+".sqlite")); err != nil {
					t.Fatal(err)
				}
				if _, err := a.catalog.Exec(`UPDATE games SET status='archived' WHERE id=?`, id); err != nil {
					t.Fatal(err)
				}
			}

			requestDelete(t, a, id, guestToken, "Old Campaign", http.StatusForbidden)
			requestDelete(t, a, id, ownerToken, "Wrong Name", http.StatusConflict)
			requestDelete(t, a, id, ownerToken, "Old Campaign", http.StatusNoContent)

			var count int
			if err := a.catalog.QueryRow(`SELECT COUNT(*) FROM games WHERE id=?`, id).Scan(&count); err != nil || count != 0 {
				t.Fatalf("catalog count=%d err=%v", count, err)
			}
			for _, dir := range []string{"games", "archives"} {
				if _, err := os.Stat(filepath.Join(a.dataDir, dir, id+".sqlite")); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("%s game file survived: %v", dir, err)
				}
			}
		})
	}
}

func TestCombatPhaseCannotBypassAutomaticallyDeclaredBattle(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.CombatMove
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	var russian, german *gameengine.Unit
	for _, unit := range state.World.Units {
		if russian == nil && unit.Owner == gameengine.SovietUnion && unit.Type == gameengine.Infantry {
			russian = unit
		}
		if german == nil && unit.Owner == gameengine.Germany && unit.Type == gameengine.Infantry {
			german = unit
		}
	}
	if russian == nil || german == nil {
		t.Fatal("standard setup infantry missing")
	}
	russian.Space, german.Space = "russia", "russia"
	state.World.RefreshTurnSnapshot()

	if _, err := applyCommand(nil, me, &state, "complete_phase", nil); err != nil {
		t.Fatal(err)
	}
	battle, ok := state.Battles["russia"]
	if !ok || battle.Complete || battle.Attacker != gameengine.SovietUnion {
		t.Fatalf("contested territory was not declared: %#v", state.Battles)
	}
	if _, err := applyCommand(nil, me, &state, "complete_phase", nil); err == nil {
		t.Fatal("unresolved battle bypassed conduct combat")
	}
}

func TestAllDeclaredBattlesAreCreatedAndBattleCannotStartTwice(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.CombatMove
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	var russian []*gameengine.Unit
	var german []*gameengine.Unit
	for _, unit := range state.World.Units {
		if unit.Owner == gameengine.SovietUnion && unit.Type == gameengine.Infantry && len(russian) < 2 {
			russian = append(russian, unit)
		}
		if unit.Owner == gameengine.Germany && unit.Type == gameengine.Infantry && len(german) < 2 {
			german = append(german, unit)
		}
	}
	russian[0].Space, german[0].Space = "russia", "russia"
	russian[1].Space, german[1].Space = "caucasus", "caucasus"
	state.World.RefreshTurnSnapshot()
	if _, err := applyCommand(nil, me, &state, "complete_phase", nil); err != nil {
		t.Fatal(err)
	}
	if len(state.Battles) != 2 || state.Battles["russia"].Complete || state.Battles["caucasus"].Complete {
		t.Fatalf("declared battles=%#v", state.Battles)
	}
	payload := json.RawMessage(`{"territory":"russia","bombarders":[]}`)
	if _, err := applyCommand(nil, me, &state, "battle_step", json.RawMessage(`{"territory":"russia"}`)); err == nil {
		t.Fatal("battle advanced before start_battle")
	}
	if _, err := applyCommand(nil, me, &state, "start_battle", payload); err != nil {
		t.Fatal(err)
	}
	if _, err := applyCommand(nil, me, &state, "start_battle", payload); err == nil {
		t.Fatal("battle was started twice")
	}
	if _, err := applyCommand(nil, me, &state, "start_battle", json.RawMessage(`{"territory":"india"}`)); err == nil {
		t.Fatal("undeclared battle was accepted")
	}
}

func TestStartBattleRejectsInvalidBombardersAtomically(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.ConductCombat
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	var selected []*gameengine.Unit
	for _, unit := range state.World.Units {
		if unit.Owner == gameengine.SovietUnion && len(selected) < 3 {
			selected = append(selected, unit)
		}
	}
	infantry, transport, cruiser := selected[0], selected[1], selected[2]
	infantry.Type, transport.Type, cruiser.Type = gameengine.Infantry, gameengine.Transport, gameengine.Cruiser
	infantry.Space, infantry.Amphibious, infantry.AssaultFrom = "germany", true, transport.ID
	transport.Space = "5-sea-zone"
	cruiser.Space = "6-sea-zone"
	state.Battles["germany"] = gameengine.BattleSnapshot{Territory: "germany", Attacker: gameengine.SovietUnion, Stage: "aaa"}
	payload := json.RawMessage(fmt.Sprintf(`{"territory":"germany","bombarders":[%q]}`, cruiser.ID))
	if _, err := applyCommand(nil, me, &state, "start_battle", payload); err == nil {
		t.Fatal("ship outside the assault sea was accepted for bombardment")
	}
	if state.Battles["germany"].Started || len(state.Battles["germany"].Bombarders) != 0 {
		t.Fatal("invalid bombardment mutated battle start state")
	}
	cruiser.Space = "5-sea-zone"
	duplicate := json.RawMessage(fmt.Sprintf(`{"territory":"germany","bombarders":[%q,%q]}`, cruiser.ID, cruiser.ID))
	if _, err := applyCommand(nil, me, &state, "start_battle", duplicate); err == nil {
		t.Fatal("duplicate or excessive bombardment was accepted")
	}
	if _, err := applyCommand(nil, me, &state, "start_battle", payload); err != nil {
		t.Fatalf("valid assault-sea bombarder rejected: %v", err)
	}
}

func TestServerEnforcesMultinationalCasualtyOwnership(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.ConductCombat
	var german, japanese *gameengine.Unit
	for _, unit := range state.World.Units {
		if german == nil && unit.Owner == gameengine.Germany && unit.Type == gameengine.Infantry {
			german = unit
		}
		if japanese == nil && unit.Owner == gameengine.Japan && unit.Type == gameengine.Infantry {
			japanese = unit
		}
	}
	german.Space, japanese.Space = "russia", "russia"
	state.Battles["russia"] = gameengine.BattleSnapshot{
		Territory: "russia", Attacker: gameengine.SovietUnion, Stage: "queued",
		Pending: &gameengine.PendingDecision{Kind: gameengine.ChooseCasualties, Power: gameengine.Germany, Hits: 1, Eligible: []string{german.ID}},
	}
	russian := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	if _, err := applyCommand(nil, russian, &state, "choose_casualties", json.RawMessage(fmt.Sprintf(`{"territory":"russia","unitIds":[%q]}`, german.ID))); err == nil {
		t.Fatal("attacker removed a foreign defender")
	}
	japanesePlayer := &player{Name: "Tojo", Powers: []string{"Japan"}}
	if _, err := applyCommand(nil, japanesePlayer, &state, "choose_casualties", json.RawMessage(fmt.Sprintf(`{"territory":"russia","unitIds":[%q]}`, german.ID))); err == nil {
		t.Fatal("allied defender resolved Germany's casualty decision")
	}
	germanPlayer := &player{Name: "Rommel", Powers: []string{"Germany"}}
	if _, err := applyCommand(nil, germanPlayer, &state, "choose_casualties", json.RawMessage(fmt.Sprintf(`{"territory":"russia","unitIds":[%q]}`, german.ID))); err != nil {
		t.Fatal(err)
	}
	if state.Battles["russia"].Pending != nil || state.World.Units[german.ID] != nil || state.World.Units[japanese.ID] == nil {
		t.Fatal("owner-specific casualty assignment was not persisted")
	}
}

func TestServerEnforcesFighterLandingOwnership(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.ConductCombat
	var fighter *gameengine.Unit
	for _, unit := range state.World.Units {
		if unit.Owner == gameengine.Germany && unit.Type == gameengine.Fighter {
			fighter = unit
			break
		}
	}
	for id, unit := range state.World.Units {
		if unit.Space == "5-sea-zone" {
			delete(state.World.Units, id)
		}
	}
	state.World.Units[fighter.ID] = fighter
	fighter.Space = "5-sea-zone"
	state.Battles["5-sea-zone"] = gameengine.BattleSnapshot{
		Territory: "5-sea-zone", Attacker: gameengine.SovietUnion, Stage: "fighter-landing",
		Pending: &gameengine.PendingDecision{Kind: gameengine.ChooseFighterLanding, Power: gameengine.Germany, Eligible: []string{fighter.ID}, Destinations: map[string][]string{fighter.ID: {}}},
	}
	russian := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	payload := json.RawMessage(fmt.Sprintf(`{"territory":"5-sea-zone","unitId":%q,"destination":""}`, fighter.ID))
	if _, err := applyCommand(nil, russian, &state, "land_fighter", payload); err == nil {
		t.Fatal("attacker resolved a defending fighter landing")
	}
	german := &player{Name: "Rommel", Powers: []string{"Germany"}}
	if _, err := applyCommand(nil, german, &state, "land_fighter", payload); err != nil {
		t.Fatal(err)
	}
	if state.World.Units[fighter.ID] != nil || !state.Battles["5-sea-zone"].Complete {
		t.Fatal("stranded fighter destruction was not persisted")
	}
}

func TestServerCompletesMobilizationWithRefundAndBlocksUnlandedAircraft(t *testing.T) {
	state := initialState()
	state.Status = "active"
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	state.World.Phase = gameengine.Mobilize
	state.World.Purchased = []gameengine.UnitType{gameengine.Tank}
	before := state.World.Powers[gameengine.SovietUnion].IPC
	message, err := completePhase(me, &state)
	if err != nil {
		t.Fatal(err)
	}
	if state.World.Powers[gameengine.SovietUnion].IPC != before+6 || state.World.Phase != gameengine.CollectIncome || message == "" {
		t.Fatalf("refund completion failed: %s %#v", message, state.World.Powers[gameengine.SovietUnion])
	}

	state.World.Phase = gameengine.NoncombatMove
	for _, unit := range state.World.Units {
		if unit.Owner == gameengine.SovietUnion && unit.Type == gameengine.Fighter {
			unit.Space = "germany"
			break
		}
	}
	if _, err := completePhase(me, &state); err == nil {
		t.Fatal("server completed noncombat with an unlanded aircraft")
	}
}

func TestGameStatePersistsDiceTranscripts(t *testing.T) {
	state := initialState()
	state.World.Dice = []gameengine.DiceRoll{{Purpose: "raid", Results: []int{2, 5}}}
	state.Battles["russia"] = gameengine.BattleSnapshot{Territory: "russia", Attacker: gameengine.SovietUnion, Stage: "regular", Rolls: []gameengine.DiceRoll{{Purpose: "combat", Results: []int{1}}}}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var restored gameState
	if err := json.Unmarshal(raw, &restored); err != nil || len(restored.World.Dice) != 1 || len(restored.Battles["russia"].Rolls) != 1 {
		t.Fatalf("dice transcripts did not round trip: err=%v state=%#v", err, restored)
	}
}

func TestServerFullTurnScenario(t *testing.T) {
	state := initialState()
	state.Status = "active"
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	if _, err := applyCommand(nil, me, &state, "purchase", json.RawMessage(`{"units":{"Infantry":1}}`)); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		if _, err := completePhase(me, &state); err != nil {
			t.Fatalf("phase %s: %v", state.World.Phase, err)
		}
	}
	// The unplaced infantry is refunded as mobilization completes.
	if state.World.Phase != gameengine.CollectIncome || len(state.World.Purchased) != 0 || state.World.Powers[gameengine.SovietUnion].IPC != 24 {
		t.Fatalf("pre-collection state=%#v", state.World)
	}
	if _, err := completePhase(me, &state); err != nil {
		t.Fatal(err)
	}
	if state.World.CurrentPower() != gameengine.Germany || state.World.Phase != gameengine.Purchase || state.World.Powers[gameengine.SovietUnion].IPC != 48 {
		t.Fatalf("full turn did not advance: power=%s phase=%s IPC=%d", state.World.CurrentPower(), state.World.Phase, state.World.Powers[gameengine.SovietUnion].IPC)
	}
}

func TestServerResolvesSeaBattleBeforeAmphibiousLandBattle(t *testing.T) {
	state := initialState()
	state.Status = "active"
	state.World.Phase = gameengine.ConductCombat
	me := &player{Name: "Zhukov", Powers: []string{"Soviet Union"}}
	var infantry, transport *gameengine.Unit
	for _, unit := range state.World.Units {
		if unit.Owner != gameengine.SovietUnion || unit.Type != gameengine.Infantry {
			continue
		}
		if infantry == nil {
			infantry = unit
		} else if transport == nil {
			transport = unit
		}
	}
	transport.Type = gameengine.Transport
	infantry.Space, infantry.Amphibious, infantry.AssaultFrom = "germany", true, transport.ID
	transport.Space = "5-sea-zone"
	state.Battles["germany"] = gameengine.BattleSnapshot{Territory: "germany", Attacker: gameengine.SovietUnion, Stage: "aaa"}
	state.Battles["5-sea-zone"] = gameengine.BattleSnapshot{Territory: "5-sea-zone", Attacker: gameengine.SovietUnion, Stage: "aaa"}
	if _, err := applyCommand(nil, me, &state, "battle_step", json.RawMessage(`{"territory":"germany"}`)); err == nil {
		t.Fatal("amphibious land battle started before sea battle resolved")
	}
}

func TestStartupReconcilesCreatingAndArchivingCatalogStates(t *testing.T) {
	a := newTestApp(t)
	now := time.Now().UTC().Format(time.RFC3339)
	insert := func(id, status string) {
		t.Helper()
		if _, err := a.catalog.Exec(`INSERT INTO games VALUES(?,?,?,?,?,?)`, id, id, id+"-code", status, now, now); err != nil {
			t.Fatal(err)
		}
	}
	initialize := func(id string) {
		t.Helper()
		db, err := a.initializeGame(id, id, id+"-code", id+"-player", id+" player", id+"-token")
		if err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
	insert("creating-ready", "creating")
	initialize("creating-ready")
	insert("creating-missing", "creating")
	insert("archiving-source", "archiving")
	initialize("archiving-source")
	insert("archiving-destination", "archiving")
	initialize("archiving-destination")
	insert("deleting-game", "deleting")
	initialize("deleting-game")
	if err := os.Rename(filepath.Join(a.dataDir, "games", "archiving-destination.sqlite"), filepath.Join(a.dataDir, "archives", "archiving-destination.sqlite")); err != nil {
		t.Fatal(err)
	}
	if err := reconcileCatalog(a.dataDir, a.catalog); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"creating-ready": "active", "archiving-source": "active", "archiving-destination": "archived"}
	for id, status := range want {
		var got string
		if err := a.catalog.QueryRow(`SELECT status FROM games WHERE id=?`, id).Scan(&got); err != nil || got != status {
			t.Fatalf("%s status=%q err=%v, want %q", id, got, err, status)
		}
	}
	var count int
	if err := a.catalog.QueryRow(`SELECT COUNT(*) FROM games WHERE id='creating-missing'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("missing creating row survived: count=%d err=%v", count, err)
	}
	if err := a.catalog.QueryRow(`SELECT COUNT(*) FROM games WHERE id='deleting-game'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleting row survived: count=%d err=%v", count, err)
	}
	if _, err := os.Stat(filepath.Join(a.dataDir, "games", "deleting-game.sqlite")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleting game file survived: %v", err)
	}
}

func newTestApp(t *testing.T) *app {
	t.Helper()
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "games"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "archives"), 0o750); err != nil {
		t.Fatal(err)
	}
	catalog, err := openDB(filepath.Join(dir, "catalog.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { catalog.Close() })
	if _, err := catalog.Exec(`CREATE TABLE games (id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	return &app{dataDir: dir, catalog: catalog}
}

func requestJSON(t *testing.T, handler func(http.ResponseWriter, *http.Request), method, path, token string, body any, wantStatus int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler(recorder, req)
	if recorder.Code != wantStatus {
		t.Fatalf("%s %s status=%d body=%s", method, path, recorder.Code, recorder.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func requestGameCommand(t *testing.T, a *app, id, token string, version int, kind string, payload any) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(payload)
	body := map[string]any{"commandId": kind + time.Now().String(), "expectedVersion": version, "type": kind, "payload": json.RawMessage(raw)}
	reqRaw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/api/games/"+id+"/commands", bytes.NewReader(reqRaw))
	req.SetPathValue("id", id)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	a.command(recorder, req)
	if recorder.Code != 200 {
		t.Fatalf("command %s status=%d body=%s", kind, recorder.Code, recorder.Body.String())
	}
	var result map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &result)
	return result
}

func requestGame(t *testing.T, a *app, id, token string) map[string]any {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/games/"+id, nil)
	req.SetPathValue("id", id)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	a.getGame(recorder, req)
	if recorder.Code != 200 {
		t.Fatalf("GET game status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var result map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &result)
	return result
}

func requestDelete(t *testing.T, a *app, id, token, name string, wantStatus int) {
	t.Helper()
	raw, _ := json.Marshal(map[string]string{"name": name})
	req := httptest.NewRequest("DELETE", "/api/games/"+id, bytes.NewReader(raw))
	req.SetPathValue("id", id)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	a.deleteGame(recorder, req)
	if recorder.Code != wantStatus {
		t.Fatalf("DELETE status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func stringValue(values map[string]any, key string) string { return values[key].(string) }

func mustJSON(value any) []byte {
	b, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return b
}
