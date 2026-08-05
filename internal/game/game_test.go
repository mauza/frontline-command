package game

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestStateJSONRoundTripPreservesBoardAndUnitIdentity(t *testing.T) {
	s, err := NewStandardGame()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var restored State
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Board == nil || len(restored.Board.Spaces) != len(s.Board.Spaces) || len(restored.Board.Adjacent) != len(s.Board.Adjacent) {
		t.Fatal("board pointer did not survive state serialization")
	}
	restored.Phase = Mobilize
	restored.Purchased = []UnitType{Infantry}
	restored.Round = 2
	restored.Start.Owners["russia"] = SovietUnion
	if err := restored.Place([]Placement{{Type: Infantry, Space: "russia", Count: 1}}); err != nil {
		t.Fatal(err)
	}
	if restored.Units["u0228"] == nil || len(restored.Units) != len(s.Units)+1 {
		t.Fatal("next unit identity was not preserved")
	}
}

func TestBattleSnapshotRoundTripContinuesPendingDecision(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Infantry, Germany, "front", 0)
	defender := s.addUnit(Infantry, SovietUnion, "front", 0)
	battle, err := NewBattle(s, "front", Germany, &sequenceDice{values: []int{1, 6}})
	if err != nil {
		t.Fatal(err)
	}
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(battle.Snapshot())
	var snapshot BattleSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreBattle(s, snapshot, &sequenceDice{})
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.ChooseCasualties([]string{defender.ID}); err != nil {
		t.Fatal(err)
	}
	if !restored.Complete || restored.Winner != Germany {
		t.Fatal("restored battle did not complete")
	}
}

type sequenceDice struct{ values []int }

func (d *sequenceDice) Roll(n int) []int {
	if n == 0 {
		return nil
	}
	if len(d.values) < n {
		panic("test dice exhausted")
	}
	r := append([]int(nil), d.values[:n]...)
	d.values = d.values[n:]
	return r
}

func mini(spaces []Space, edges [][2]string) *State {
	b := &Board{Spaces: map[string]Space{}, Adjacent: map[string]map[string]bool{}}
	s := &State{Board: b, Round: 1, Phase: Purchase, Powers: map[Power]PowerState{}, Owners: map[string]Power{}, Units: map[string]*Unit{}}
	for _, p := range TurnOrder {
		s.Powers[p] = PowerState{IPC: 30, CapitalHeld: true}
	}
	for _, x := range spaces {
		b.Spaces[x.ID] = x
		b.Adjacent[x.ID] = map[string]bool{}
		if x.OriginalOwner != "" {
			s.Owners[x.ID] = x.OriginalOwner
		}
	}
	for _, e := range edges {
		b.Adjacent[e[0]][e[1]], b.Adjacent[e[1]][e[0]] = true, true
	}
	s.takeSnapshot()
	return s
}

func TestStandardSetupHasIdentityOwnershipIncomeAndSnapshot(t *testing.T) {
	s, err := NewStandardGame()
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Board.Spaces) != 161 || len(s.Units) != 227 {
		t.Fatalf("unexpected setup size: %d spaces, %d units", len(s.Board.Spaces), len(s.Units))
	}
	wantIncome := map[Power]int{SovietUnion: 24, Germany: 41, UnitedKingdom: 31, Japan: 30, UnitedStates: 42}
	for p, want := range wantIncome {
		if got := s.Income(p); got != want {
			t.Errorf("%s income=%d, want %d", p, got, want)
		}
	}
	seen := map[string]bool{}
	for id, u := range s.Units {
		if seen[id] || id == "" || u.Owner == "" {
			t.Fatalf("invalid identity: %#v", u)
		}
		seen[id] = true
	}
	var russianSub bool
	for _, u := range s.UnitsAt("4-sea-zone") {
		russianSub = russianSub || u.Owner == SovietUnion && u.Type == Submarine
	}
	if !russianSub {
		t.Fatal("owner-bearing Russian submarine missing")
	}
	s.Owners["russia"] = Germany
	if s.Start.Owners["russia"] != SovietUnion {
		t.Fatal("turn snapshot aliases live ownership")
	}
}

func TestPurchaseRepairPlacementAndCollection(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}}, [][2]string{{"home", "sea"}})
	f := s.addUnit(Factory, SovietUnion, "home", 0)
	f.Damage = 2
	if err := s.Purchase(PurchaseOrder{Units: map[UnitType]int{Infantry: 2, Destroyer: 1}, Repairs: map[string]int{f.ID: 1}}); err != nil {
		t.Fatal(err)
	}
	if s.Powers[SovietUnion].IPC != 15 || f.Damage != 1 {
		t.Fatalf("unexpected purchase result: %#v damage=%d", s.Powers[SovietUnion], f.Damage)
	}
	s.Phase = Mobilize
	if err := s.Place([]Placement{{Infantry, "home", 2}, {Destroyer, "sea", 1}}); err == nil || !strings.Contains(err.Error(), "capacity") {
		t.Fatalf("expected shared capacity error, got %v", err)
	}
	if err := s.Place([]Placement{{Infantry, "home", 2}}); err != nil {
		t.Fatal(err)
	}
	if len(s.Purchased) != 1 || s.Purchased[0] != Destroyer {
		t.Fatalf("unexpected unplaced pool: %v", s.Purchased)
	}
	s.Phase = CollectIncome
	before := s.Powers[SovietUnion].IPC
	if err := s.Collect(); err != nil {
		t.Fatal(err)
	}
	if s.Powers[SovietUnion].IPC != before+3 || s.CurrentPower() != Germany || s.Phase != Purchase {
		t.Fatal("collection did not advance turn")
	}
}

func TestPurchaseAndPlacementRejectPathologicalQuantitiesAtomically(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}}, nil)
	factory := s.addUnit(Factory, SovietUnion, "home", 0)
	factory.Damage = math.MaxInt
	beforeIPC := s.Powers[SovietUnion].IPC
	for name, order := range map[string]PurchaseOrder{
		"units":   {Units: map[UnitType]int{Infantry: math.MaxInt}},
		"repairs": {Repairs: map[string]int{factory.ID: math.MaxInt}},
	} {
		if err := s.Purchase(order); err == nil {
			t.Fatalf("%s quantity was accepted", name)
		}
		if s.Powers[SovietUnion].IPC != beforeIPC || factory.Damage != math.MaxInt || len(s.Purchased) != 0 {
			t.Fatalf("rejected %s mutated state", name)
		}
	}

	s.Phase = Mobilize
	s.Purchased = []UnitType{Infantry}
	beforeUnits := len(s.Units)
	if err := s.Place([]Placement{{Type: Infantry, Space: "home", Count: math.MaxInt}}); err == nil {
		t.Fatal("pathological placement quantity was accepted")
	}
	if len(s.Units) != beforeUnits || !reflect.DeepEqual(s.Purchased, []UnitType{Infantry}) {
		t.Fatal("rejected placement mutated state")
	}
}

func TestNewFactoryPlacementDoesNotRequireExistingFactory(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}, {ID: "new", Kind: "land", IPC: 2, OriginalOwner: SovietUnion}}, nil)
	s.Purchased = []UnitType{Factory}
	s.Phase = Mobilize
	if err := s.Place([]Placement{{Type: Factory, Space: "new", Count: 1}}); err != nil {
		t.Fatal(err)
	}
	if !s.hasFactory("new") || s.hasUsableFactory(SovietUnion, "new") {
		t.Fatal("new factory should exist but cannot produce on its placement turn")
	}
}

func TestMovementBlitzCanalCarrierAndTransport(t *testing.T) {
	spaces := []Space{
		{ID: "a", Kind: "land", OriginalOwner: Germany}, {ID: "b", Kind: "land", OriginalOwner: SovietUnion}, {ID: "c", Kind: "land", OriginalOwner: SovietUnion},
		{ID: "17-sea-zone", Kind: "sea"}, {ID: "34-sea-zone", Kind: "sea"}, {ID: "egypt", Kind: "land", OriginalOwner: UnitedKingdom}, {ID: "trans-jordan", Kind: "land", OriginalOwner: UnitedKingdom},
		{ID: "coast", Kind: "land", OriginalOwner: Germany}, {ID: "ocean", Kind: "sea"}, {ID: "island", Kind: "land", OriginalOwner: SovietUnion},
	}
	edges := [][2]string{{"a", "b"}, {"b", "c"}, {"17-sea-zone", "34-sea-zone"}, {"coast", "ocean"}, {"ocean", "island"}}
	s := mini(spaces, edges)
	s.Turn = 1
	s.Phase = CombatMove
	s.takeSnapshot()
	tank := s.addUnit(Tank, Germany, "a", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{tank.ID, []string{"a", "b", "c"}}}}); err != nil {
		t.Fatal(err)
	}
	if tank.Space != "c" || s.Owners["b"] != Germany {
		t.Fatal("tank did not blitz/capture intermediate territory")
	}
	ship := s.addUnit(Destroyer, Germany, "17-sea-zone", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{ship.ID, []string{"17-sea-zone", "34-sea-zone"}}}}); err == nil {
		t.Fatal("enemy-controlled Suez should be closed")
	}
	s.Owners["egypt"], s.Owners["trans-jordan"] = Germany, Germany
	if err := s.Move(MovementPlan{Moves: []Move{{ship.ID, []string{"17-sea-zone", "34-sea-zone"}}}}); err == nil {
		t.Fatal("mid-turn canal capture opened Suez")
	}
	s.takeSnapshot()
	if err := s.Move(MovementPlan{Moves: []Move{{ship.ID, []string{"17-sea-zone", "34-sea-zone"}}}}); err != nil {
		t.Fatal(err)
	}

	s.Phase = NoncombatMove
	transport := s.addUnit(Transport, Germany, "ocean", 0)
	inf := s.addUnit(Infantry, Germany, "coast", 0)
	arty := s.addUnit(Artillery, Germany, "coast", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"ocean", "ocean"}}}, Transports: []TransportOrder{{transport.ID, []string{inf.ID, arty.ID}, ""}}}); err == nil {
		t.Fatal("non-adjacent self path should fail")
	}
	// Loading without moving still uses an explicit path to an adjacent sea zone.
	s.Board.Spaces["ocean2"] = Space{ID: "ocean2", Kind: "sea"}
	s.Board.Adjacent["ocean2"] = map[string]bool{"ocean": true, "island": true}
	s.Board.Adjacent["ocean"]["ocean2"] = true
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"ocean", "ocean2"}}}, Transports: []TransportOrder{{transport.ID, []string{inf.ID, arty.ID}, ""}}}); err != nil {
		t.Fatal(err)
	}
	if inf.TransportID != transport.ID || arty.TransportID != transport.ID {
		t.Fatal("cargo was not loaded")
	}

	carrier := s.addUnit(Carrier, Germany, "ocean", 0)
	s.addUnit(Fighter, Germany, "ocean", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{carrier.ID, []string{"ocean", "ocean2"}}}}); err == nil || !strings.Contains(err.Error(), "carrier capacity") {
		t.Fatalf("carrier must not abandon fighter: %v", err)
	}
}

func TestTransportCapacityRequiresInfantry(t *testing.T) {
	s := mini([]Space{{ID: "land", Kind: "land", OriginalOwner: SovietUnion}, {ID: "s1", Kind: "sea"}, {ID: "s2", Kind: "sea"}}, [][2]string{{"land", "s1"}, {"s1", "s2"}})
	s.Phase = NoncombatMove
	tr := s.addUnit(Transport, SovietUnion, "s1", 0)
	a := s.addUnit(Artillery, SovietUnion, "land", 0)
	tank := s.addUnit(Tank, SovietUnion, "land", 0)
	err := s.Move(MovementPlan{Moves: []Move{{tr.ID, []string{"s1", "s2"}}}, Transports: []TransportOrder{{tr.ID, []string{a.ID, tank.ID}, ""}}})
	if err == nil || !strings.Contains(err.Error(), "infantry") {
		t.Fatalf("expected capacity rule, got %v", err)
	}
}

func TestCaptureLiberationCapitalAndVictory(t *testing.T) {
	s := mini([]Space{{ID: "moscow", Kind: "land", IPC: 8, OriginalOwner: SovietUnion, Capital: true, VictoryCity: true}, {ID: "russian", Kind: "land", IPC: 2, OriginalOwner: SovietUnion}, {ID: "berlin", Kind: "land", OriginalOwner: Germany, Capital: true, VictoryCity: true}}, nil)
	s.Powers[SovietUnion] = PowerState{IPC: 12, CapitalHeld: true}
	s.Powers[Germany] = PowerState{IPC: 5, CapitalHeld: true}
	s.Capture("moscow", Germany)
	if s.Powers[SovietUnion].CapitalHeld || s.Powers[SovietUnion].IPC != 0 || s.Powers[Germany].IPC != 17 {
		t.Fatal("capital treasury capture failed")
	}
	s.Capture("russian", UnitedKingdom)
	if s.Owners["russian"] != UnitedKingdom {
		t.Fatal("territory should be captured while allied capital is occupied")
	}
	s.Capture("moscow", UnitedKingdom)
	if !s.Powers[SovietUnion].CapitalHeld || s.Owners["moscow"] != SovietUnion || s.Owners["russian"] != SovietUnion {
		t.Fatal("capital liberation did not restore original control")
	}

	for i := 0; i < 9; i++ {
		id := string(rune('a' + i))
		s.Board.Spaces[id] = Space{ID: id, Kind: "land", VictoryCity: true}
		s.Owners[id] = Germany
	}
	if got := s.CheckVictory(); got != Axis {
		t.Fatalf("victory=%s", got)
	}
}

func TestBattleArtilleryAAAAndBattleshipDamage(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	inf := s.addUnit(Infantry, Germany, "front", 0)
	art := s.addUnit(Artillery, Germany, "front", 0)
	defender := s.addUnit(Infantry, SovietUnion, "front", 0)
	b, err := NewBattle(s, "front", Germany, &sequenceDice{values: []int{2, 6, 6}})
	if err != nil {
		t.Fatal(err)
	}
	if err = b.Step(); err != nil {
		t.Fatal(err)
	}
	if b.Pending == nil || b.Pending.Hits != 1 || !reflect.DeepEqual(b.Pending.Eligible, []string{defender.ID}) {
		t.Fatalf("unexpected artillery result: %#v", b.Pending)
	}
	if err = b.ChooseCasualties([]string{defender.ID}); err != nil {
		t.Fatal(err)
	}
	if !b.Complete || b.Winner != Germany || s.Owners["front"] != Germany {
		t.Fatal("battle did not complete and capture")
	}
	_ = inf
	_ = art

	s2 := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s2.Turn = 1
	s2.Phase = ConductCombat
	bomber := s2.addUnit(Bomber, Germany, "front", 0)
	s2.addUnit(AAA, SovietUnion, "front", 0)
	s2.addUnit(Infantry, SovietUnion, "front", 0)
	b2, _ := NewBattle(s2, "front", Germany, &sequenceDice{values: []int{1}})
	if err := b2.Step(); err != nil {
		t.Fatal(err)
	}
	if b2.Pending == nil || b2.Pending.Kind != ChooseCasualties {
		t.Fatal("AAA casualty decision missing")
	}
	if err := b2.ChooseCasualties([]string{bomber.ID}); err != nil {
		t.Fatal(err)
	}
	if !b2.Complete {
		t.Fatal("AAA should have ended attack")
	}

	s3 := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	bb := s3.addUnit(Battleship, Germany, "sea", 0)
	b3 := &Battle{State: s3, Pending: &PendingDecision{Kind: ChooseCasualties, Hits: 2, Eligible: []string{bb.ID}}}
	if err := b3.ChooseCasualties([]string{bb.ID, bb.ID}); err != nil {
		t.Fatal(err)
	}
	if s3.Units[bb.ID] != nil {
		t.Fatal("two hits in one combat must sink battleship")
	}
}

func TestSubmarineDecisionAndStrategicBombingCap(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}, {ID: "factory", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	sub := s.addUnit(Submarine, Germany, "sea", 0)
	enemy := s.addUnit(Cruiser, SovietUnion, "sea", 0)
	b, _ := NewBattle(s, "sea", Germany, &sequenceDice{values: []int{6, 6, 6, 6}})
	if err := b.Step(); err != nil {
		t.Fatal(err)
	}
	if b.Pending == nil || b.Pending.Kind != ChooseSubmerge {
		t.Fatalf("submerge decision missing: %#v", b.Pending)
	}
	if len(b.Rolls) != 0 {
		t.Fatalf("submerge was offered after combat dice: %#v", b.Rolls)
	}
	if err := b.Submerge([]string{sub.ID}); err != nil {
		t.Fatal(err)
	}
	if !b.Complete || b.Winner != enemy.Owner {
		t.Fatal("submergence did not end battle")
	}

	factory := s.addUnit(Factory, SovietUnion, "factory", 0)
	factory.Damage = 5
	s.addUnit(AAA, SovietUnion, "factory", 0)
	bomber := s.addUnit(Bomber, Germany, "factory", 0)
	damage, err := s.StrategicBomb("factory", []string{bomber.ID}, &sequenceDice{values: []int{2, 6}})
	if err != nil {
		t.Fatal(err)
	}
	if damage != 1 || factory.Damage != 6 {
		t.Fatalf("bombing cap failed: damage=%d total=%d", damage, factory.Damage)
	}
}

func TestTransportLoadsAlongRouteAndCannotHideExistingCargo(t *testing.T) {
	s := mini([]Space{{ID: "coast", Kind: "land", OriginalOwner: SovietUnion}, {ID: "s1", Kind: "sea"}, {ID: "s2", Kind: "sea"}}, [][2]string{{"s1", "s2"}, {"coast", "s2"}})
	s.Phase = NoncombatMove
	transport := s.addUnit(Transport, SovietUnion, "s1", 0)
	infantry := s.addUnit(Infantry, SovietUnion, "coast", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"s1", "s2"}}}, Transports: []TransportOrder{{transport.ID, []string{infantry.ID}, ""}}}); err != nil {
		t.Fatal(err)
	}
	if infantry.TransportID != transport.ID {
		t.Fatal("unit adjacent to a later route space was not loaded")
	}

	artillery := s.addUnit(Artillery, SovietUnion, "coast", 0)
	transport.Moved = 0
	transport.Space = "s1"
	err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"s1", "s2"}}}, Transports: []TransportOrder{{transport.ID, []string{artillery.ID}, ""}}})
	if err == nil || !strings.Contains(err.Error(), "existing cargo") {
		t.Fatalf("expected complete cargo manifest validation, got %v", err)
	}
}

func TestNoncombatCannotCompleteUntilEveryAircraftLands(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", OriginalOwner: SovietUnion}, {ID: "enemy", Kind: "land", OriginalOwner: Germany}, {ID: "sea", Kind: "sea"}}, nil)
	s.Phase = NoncombatMove
	bomber := s.addUnit(Bomber, SovietUnion, "enemy", 0)
	if err := s.AdvancePhase(); err == nil || !strings.Contains(err.Error(), "has not landed") {
		t.Fatalf("unlanded bomber completed noncombat: %v", err)
	}
	bomber.Space = "home"
	s.addUnit(Carrier, SovietUnion, "sea", 0)
	s.addUnit(Fighter, SovietUnion, "sea", 0)
	s.addUnit(Fighter, SovietUnion, "sea", 0)
	if err := s.AdvancePhase(); err != nil {
		t.Fatal(err)
	}
	if s.Phase != Mobilize {
		t.Fatalf("phase=%s", s.Phase)
	}
}

func TestAlliedUnitsDoNotJoinAttackAndMultinationalCasualtiesRemainOwnerAuthorized(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	german := s.addUnit(Tank, Germany, "front", 0)
	germanInfantry := s.addUnit(Infantry, Germany, "front", 0)
	s.addUnit(Tank, Japan, "front", 0)
	russian := s.addUnit(Infantry, SovietUnion, "front", 0)
	british := s.addUnit(Infantry, UnitedKingdom, "front", 0)
	attackers, defenders := forces(s, "front", Germany)
	if !reflect.DeepEqual(unitIDs(attackers), []string{german.ID, germanInfantry.ID}) || len(defenders) != 2 {
		t.Fatalf("wrong multinational forces: attackers=%v defenders=%v", unitIDs(attackers), unitIDs(defenders))
	}
	battle, err := NewBattle(s, "front", Germany, &sequenceDice{values: []int{1, 1, 6, 6}})
	if err != nil {
		t.Fatal(err)
	}
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || battle.Pending.Power != SovietUnion || battle.Pending.Hits != 1 {
		t.Fatalf("multinational casualty decision=%#v", battle.Pending)
	}
	if err := battle.ChooseCasualties([]string{russian.ID}); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || battle.Pending.Power != UnitedKingdom || battle.Pending.Hits != 1 || s.Units[british.ID] == nil {
		t.Fatal("multinational casualty decisions were not ordered by power")
	}
	if err := battle.ChooseCasualties([]string{british.ID}); err != nil {
		t.Fatal(err)
	}
}

func TestOverkillCasualtiesCapRequiredHitsAtRemainingCapacity(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: Germany}}, nil)
	first := s.addUnit(Infantry, Germany, "front", 0)
	second := s.addUnit(Artillery, Germany, "front", 0)
	battle := &Battle{
		State: s,
		queue: []PendingDecision{{
			Kind: ChooseCasualties, Power: Germany, Hits: 3,
			Eligible: []string{first.ID, second.ID}, Group: 1,
		}},
	}
	battle.presentNextDecision()
	if battle.Pending == nil || battle.Pending.Hits != 2 || battle.Pending.MinHits != 2 {
		t.Fatalf("overkill decision=%#v, want exactly two remaining hits", battle.Pending)
	}
	if err := battle.ChooseCasualties([]string{first.ID, second.ID}); err != nil {
		t.Fatalf("assigning every remaining unit failed: %v", err)
	}

	legacy := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: Germany}}, nil)
	legacyFirst := legacy.addUnit(Infantry, Germany, "front", 0)
	legacySecond := legacy.addUnit(Artillery, Germany, "front", 0)
	persisted := &Battle{State: legacy, Pending: &PendingDecision{
		Kind: ChooseCasualties, Power: Germany, Hits: 2, MinHits: 3,
		Eligible: []string{legacyFirst.ID, legacySecond.ID}, Group: 1,
	}}
	if err := persisted.ChooseCasualties([]string{legacyFirst.ID, legacySecond.ID}); err != nil {
		t.Fatalf("persisted overkill decision remained stuck: %v", err)
	}
}

func TestBombardmentQueuesMultinationalDefenderCasualtiesByOwner(t *testing.T) {
	spaces := []Space{{ID: "coast", Kind: "land", OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"coast", "sea"}})
	s.Turn, s.Phase = 1, ConductCombat
	for range 2 {
		attacker := s.addUnit(Infantry, Germany, "coast", 0)
		transport := s.addUnit(Transport, Germany, "sea", 0)
		attacker.Amphibious, attacker.AssaultFrom = true, transport.ID
	}
	british := s.addUnit(Infantry, UnitedKingdom, "coast", 0)
	american := s.addUnit(Infantry, UnitedStates, "coast", 0)
	cruiser := s.addUnit(Cruiser, Germany, "sea", 0)
	battleship := s.addUnit(Battleship, Germany, "sea", 0)
	battle, err := NewBattle(s, "coast", Germany, &sequenceDice{values: []int{1, 1}}, cruiser.ID, battleship.ID)
	if err != nil {
		t.Fatal(err)
	}
	battle.fireBombardment()
	if battle.Pending == nil || battle.Pending.Power != UnitedKingdom || !reflect.DeepEqual(battle.Pending.Eligible, []string{british.ID}) {
		t.Fatalf("first bombardment casualty decision=%#v", battle.Pending)
	}
	if err := battle.ChooseCasualties([]string{american.ID}); err == nil {
		t.Fatal("one ally assigned another owner's bombardment casualty")
	}
	if err := battle.ChooseCasualties([]string{british.ID}); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || battle.Pending.Power != UnitedStates || !reflect.DeepEqual(battle.Pending.Eligible, []string{american.ID}) {
		t.Fatalf("second bombardment casualty decision=%#v", battle.Pending)
	}
	if err := battle.ChooseCasualties([]string{american.ID}); err != nil || !battle.Complete || battle.Winner != Germany {
		t.Fatalf("bombardment casualty queue did not finish: err=%v pending=%#v", err, battle.Pending)
	}
}

func TestMixedAirAndSurfaceHitsDoNotLetAircraftHitSubmarines(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Fighter, Germany, "sea", 0)
	s.addUnit(Cruiser, Germany, "sea", 0)
	sub := s.addUnit(Submarine, SovietUnion, "sea", 0)
	fighter := s.addUnit(Fighter, SovietUnion, "sea", 0)
	battle, err := NewBattle(s, "sea", Germany, &sequenceDice{values: []int{6, 1, 6, 6}})
	if err != nil {
		t.Fatal(err)
	}
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending != nil && battle.Pending.Kind == ChooseSubmerge {
		if err := battle.Submerge(nil); err != nil {
			t.Fatal(err)
		}
		if err := battle.Step(); err != nil {
			t.Fatal(err)
		}
	}
	if battle.Pending == nil || !reflect.DeepEqual(battle.Pending.Eligible, []string{fighter.ID}) {
		t.Fatalf("air hit eligibility=%#v; submarine=%s", battle.Pending, sub.ID)
	}
}

func TestSubmergeDecisionsAreSeparatedBySide(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	attacker := s.addUnit(Submarine, Germany, "sea", 0)
	defender := s.addUnit(Submarine, SovietUnion, "sea", 0)
	alliedDefender := s.addUnit(Submarine, UnitedKingdom, "sea", 0)
	battle, _ := NewBattle(s, "sea", Germany, &sequenceDice{values: []int{6, 6, 6}})
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending.Power != Germany || !reflect.DeepEqual(battle.Pending.Eligible, []string{attacker.ID}) {
		t.Fatalf("attacker submerge offer=%#v", battle.Pending)
	}
	if err := battle.Submerge(nil); err != nil {
		t.Fatal(err)
	}
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending.Power != SovietUnion || !reflect.DeepEqual(battle.Pending.Eligible, []string{defender.ID}) {
		t.Fatalf("defender submerge offer=%#v", battle.Pending)
	}
	if err := battle.Submerge(nil); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || battle.Pending.Power != UnitedKingdom || !reflect.DeepEqual(battle.Pending.Eligible, []string{alliedDefender.ID}) {
		t.Fatalf("allied defender submerge offer=%#v", battle.Pending)
	}
}

func TestDefendingFighterGetsPersistedOneSpaceLandingAfterCarrierLoss(t *testing.T) {
	spaces := []Space{{ID: "battle", Kind: "sea"}, {ID: "island", Kind: "land", OriginalOwner: SovietUnion}, {ID: "fleet", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"battle", "island"}, {"battle", "fleet"}})
	s.Turn = 1
	s.Phase = ConductCombat
	fighter := s.addUnit(Fighter, SovietUnion, "battle", 0)
	s.addUnit(Carrier, UnitedKingdom, "fleet", 0)
	s.addUnit(Fighter, UnitedKingdom, "fleet", 0)
	battle := &Battle{State: s, Territory: "battle", Attacker: Germany, dice: &sequenceDice{}, stage: "regular"}
	battle.checkFinished()
	if battle.Complete || battle.Pending == nil || battle.Pending.Kind != ChooseFighterLanding || battle.Pending.Power != SovietUnion {
		t.Fatalf("fighter landing decision=%#v complete=%v", battle.Pending, battle.Complete)
	}
	want := []string{"fleet", "island"}
	if !reflect.DeepEqual(battle.Pending.Destinations[fighter.ID], want) {
		t.Fatalf("landing destinations=%v want %v", battle.Pending.Destinations[fighter.ID], want)
	}
	raw, _ := json.Marshal(battle.Snapshot())
	var snapshot BattleSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreBattle(s, snapshot, &sequenceDice{})
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.LandFighter(fighter.ID, "fleet"); err != nil {
		t.Fatal(err)
	}
	if !restored.Complete || restored.Winner != SovietUnion || fighter.Space != "fleet" {
		t.Fatalf("landing result complete=%v winner=%s space=%s", restored.Complete, restored.Winner, fighter.Space)
	}
}

func TestDefendingFighterWithoutLandingIsDestroyed(t *testing.T) {
	s := mini([]Space{{ID: "battle", Kind: "sea"}}, nil)
	fighter := s.addUnit(Fighter, SovietUnion, "battle", 0)
	battle := &Battle{State: s, Territory: "battle", Attacker: Germany, stage: "regular"}
	battle.checkFinished()
	if battle.Pending == nil || len(battle.Pending.Destinations[fighter.ID]) != 0 {
		t.Fatalf("unexpected landing decision=%#v", battle.Pending)
	}
	if err := battle.LandFighter(fighter.ID, ""); err != nil {
		t.Fatal(err)
	}
	if !battle.Complete || battle.Winner != SovietUnion || s.Units[fighter.ID] != nil {
		t.Fatalf("stranded fighter survived: complete=%v winner=%s", battle.Complete, battle.Winner)
	}
}

func TestStrategicBomberCannotBeReusedAndRollsPersist(t *testing.T) {
	s := mini([]Space{{ID: "target", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Factory, SovietUnion, "target", 0)
	s.addUnit(AAA, SovietUnion, "target", 0)
	bomber := s.addUnit(Bomber, Germany, "target", 0)
	if _, err := s.StrategicBomb("target", []string{bomber.ID}, &sequenceDice{values: []int{2, 4}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StrategicBomb("target", []string{bomber.ID}, &sequenceDice{}); err == nil {
		t.Fatal("bomber was reused for a second raid")
	}
	if len(s.Dice) != 2 || !reflect.DeepEqual(s.Dice[1].Results, []int{4}) {
		t.Fatalf("strategic bombing transcript=%#v", s.Dice)
	}
	raw, _ := json.Marshal(s)
	var restored State
	if err := json.Unmarshal(raw, &restored); err != nil || len(restored.Dice) != 2 || !restored.Units[bomber.ID].Raided {
		t.Fatalf("raid state did not persist: err=%v dice=%v", err, restored.Dice)
	}
}

func TestBattleDiceTranscriptSurvivesSnapshotRestore(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Infantry, Germany, "front", 0)
	s.addUnit(Infantry, SovietUnion, "front", 0)
	battle, _ := NewBattle(s, "front", Germany, &sequenceDice{values: []int{1, 6}})
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	snapshot := battle.Snapshot()
	if len(snapshot.Rolls) != 2 {
		t.Fatalf("roll transcript=%#v", snapshot.Rolls)
	}
	restored, err := RestoreBattle(s, snapshot, &sequenceDice{})
	if err != nil || !reflect.DeepEqual(restored.Rolls, snapshot.Rolls) {
		t.Fatalf("restored transcript=%#v err=%v", restored.Rolls, err)
	}
}

func TestFactoryCapacitySelectionNewFactoryRestrictionAndRefund(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "land", IPC: 1, OriginalOwner: SovietUnion}, {ID: "b", Kind: "land", IPC: 2, OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}, {ID: "captured", Kind: "land", IPC: 2, OriginalOwner: Germany}}
	s := mini(spaces, [][2]string{{"a", "sea"}, {"b", "sea"}})
	s.addUnit(Factory, SovietUnion, "a", 0)
	s.addUnit(Factory, SovietUnion, "b", 0)
	s.Purchased = []UnitType{Infantry, Destroyer, Factory, Tank}
	s.Phase = Mobilize
	s.Owners["captured"] = SovietUnion
	if err := s.Place([]Placement{{Infantry, "a", 1}, {Destroyer, "sea", 1}}); err != nil {
		t.Fatalf("sea unit was not allocated to available adjacent factory: %v", err)
	}
	if err := s.Place([]Placement{{Factory, "captured", 1}}); err == nil {
		t.Fatal("factory was placed in territory captured this turn")
	}
	before := s.Powers[SovietUnion].IPC
	if refund := s.RefundUnplaced(); refund != UnitSpecs[Factory].Cost+UnitSpecs[Tank].Cost || s.Powers[SovietUnion].IPC != before+refund || len(s.Purchased) != 0 {
		t.Fatalf("refund=%d treasury=%d purchased=%v", refund, s.Powers[SovietUnion].IPC, s.Purchased)
	}
}

func TestPlacementEnforcesUnitDomainAndCarrierCapacity(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}}, [][2]string{{"home", "sea"}})
	s.addUnit(Factory, SovietUnion, "home", 0)
	s.Purchased = []UnitType{Destroyer, Fighter, Carrier}
	s.Phase = Mobilize
	if err := s.Place([]Placement{{Destroyer, "home", 1}}); err == nil || !strings.Contains(err.Error(), "at sea") {
		t.Fatalf("ship was placed on land: %v", err)
	}
	if err := s.Place([]Placement{{Fighter, "sea", 1}}); err == nil || !strings.Contains(err.Error(), "carrier capacity") {
		t.Fatalf("fighter was placed at sea without a carrier: %v", err)
	}
	if err := s.Place([]Placement{{Carrier, "sea", 1}, {Fighter, "sea", 1}}); err != nil {
		t.Fatalf("simultaneous carrier/fighter placement failed: %v", err)
	}
}

func TestFullTurnPurchaseCombatMobilizeRefundAndCollect(t *testing.T) {
	spaces := []Space{{ID: "home", Kind: "land", IPC: 2, OriginalOwner: SovietUnion}, {ID: "front", Kind: "land", IPC: 1, OriginalOwner: Germany}}
	s := mini(spaces, [][2]string{{"home", "front"}})
	s.Powers[SovietUnion] = PowerState{IPC: 10, CapitalHeld: true}
	s.addUnit(Factory, SovietUnion, "home", 0)
	attacker := s.addUnit(Infantry, SovietUnion, "home", 0)
	defender := s.addUnit(Infantry, Germany, "front", 0)
	if err := s.Purchase(PurchaseOrder{Units: map[UnitType]int{Infantry: 1, Tank: 1}}); err != nil {
		t.Fatal(err)
	}
	if err := s.AdvancePhase(); err != nil || s.Move(MovementPlan{Moves: []Move{{attacker.ID, []string{"home", "front"}}}}) != nil {
		t.Fatalf("combat movement failed: %v", err)
	}
	if err := s.AdvancePhase(); err != nil {
		t.Fatal(err)
	}
	battle, _ := NewBattle(s, "front", SovietUnion, &sequenceDice{values: []int{1, 6}})
	if err := battle.Step(); err != nil || battle.ChooseCasualties([]string{defender.ID}) != nil || !battle.Complete {
		t.Fatal("deterministic battle did not complete")
	}
	if err := s.AdvancePhase(); err != nil || s.AdvancePhase() != nil {
		t.Fatal("could not reach mobilization")
	}
	if err := s.Place([]Placement{{Infantry, "home", 1}}); err != nil {
		t.Fatal(err)
	}
	if refund := s.RefundUnplaced(); refund != 6 {
		t.Fatalf("tank refund=%d", refund)
	}
	if err := s.AdvancePhase(); err != nil || s.Collect() != nil {
		t.Fatal("could not finish turn")
	}
	if s.CurrentPower() != Germany || s.Round != 1 || s.Powers[SovietUnion].IPC != 10 || s.Owners["front"] != SovietUnion {
		t.Fatalf("bad full-turn result: power=%s round=%d ipc=%d owner=%s", s.CurrentPower(), s.Round, s.Powers[SovietUnion].IPC, s.Owners["front"])
	}
}

func TestDirectCasualtyStageAndOtherBattleStateArePreserved(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}, {ID: "other", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	bomber1 := s.addUnit(Bomber, Germany, "front", 0)
	s.addUnit(Bomber, Germany, "front", 0)
	s.addUnit(AAA, SovietUnion, "front", 0)
	s.addUnit(Infantry, SovietUnion, "front", 0)
	other := s.addUnit(Infantry, Germany, "other", 0)
	other.Amphibious = true
	submerged := s.addUnit(Submarine, Germany, "submerged:other", 0)
	battle, _ := NewBattle(s, "front", Germany, &sequenceDice{values: []int{1, 6}})
	if err := battle.Step(); err != nil || battle.ChooseCasualties([]string{bomber1.ID}) != nil {
		t.Fatal("AAA casualty assignment failed")
	}
	if battle.stage != "bombard" {
		t.Fatalf("AAA casualty resumed at %q, want bombard", battle.stage)
	}
	battle.Complete = false
	delete(s.Units, "missing")
	// Finish this battle directly; unrelated battle markers must remain untouched.
	for _, u := range s.UnitsAt("front") {
		if !s.Allied(u.Owner, Germany) {
			delete(s.Units, u.ID)
		}
	}
	battle.checkFinished()
	if !other.Amphibious || submerged.Space != "submerged:other" {
		t.Fatal("finishing one battle modified another battle")
	}
}

func TestAlliedFightersConsumeCarrierCapacityAtNoncombatCompletion(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	s.Phase = NoncombatMove
	s.addUnit(Carrier, SovietUnion, "sea", 0)
	s.addUnit(Fighter, UnitedKingdom, "sea", 0)
	s.addUnit(Fighter, UnitedKingdom, "sea", 0)
	s.addUnit(Fighter, SovietUnion, "sea", 0)
	if err := s.AdvancePhase(); err == nil || !strings.Contains(err.Error(), "carrier capacity") {
		t.Fatalf("allied carrier occupancy was ignored: %v", err)
	}
}

func TestInvalidStrategicRaidIsAtomic(t *testing.T) {
	s := mini([]Space{{ID: "target", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Factory, SovietUnion, "target", 0)
	bomber := s.addUnit(Bomber, Germany, "target", 0)
	if _, err := s.StrategicBomb("target", []string{bomber.ID, bomber.ID}, &sequenceDice{}); err == nil {
		t.Fatal("duplicate bomber raid was accepted")
	}
	if bomber.Raided || bomber.CombatUsed || len(s.Dice) != 0 {
		t.Fatal("failed strategic raid mutated state")
	}
}

func TestMixedSubmarineHitsCannotHitAircraft(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	s.Turn = 1
	s.Phase = ConductCombat
	s.addUnit(Submarine, Germany, "sea", 0)
	s.addUnit(Cruiser, Germany, "sea", 0)
	fighter := s.addUnit(Fighter, SovietUnion, "sea", 0)
	destroyer := s.addUnit(Destroyer, SovietUnion, "sea", 0)
	battle, _ := NewBattle(s, "sea", Germany, &sequenceDice{values: []int{1, 6, 6, 6}})
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || !reflect.DeepEqual(battle.Pending.Eligible, []string{destroyer.ID}) {
		t.Fatalf("submarine hit eligibility=%#v; fighter=%s", battle.Pending, fighter.ID)
	}
}

func TestCombatAircraftMustHaveAggregateLandingCapacity(t *testing.T) {
	spaces := []Space{{ID: "land", Kind: "land", OriginalOwner: SovietUnion}, {ID: "approach", Kind: "sea"}, {ID: "carrier-sea", Kind: "sea"}, {ID: "battle-sea", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"land", "approach"}, {"approach", "carrier-sea"}, {"carrier-sea", "battle-sea"}})
	s.Phase = CombatMove
	s.addUnit(Carrier, SovietUnion, "carrier-sea", 0)
	s.addUnit(Fighter, SovietUnion, "carrier-sea", 0) // Occupies one of two slots.
	fighter1 := s.addUnit(Fighter, SovietUnion, "land", 0)
	fighter2 := s.addUnit(Fighter, SovietUnion, "land", 0)
	fighter3 := s.addUnit(Fighter, SovietUnion, "land", 0)
	plan := MovementPlan{Moves: []Move{{fighter1.ID, []string{"land", "approach", "carrier-sea", "battle-sea"}}, {fighter2.ID, []string{"land", "approach", "carrier-sea", "battle-sea"}}, {fighter3.ID, []string{"land", "approach", "carrier-sea", "battle-sea"}}}}
	if err := s.Move(plan); err == nil || !strings.Contains(err.Error(), "carrier capacity") {
		t.Fatalf("overcommitted carrier landing was accepted: %v", err)
	}
}

func TestFactoryProvidesStrategicBombingAAWithoutAAAUnit(t *testing.T) {
	s := mini([]Space{{ID: "target", Kind: "land", IPC: 3, OriginalOwner: SovietUnion}}, nil)
	s.Turn, s.Phase = 1, ConductCombat
	s.addUnit(Factory, SovietUnion, "target", 0)
	bomber := s.addUnit(Bomber, Germany, "target", 0)
	damage, err := s.StrategicBomb("target", []string{bomber.ID}, &sequenceDice{values: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if damage != 0 || s.Units[bomber.ID] != nil || len(s.Dice) != 1 || !strings.Contains(s.Dice[0].Purpose, "AAA") {
		t.Fatalf("built-in factory AA result damage=%d bomber=%v dice=%v", damage, s.Units[bomber.ID], s.Dice)
	}
}

func TestMixedAmphibiousRetreatContinuesAndFullRetreatRestoresSubmarines(t *testing.T) {
	spaces := []Space{{ID: "home", Kind: "land", OriginalOwner: Germany}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"home", "coast"}})
	amphibious := s.addUnit(Infantry, Germany, "coast", 0)
	amphibious.Amphibious = true
	tank := s.addUnit(Tank, Germany, "coast", 0)
	tank.CombatOrigin = "home"
	s.addUnit(Infantry, SovietUnion, "coast", 0)
	battle := &Battle{State: s, Territory: "coast", Attacker: Germany, stage: "retreat", Pending: &PendingDecision{Kind: ChooseRetreat, Power: Germany, Eligible: []string{tank.ID}, Options: []string{"home"}}}
	if err := battle.Retreat("home"); err != nil {
		t.Fatal(err)
	}
	if battle.Complete || battle.stage != "submerge" || tank.Space != "home" || !tank.Retreated || amphibious.Retreated {
		t.Fatalf("mixed retreat result complete=%v stage=%s tank=%#v amphibious=%#v", battle.Complete, battle.stage, tank, amphibious)
	}

	sea := mini([]Space{{ID: "battle", Kind: "sea"}, {ID: "safe", Kind: "sea"}}, [][2]string{{"battle", "safe"}})
	cruiser := sea.addUnit(Cruiser, Germany, "battle", 0)
	cruiser.CombatOrigin = "safe"
	sub := sea.addUnit(Submarine, Germany, "submerged:battle", 0)
	sea.addUnit(Cruiser, SovietUnion, "battle", 0)
	seaBattle := &Battle{State: sea, Territory: "battle", Attacker: Germany, stage: "retreat", Pending: &PendingDecision{Kind: ChooseRetreat, Power: Germany, Eligible: []string{cruiser.ID}, Options: []string{"safe"}}}
	if err := seaBattle.Retreat("safe"); err != nil {
		t.Fatal(err)
	}
	if !seaBattle.Complete || sub.Space != "battle" {
		t.Fatalf("full retreat complete=%v submerged space=%s", seaBattle.Complete, sub.Space)
	}
}

func TestCombatLandingCanReserveUnmovedCarrierNoncombatMove(t *testing.T) {
	spaces := []Space{{ID: "land", Kind: "land", OriginalOwner: SovietUnion}, {ID: "start", Kind: "sea"}, {ID: "catch", Kind: "sea"}, {ID: "battle", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"land", "battle"}, {"start", "catch"}, {"catch", "battle"}})
	s.Phase = CombatMove
	s.addUnit(Carrier, SovietUnion, "start", 0)
	fighter := s.addUnit(Fighter, SovietUnion, "land", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{fighter.ID, []string{"land", "battle"}}}}); err != nil {
		t.Fatalf("future carrier catch was rejected: %v", err)
	}
}

func TestAAAAndFactoryOnlyTerritoryFiresThenResolvesWithoutCombatRounds(t *testing.T) {
	spaces := []Space{{ID: "home", Kind: "land", OriginalOwner: Germany}, {ID: "target", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"home", "target"}})
	s.Turn, s.Phase = 1, CombatMove
	infantry := s.addUnit(Infantry, Germany, "home", 0)
	aaa := s.addUnit(AAA, SovietUnion, "target", 0)
	factory := s.addUnit(Factory, SovietUnion, "target", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{infantry.ID, []string{"home", "target"}}}}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.BattleTerritories(Germany), []string{"target"}) || s.Owners["target"] != SovietUnion {
		t.Fatalf("AAA defense was bypassed during combat movement: owner=%s battles=%v", s.Owners["target"], s.BattleTerritories(Germany))
	}
	s.Phase = ConductCombat
	battle, err := NewBattle(s, "target", Germany, &sequenceDice{})
	if err != nil || battle.Step() != nil {
		t.Fatalf("AAA-only battle failed: %v", err)
	}
	if !battle.Complete || s.Owners["target"] != Germany || aaa.Owner != Germany || factory.Owner != Germany || battle.Round != 0 {
		t.Fatalf("installation battle complete=%v round=%d owner=%s AAA=%s factory=%s", battle.Complete, battle.Round, s.Owners["target"], aaa.Owner, factory.Owner)
	}
}

func TestCapturedCapitalProhibitsPurchaseAndSkipsNextPurchasePhase(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	state := s.Powers[SovietUnion]
	state.CapitalHeld = false
	s.Powers[SovietUnion] = state
	if err := s.Purchase(PurchaseOrder{Units: map[UnitType]int{Infantry: 1}}); err == nil || !strings.Contains(err.Error(), "capital") {
		t.Fatalf("purchase without capital was accepted: %v", err)
	}
	s.Turn, s.Phase = len(TurnOrder)-1, CollectIncome
	s.Powers[SovietUnion] = state
	if err := s.Collect(); err != nil {
		t.Fatal(err)
	}
	if s.CurrentPower() != SovietUnion || s.Phase != CombatMove {
		t.Fatalf("captured-capital turn began at power=%s phase=%s", s.CurrentPower(), s.Phase)
	}
	s.Phase = NoncombatMove
	if err := s.AdvancePhase(); err != nil {
		t.Fatal(err)
	}
	if s.CurrentPower() != Germany || s.Phase != Purchase {
		t.Fatalf("captured-capital turn did not skip mobilization and collection: power=%s phase=%s", s.CurrentPower(), s.Phase)
	}
}

func TestTransportOwnerCarriesAlliedCargoButCannotUnloadIt(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"a", "b"}, {"b", "coast"}})
	s.Phase = CombatMove
	transport := s.addUnit(Transport, SovietUnion, "a", 0)
	cargo := s.addUnit(Infantry, UnitedKingdom, "", 0)
	cargo.TransportID = transport.ID
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}}); err != nil {
		t.Fatalf("transport owner could not carry allied cargo: %v", err)
	}
	if transport.Space != "b" || cargo.TransportID != transport.ID || cargo.Space != "" {
		t.Fatalf("allied cargo was not carried: transport=%#v cargo=%#v", transport, cargo)
	}

	s = mini(spaces, [][2]string{{"a", "b"}, {"b", "coast"}})
	s.Phase = NoncombatMove
	transport = s.addUnit(Transport, SovietUnion, "a", 0)
	cargo = s.addUnit(Infantry, UnitedKingdom, "", 0)
	cargo.TransportID = transport.ID
	plan := MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}, Transports: []TransportOrder{{transport.ID, []string{cargo.ID}, "coast"}}}
	if err := s.Move(plan); err == nil || !strings.Contains(err.Error(), "no cargo belonging to Soviet Union") {
		t.Fatalf("transport owner unloaded allied cargo: %v", err)
	}
}

func TestCargoOwnerUnloadsFromAlliedStationaryTransport(t *testing.T) {
	spaces := []Space{{ID: "sea", Kind: "sea"}, {ID: "other", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: UnitedKingdom}}
	s := mini(spaces, [][2]string{{"sea", "other"}, {"sea", "coast"}})
	s.Turn, s.Phase = 2, NoncombatMove
	transport := s.addUnit(Transport, SovietUnion, "sea", 0)
	ukCargo := s.addUnit(Infantry, UnitedKingdom, "", 0)
	sovietCargo := s.addUnit(Infantry, SovietUnion, "", 0)
	ukCargo.TransportID, sovietCargo.TransportID = transport.ID, transport.ID
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"sea", "other"}}}}); err == nil {
		t.Fatal("cargo owner moved an allied transport")
	}
	if err := s.Move(MovementPlan{Transports: []TransportOrder{{transport.ID, []string{ukCargo.ID}, "coast"}}}); err == nil || !strings.Contains(err.Error(), "all existing cargo") {
		t.Fatalf("incomplete allied manifest was accepted: %v", err)
	}
	plan := MovementPlan{Transports: []TransportOrder{{transport.ID, []string{ukCargo.ID, sovietCargo.ID}, "coast"}}}
	if err := s.Move(plan); err != nil {
		t.Fatalf("cargo owner could not unload from stationary allied transport: %v", err)
	}
	if transport.Space != "sea" || ukCargo.Space != "coast" || ukCargo.TransportID != "" || sovietCargo.TransportID != transport.ID || sovietCargo.Space != "" {
		t.Fatalf("allied unload result: transport=%#v UK=%#v Soviet=%#v", transport, ukCargo, sovietCargo)
	}
}

func TestPreloadedAAACanBeCarriedInCombatButCannotAmphibiouslyAssault(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}, {ID: "hostile", Kind: "land", OriginalOwner: Germany}}
	edges := [][2]string{{"a", "b"}, {"b", "hostile"}}
	s := mini(spaces, edges)
	s.Phase = CombatMove
	transport := s.addUnit(Transport, SovietUnion, "a", 0)
	aaa := s.addUnit(AAA, SovietUnion, "", 0)
	aaa.TransportID = transport.ID
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}}); err != nil {
		t.Fatalf("preloaded AAA could not be carried in combat movement: %v", err)
	}
	if transport.Space != "b" || aaa.TransportID != transport.ID {
		t.Fatalf("preloaded AAA carriage result: transport=%#v AAA=%#v", transport, aaa)
	}

	s = mini(spaces, edges)
	s.Phase = CombatMove
	transport = s.addUnit(Transport, SovietUnion, "a", 0)
	aaa = s.addUnit(AAA, SovietUnion, "", 0)
	aaa.TransportID = transport.ID
	plan := MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}, Transports: []TransportOrder{{transport.ID, []string{aaa.ID}, "hostile"}}}
	if err := s.Move(plan); err == nil || !strings.Contains(err.Error(), "AAA") {
		t.Fatalf("preloaded AAA joined an amphibious assault: %v", err)
	}
}

func TestNewAAACannotLoadAndMoveDuringCombatMove(t *testing.T) {
	spaces := []Space{{ID: "coast", Kind: "land", OriginalOwner: SovietUnion}, {ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"coast", "a"}, {"a", "b"}})
	s.Phase = CombatMove
	transport := s.addUnit(Transport, SovietUnion, "a", 0)
	aaa := s.addUnit(AAA, SovietUnion, "coast", 0)
	plan := MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}, Transports: []TransportOrder{{transport.ID, []string{aaa.ID}, ""}}}
	if err := s.Move(plan); err == nil || !strings.Contains(err.Error(), "cannot move before loading") {
		t.Fatalf("new AAA loaded during combat movement: %v", err)
	}
}

func TestSunkTransportRemovesAssaultCargoAndUsedWarshipCannotBombard(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}, [][2]string{{"sea", "coast"}})
	transport := s.addUnit(Transport, Germany, "sea", 0)
	cargo := s.addUnit(Infantry, Germany, "coast", 0)
	cargo.Amphibious, cargo.AssaultFrom = true, transport.ID
	battle := &Battle{State: s, Territory: "sea", Attacker: SovietUnion, Pending: &PendingDecision{Kind: ChooseCasualties, Power: Germany, Hits: 1, Eligible: []string{transport.ID}}}
	if err := battle.ChooseCasualties([]string{transport.ID}); err != nil {
		t.Fatal(err)
	}
	if s.Units[cargo.ID] != nil {
		t.Fatal("cargo from a sunk assault transport survived")
	}

	retreatState := mini([]Space{{ID: "battle", Kind: "sea"}, {ID: "safe", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}, [][2]string{{"battle", "safe"}, {"battle", "coast"}})
	retreatingTransport := retreatState.addUnit(Transport, Germany, "battle", 0)
	retreatingTransport.CombatOrigin = "safe"
	assaultUnit := retreatState.addUnit(Infantry, Germany, "coast", 0)
	assaultUnit.Amphibious, assaultUnit.AssaultFrom = true, retreatingTransport.ID
	retreatBattle := &Battle{State: retreatState, Territory: "battle", Attacker: Germany, Pending: &PendingDecision{Kind: ChooseRetreat, Power: Germany, Eligible: []string{retreatingTransport.ID}}}
	if err := retreatBattle.Retreat("safe"); err != nil {
		t.Fatal(err)
	}
	if assaultUnit.TransportID != retreatingTransport.ID || assaultUnit.Space != "" || assaultUnit.Amphibious {
		t.Fatal("cargo did not return aboard a retreating assault transport")
	}

	s2 := mini([]Space{{ID: "sea", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}, [][2]string{{"sea", "coast"}})
	s2.Turn = 1
	s2.Phase = ConductCombat
	attacker := s2.addUnit(Infantry, Germany, "coast", 0)
	attacker.Amphibious = true
	s2.addUnit(Infantry, SovietUnion, "coast", 0)
	cruiser := s2.addUnit(Cruiser, Germany, "sea", 0)
	cruiser.CombatUsed = true
	b2, _ := NewBattle(s2, "coast", Germany, &sequenceDice{values: []int{1, 6}}, cruiser.ID)
	if err := b2.Step(); err != nil {
		t.Fatal(err)
	}
	for _, roll := range b2.Rolls {
		if roll.Purpose == "shore bombardment" {
			t.Fatal("warship used in sea combat also bombarded")
		}
	}
}

func TestTwoSpaceAttackerRetreatsToActualEntryTerritory(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "land", OriginalOwner: Germany}, {ID: "b", Kind: "land", OriginalOwner: Germany}, {ID: "c", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"a", "b"}, {"b", "c"}})
	s.Turn = 1
	s.Phase = CombatMove
	tank := s.addUnit(Tank, Germany, "a", 0)
	s.addUnit(Infantry, SovietUnion, "c", 0)
	s.takeSnapshot()
	if err := s.Move(MovementPlan{Moves: []Move{{tank.ID, []string{"a", "b", "c"}}}}); err != nil {
		t.Fatal(err)
	}
	s.Phase = ConductCombat
	battle, _ := NewBattle(s, "c", Germany, &sequenceDice{values: []int{6, 6}})
	if err := battle.Step(); err != nil || battle.Pending == nil || battle.Pending.Kind != ChooseRetreat {
		t.Fatalf("retreat was not offered: err=%v pending=%#v", err, battle.Pending)
	}
	if err := battle.Retreat("b"); err != nil || tank.Space != "b" {
		t.Fatalf("retreat to entry territory failed: %v space=%s", err, tank.Space)
	}
}

func TestSubmarineTraversalDependsOnEnemyDestroyer(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}, {ID: "c", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"a", "b"}, {"b", "c"}})
	s.Phase = NoncombatMove
	sub := s.addUnit(Submarine, SovietUnion, "a", 0)
	s.addUnit(Cruiser, Germany, "b", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{sub.ID, []string{"a", "b", "c"}}}}); err != nil {
		t.Fatalf("submarine could not traverse enemy warship zone: %v", err)
	}
	sub.Space, sub.Moved = "a", 0
	s.addUnit(Destroyer, Germany, "b", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{sub.ID, []string{"a", "b", "c"}}}}); err == nil || !strings.Contains(err.Error(), "must stop") {
		t.Fatalf("submarine passed an enemy destroyer: %v", err)
	}
	if err := s.Move(MovementPlan{Moves: []Move{{sub.ID, []string{"a", "b"}}}}); err != nil {
		t.Fatalf("submarine could not end noncombat movement at enemy destroyer: %v", err)
	}
}

func TestStationaryTransportCanBridgeAndUnload(t *testing.T) {
	spaces := []Space{{ID: "from", Kind: "land", OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}, {ID: "to", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"from", "sea"}, {"sea", "to"}})
	s.Phase = NoncombatMove
	transport := s.addUnit(Transport, SovietUnion, "sea", 0)
	infantry := s.addUnit(Infantry, SovietUnion, "from", 0)
	plan := MovementPlan{Transports: []TransportOrder{{TransportID: transport.ID, LandUnits: []string{infantry.ID}, Unload: "to"}}}
	if err := s.Move(plan); err != nil {
		t.Fatal(err)
	}
	if infantry.Space != "to" || infantry.TransportID != "" || infantry.Amphibious || transport.Moved != UnitSpecs[Transport].Move {
		t.Fatalf("bridge result: infantry=%#v transport=%#v", infantry, transport)
	}
}

func TestEnemyOnlyTransportsCanBeIgnoredOrAutomaticallyDestroyed(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"a", "b"}})
	s.Phase = CombatMove
	destroyer := s.addUnit(Destroyer, SovietUnion, "a", 0)
	transport := s.addUnit(Transport, Germany, "b", 0)
	cargo := s.addUnit(Infantry, Germany, "", 0)
	cargo.TransportID = transport.ID
	move := Move{destroyer.ID, []string{"a", "b"}}
	if err := s.Move(MovementPlan{Moves: []Move{move}, IgnoreSeaZones: []string{"b"}}); err != nil {
		t.Fatal(err)
	}
	if s.Units[transport.ID] == nil || len(s.BattleTerritories(SovietUnion)) != 0 {
		t.Fatal("ignored transport was destroyed or declared as a battle")
	}

	destroyer.Space, destroyer.Moved, destroyer.CombatUsed = "a", 0, false
	transport.IgnoredBy = ""
	if err := s.Move(MovementPlan{Moves: []Move{move}}); err != nil {
		t.Fatal(err)
	}
	if s.Units[transport.ID] != nil || s.Units[cargo.ID] != nil || !destroyer.CombatUsed {
		t.Fatal("defenseless transport and cargo were not automatically destroyed")
	}
}

func TestTransportAccompanyingWarshipRemainsInBattle(t *testing.T) {
	s := mini([]Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}}, [][2]string{{"a", "b"}})
	s.Phase = CombatMove
	attacker := s.addUnit(Destroyer, SovietUnion, "a", 0)
	defender := s.addUnit(Cruiser, Germany, "b", 0)
	transport := s.addUnit(Transport, Germany, "b", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{attacker.ID, []string{"a", "b"}}}}); err != nil {
		t.Fatal(err)
	}
	if transport.IgnoredBy != "" {
		t.Fatal("transport accompanying a warship was incorrectly ignored")
	}
	forces, opposing := forces(s, "b", SovietUnion)
	if !reflect.DeepEqual(unitIDs(forces), []string{attacker.ID}) || !reflect.DeepEqual(unitIDs(opposing), []string{defender.ID, transport.ID}) {
		t.Fatalf("mixed naval battle forces: attackers=%v defenders=%v", unitIDs(forces), unitIDs(opposing))
	}
}

func TestBattleEndsWhenAircraftAndSubmarinesCannotTargetEachOther(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	s.Turn, s.Phase = 1, ConductCombat
	fighter := s.addUnit(Fighter, Germany, "sea", 0)
	submarine := s.addUnit(Submarine, SovietUnion, "sea", 0)
	battle, err := NewBattle(s, "sea", Germany, &sequenceDice{})
	if err != nil {
		t.Fatal(err)
	}
	battle.Started = true
	battle.stage = "opening"
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if !battle.Complete || battle.Winner != SovietUnion || len(battle.Rolls) != 0 {
		t.Fatalf("stalemate result: complete=%v winner=%s rolls=%v", battle.Complete, battle.Winner, battle.Rolls)
	}
	if s.Units[fighter.ID] == nil || s.Units[submarine.ID] == nil {
		t.Fatal("stalemate removed a surviving unit")
	}
}

func TestTransportAloneMustIgnoreEnemyStealthUnits(t *testing.T) {
	s := mini([]Space{{ID: "a", Kind: "sea"}, {ID: "b", Kind: "sea"}}, [][2]string{{"a", "b"}})
	s.Phase = CombatMove
	transport := s.addUnit(Transport, SovietUnion, "a", 0)
	submarine := s.addUnit(Submarine, Germany, "b", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{transport.ID, []string{"a", "b"}}}}); err != nil {
		t.Fatal(err)
	}
	if submarine.IgnoredBy != SovietUnion || len(s.BattleTerritories(SovietUnion)) != 0 {
		t.Fatal("transport initiated a prohibited unaccompanied sea battle")
	}
}

func TestAircraftRemainInBattleSpaceWhenSurfaceUnitsRetreat(t *testing.T) {
	spaces := []Space{{ID: "home", Kind: "land", OriginalOwner: Germany}, {ID: "battle", Kind: "land", OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"home", "battle"}, {"sea", "battle"}})
	s.Turn, s.Phase = 1, ConductCombat
	infantry := s.addUnit(Infantry, Germany, "battle", 0)
	infantry.CombatOrigin = "home"
	fighter := s.addUnit(Fighter, Germany, "battle", 0)
	s.addUnit(Infantry, SovietUnion, "battle", 0)
	battle := &Battle{State: s, Territory: "battle", Attacker: Germany, Pending: &PendingDecision{Kind: ChooseRetreat, Power: Germany, Eligible: []string{infantry.ID, fighter.ID}, Options: []string{"home"}}}
	if err := battle.Retreat("sea"); err == nil {
		t.Fatal("land units retreated to a sea zone")
	}
	if err := battle.Retreat("home"); err != nil {
		t.Fatal(err)
	}
	if infantry.Space != "home" || fighter.Space != "battle" {
		t.Fatalf("retreat locations: infantry=%s fighter=%s", infantry.Space, fighter.Space)
	}
}

func TestRetreatedAircraftDoesNotRejoinMixedAmphibiousCombat(t *testing.T) {
	spaces := []Space{{ID: "home", Kind: "land", OriginalOwner: Germany}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"home", "coast"}})
	s.Turn, s.Phase = 1, ConductCombat
	infantry := s.addUnit(Infantry, Germany, "coast", 0)
	infantry.Amphibious = true
	fighter := s.addUnit(Fighter, Germany, "coast", 0)
	fighter.Retreated = true
	defender := s.addUnit(Infantry, SovietUnion, "coast", 0)
	battle, err := NewBattle(s, "coast", Germany, &sequenceDice{values: []int{6, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := battle.Step(); err != nil {
		t.Fatal(err)
	}
	if battle.Pending == nil || !reflect.DeepEqual(battle.Pending.Eligible, []string{infantry.ID}) {
		t.Fatalf("retreated fighter remained a casualty or combat participant: %#v", battle.Pending)
	}
	for _, roll := range battle.Rolls {
		if strings.Contains(roll.Purpose, string(Fighter)) {
			t.Fatalf("retreated fighter rolled in combat: %#v", battle.Rolls)
		}
	}
	if err := battle.ChooseCasualties([]string{infantry.ID}); err != nil {
		t.Fatal(err)
	}
	if s.Units[fighter.ID] == nil || fighter.Space != "coast" || !fighter.Retreated || s.Units[defender.ID] == nil {
		t.Fatal("retreated fighter was not preserved for landing")
	}
	s.Phase = NoncombatMove
	if err := s.Move(MovementPlan{Moves: []Move{{UnitID: fighter.ID, Path: []string{"coast", "home"}}}}); err != nil {
		t.Fatalf("retreated fighter could not make its noncombat landing: %v", err)
	}
}

func TestSeaPlacementFindsNonGreedyFactoryAllocation(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "land", IPC: 1, OriginalOwner: SovietUnion}, {ID: "b", Kind: "land", IPC: 1, OriginalOwner: SovietUnion}, {ID: "shared", Kind: "sea"}, {ID: "only-a", Kind: "sea"}}
	s := mini(spaces, [][2]string{{"a", "shared"}, {"b", "shared"}, {"a", "only-a"}})
	s.addUnit(Factory, SovietUnion, "a", 0)
	s.addUnit(Factory, SovietUnion, "b", 0)
	s.Phase = Mobilize
	s.Purchased = []UnitType{Destroyer, Submarine}
	placements := []Placement{{Type: Destroyer, Space: "shared", Count: 1}, {Type: Submarine, Space: "only-a", Count: 1}}
	if err := s.Place(placements); err != nil {
		t.Fatalf("valid combined allocation rejected: %v", err)
	}
}

func TestRepeatedPlacementCommandsShareFactoryCapacity(t *testing.T) {
	s := mini([]Space{{ID: "home", Kind: "land", IPC: 1, OriginalOwner: SovietUnion}}, nil)
	s.addUnit(Factory, SovietUnion, "home", 0)
	s.Phase = Mobilize
	s.Purchased = []UnitType{Infantry, Infantry}
	if err := s.Place([]Placement{{Type: Infantry, Space: "home", Count: 1}}); err != nil {
		t.Fatal(err)
	}
	before := len(s.Units)
	if err := s.Place([]Placement{{Type: Infantry, Space: "home", Count: 1}}); err == nil || !strings.Contains(err.Error(), "capacity") {
		t.Fatalf("repeated placement bypassed capacity: %v", err)
	}
	if len(s.Units) != before || len(s.Purchased) != 1 {
		t.Fatal("rejected repeated placement mutated state")
	}
}

func TestStationaryTransportCannotFerryTwice(t *testing.T) {
	spaces := []Space{{ID: "from", Kind: "land", OriginalOwner: SovietUnion}, {ID: "sea", Kind: "sea"}, {ID: "one", Kind: "land", OriginalOwner: SovietUnion}, {ID: "two", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"from", "sea"}, {"sea", "one"}, {"sea", "two"}})
	s.Phase = NoncombatMove
	transport := s.addUnit(Transport, SovietUnion, "sea", 0)
	first := s.addUnit(Infantry, SovietUnion, "from", 0)
	second := s.addUnit(Infantry, SovietUnion, "from", 0)
	if err := s.Move(MovementPlan{Transports: []TransportOrder{{TransportID: transport.ID, LandUnits: []string{first.ID}, Unload: "one"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Move(MovementPlan{Transports: []TransportOrder{{TransportID: transport.ID, LandUnits: []string{second.ID}, Unload: "two"}}}); err == nil || !strings.Contains(err.Error(), "already unloaded") {
		t.Fatalf("transport ferried twice: %v", err)
	}
	if second.Space != "from" || transport.Moved != UnitSpecs[Transport].Move {
		t.Fatal("second ferry rejection was not atomic")
	}
}

func TestUndefendedAmphibiousLandingCapturesTerritory(t *testing.T) {
	spaces := []Space{{ID: "from", Kind: "land", OriginalOwner: Germany}, {ID: "sea", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"from", "sea"}, {"sea", "coast"}})
	s.Turn, s.Phase = 1, CombatMove
	transport := s.addUnit(Transport, Germany, "sea", 0)
	infantry := s.addUnit(Infantry, Germany, "from", 0)
	plan := MovementPlan{Transports: []TransportOrder{{TransportID: transport.ID, LandUnits: []string{infantry.ID}, Unload: "coast"}}}
	if err := s.Move(plan); err != nil {
		t.Fatal(err)
	}
	if s.Owners["coast"] != Germany || infantry.Space != "coast" {
		t.Fatal("undefended amphibious landing did not capture")
	}
}

func TestAircraftAloneDoNotCaptureLandAfterBattle(t *testing.T) {
	s := mini([]Space{{ID: "front", Kind: "land", OriginalOwner: SovietUnion}}, nil)
	s.Turn, s.Phase = 1, ConductCombat
	s.addUnit(Fighter, Germany, "front", 0)
	defender := s.addUnit(Infantry, SovietUnion, "front", 0)
	battle, err := NewBattle(s, "front", Germany, &sequenceDice{values: []int{1, 6}})
	if err != nil || battle.Step() != nil {
		t.Fatalf("battle setup failed: %v", err)
	}
	if err := battle.ChooseCasualties([]string{defender.ID}); err != nil {
		t.Fatal(err)
	}
	if !battle.Complete || battle.Winner != Germany || s.Owners["front"] != SovietUnion {
		t.Fatalf("air-only result winner=%s owner=%s", battle.Winner, s.Owners["front"])
	}
}

func TestBombardmentRequiresAssaultSeaAndCannotBeReused(t *testing.T) {
	spaces := []Space{{ID: "assault", Kind: "sea"}, {ID: "other", Kind: "sea"}, {ID: "coast", Kind: "land", OriginalOwner: SovietUnion}, {ID: "coast2", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"assault", "coast"}, {"other", "coast"}, {"assault", "coast2"}})
	s.Turn, s.Phase = 1, ConductCombat
	transport := s.addUnit(Transport, Germany, "assault", 0)
	land := s.addUnit(Infantry, Germany, "coast", 0)
	land.Amphibious, land.AssaultFrom = true, transport.ID
	s.addUnit(Infantry, SovietUnion, "coast", 0)
	valid := s.addUnit(Cruiser, Germany, "assault", 0)
	wrong := s.addUnit(Cruiser, Germany, "other", 0)
	battle, _ := NewBattle(s, "coast", Germany, &sequenceDice{values: []int{6}}, wrong.ID, valid.ID, valid.ID)
	battle.fireBombardment()
	if len(battle.Rolls) != 1 || wrong.CombatUsed || !valid.CombatUsed {
		t.Fatalf("bombardment rolls=%v wrongUsed=%v validUsed=%v", battle.Rolls, wrong.CombatUsed, valid.CombatUsed)
	}
	land2 := s.addUnit(Infantry, Germany, "coast2", 0)
	land2.Amphibious, land2.AssaultFrom = true, transport.ID
	s.addUnit(Infantry, SovietUnion, "coast2", 0)
	second, _ := NewBattle(s, "coast2", Germany, &sequenceDice{}, valid.ID)
	second.fireBombardment()
	if len(second.Rolls) != 0 {
		t.Fatal("warship bombarded a second territory")
	}
}

func TestCapitalLiberationOnlyReassignsFactoriesInLiberatedTerritories(t *testing.T) {
	spaces := []Space{{ID: "capital", Kind: "land", OriginalOwner: SovietUnion, Capital: true}, {ID: "liberated", Kind: "land", OriginalOwner: SovietUnion}, {ID: "occupied", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, nil)
	s.Owners["capital"], s.Owners["liberated"], s.Owners["occupied"] = Germany, UnitedKingdom, Germany
	s.Powers[SovietUnion] = PowerState{CapitalHeld: false}
	liberatedFactory := s.addUnit(Factory, UnitedKingdom, "liberated", 0)
	occupiedFactory := s.addUnit(Factory, Germany, "occupied", 0)
	s.Capture("capital", UnitedKingdom)
	if liberatedFactory.Owner != SovietUnion || occupiedFactory.Owner != Germany || s.Owners["occupied"] != Germany {
		t.Fatalf("factory owners liberated=%s occupied=%s", liberatedFactory.Owner, occupiedFactory.Owner)
	}
}

func TestAircraftCannotLandInTerritoryCapturedThisTurn(t *testing.T) {
	s := mini([]Space{{ID: "captured", Kind: "land", OriginalOwner: Germany}}, nil)
	s.Owners["captured"] = SovietUnion
	s.Phase = NoncombatMove
	s.addUnit(Fighter, SovietUnion, "captured", 0)
	if err := s.AdvancePhase(); err == nil || !strings.Contains(err.Error(), "has not landed") {
		t.Fatalf("aircraft landed in newly captured territory: %v", err)
	}
}

func TestEnemyFactoryDoesNotBlockBlitz(t *testing.T) {
	spaces := []Space{{ID: "a", Kind: "land", OriginalOwner: Germany}, {ID: "b", Kind: "land", OriginalOwner: SovietUnion}, {ID: "c", Kind: "land", OriginalOwner: SovietUnion}}
	s := mini(spaces, [][2]string{{"a", "b"}, {"b", "c"}})
	s.Turn, s.Phase = 1, CombatMove
	s.addUnit(Factory, SovietUnion, "b", 0)
	tank := s.addUnit(Tank, Germany, "a", 0)
	if err := s.Move(MovementPlan{Moves: []Move{{UnitID: tank.ID, Path: []string{"a", "b", "c"}}}}); err != nil {
		t.Fatalf("factory blocked blitz: %v", err)
	}
	if tank.Space != "c" || s.Owners["b"] != Germany || s.Owners["c"] != Germany {
		t.Fatal("blitz did not capture both territories")
	}
}

func TestMultinationalCombatUnitsMustBeCasualtiesBeforeTransports(t *testing.T) {
	s := mini([]Space{{ID: "sea", Kind: "sea"}}, nil)
	transport := s.addUnit(Transport, Germany, "sea", 0)
	destroyer := s.addUnit(Destroyer, Japan, "sea", 0)
	battle := &Battle{
		State:   s,
		Pending: &PendingDecision{Kind: ChooseCasualties, Power: Germany, Hits: 1, MinHits: 0, Eligible: []string{transport.ID}, Group: 1},
		queue:   []PendingDecision{{Kind: ChooseCasualties, Power: Japan, Hits: 1, Eligible: []string{destroyer.ID}, Group: 1}},
	}
	if err := battle.ChooseCasualties([]string{transport.ID}); err == nil || !strings.Contains(err.Error(), "transports") {
		t.Fatalf("multinational transport selected first: %v", err)
	}
	if s.Units[transport.ID] == nil || s.Units[destroyer.ID] == nil {
		t.Fatal("rejected casualty choice mutated units")
	}
}
