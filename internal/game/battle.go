package game

import (
	"fmt"
	"sort"
)

type Dice interface{ Roll(count int) []int }

type DiceRoll struct {
	Purpose string `json:"purpose"`
	Results []int  `json:"results"`
	// Target is the number a die must not exceed to score a hit. Recorded so
	// clients can show which dice hit without re-deriving the value, which they
	// cannot do correctly for artillery-supported infantry.
	Target int `json:"target,omitempty"`
}

type DecisionKind string

const (
	ChooseCasualties     DecisionKind = "choose-casualties"
	ChooseSubmerge       DecisionKind = "choose-submerge"
	ChooseRetreat        DecisionKind = "choose-retreat"
	ChooseFighterLanding DecisionKind = "choose-fighter-landing"
)

type PendingDecision struct {
	Kind         DecisionKind        `json:"kind"`
	Power        Power               `json:"power,omitempty"`
	Hits         int                 `json:"hits,omitempty"`
	Eligible     []string            `json:"eligible,omitempty"`
	Destinations map[string][]string `json:"destinations,omitempty"`
	Options      []string            `json:"options,omitempty"`
	MinHits      int                 `json:"minHits,omitempty"`
	Group        int                 `json:"group,omitempty"`
}

// BattleSnapshot is the persistence-safe representation of an in-progress battle.
type BattleSnapshot struct {
	Territory      string            `json:"territory"`
	Attacker       Power             `json:"attacker"`
	Round          int               `json:"round"`
	Pending        *PendingDecision  `json:"pendingDecision,omitempty"`
	Complete       bool              `json:"complete"`
	Winner         Power             `json:"winner,omitempty"`
	Bombarders     []string          `json:"bombarders,omitempty"`
	Stage          string            `json:"stage"`
	QueuedHits     int               `json:"queuedHits,omitempty"`
	QueuedPower    Power             `json:"queuedPower,omitempty"`
	QueuedEligible []string          `json:"queuedEligible,omitempty"`
	Queue          []PendingDecision `json:"decisionQueue,omitempty"`
	Rolls          []DiceRoll        `json:"diceTranscript,omitempty"`
	AfterQueue     string            `json:"afterDecisionQueue,omitempty"`
	Started        bool              `json:"started,omitempty"`
	NextGroup      int               `json:"nextDecisionGroup,omitempty"`
}

func (b *Battle) Snapshot() BattleSnapshot {
	return BattleSnapshot{
		Territory: b.Territory, Attacker: b.Attacker, Round: b.Round,
		Pending: b.Pending, Complete: b.Complete, Winner: b.Winner,
		Bombarders: b.Bombarders, Stage: b.stage, QueuedHits: b.queuedHits,
		QueuedPower: b.queuedPower, QueuedEligible: b.queuedEligible,
		Queue: append([]PendingDecision(nil), b.queue...), Rolls: append([]DiceRoll(nil), b.Rolls...), AfterQueue: b.afterQueue, Started: b.Started, NextGroup: b.nextGroup,
	}
}

func RestoreBattle(s *State, snapshot BattleSnapshot, dice Dice) (*Battle, error) {
	if s == nil || dice == nil || snapshot.Territory == "" || snapshot.Attacker == "" || snapshot.Stage == "" {
		return nil, fmt.Errorf("invalid battle snapshot")
	}
	b := &Battle{
		State: s, Territory: snapshot.Territory, Attacker: snapshot.Attacker,
		Round: snapshot.Round, Pending: snapshot.Pending, Complete: snapshot.Complete,
		Winner: snapshot.Winner, Bombarders: snapshot.Bombarders, dice: dice,
		stage: snapshot.Stage, queuedHits: snapshot.QueuedHits,
		queuedPower: snapshot.QueuedPower, queuedEligible: snapshot.QueuedEligible,
		queue: append([]PendingDecision(nil), snapshot.Queue...), Rolls: append([]DiceRoll(nil), snapshot.Rolls...), afterQueue: snapshot.AfterQueue,
		Started:   snapshot.Started,
		nextGroup: snapshot.NextGroup,
	}
	if b.queuedHits > 0 && len(b.queue) == 0 {
		b.queue = append(b.queue, PendingDecision{Kind: ChooseCasualties, Power: b.queuedPower, Hits: b.queuedHits, Eligible: b.queuedEligible})
		b.queuedHits, b.queuedPower, b.queuedEligible = 0, "", nil
	}
	return b, nil
}

type Battle struct {
	State          *State
	Territory      string
	Attacker       Power
	Round          int
	Pending        *PendingDecision
	Complete       bool
	Winner         Power
	Bombarders     []string
	Started        bool
	dice           Dice
	stage          string
	queuedHits     int
	queuedPower    Power
	queuedEligible []string
	queue          []PendingDecision
	Rolls          []DiceRoll
	afterQueue     string
	nextGroup      int
}

func NewBattle(s *State, territory string, attacker Power, dice Dice, bombarders ...string) (*Battle, error) {
	if s.Phase != ConductCombat {
		return nil, fmt.Errorf("battles are only conducted during %s", ConductCombat)
	}
	if dice == nil {
		return nil, fmt.Errorf("dice source is required")
	}
	space, ok := s.Board.Spaces[territory]
	if !ok {
		return nil, fmt.Errorf("unknown battle territory %s", territory)
	}
	attackers, defenders := forces(s, territory, attacker)
	if len(attackers) == 0 || len(defenders) == 0 {
		return nil, fmt.Errorf("battle requires opposing forces")
	}
	if space.Kind == "land" {
		for _, u := range attackers {
			if UnitSpecs[u.Type].Domain == "sea" {
				return nil, fmt.Errorf("ships cannot fight in a land territory")
			}
		}
	}
	b := &Battle{State: s, Territory: territory, Attacker: attacker, dice: dice, stage: "aaa", Bombarders: bombarders}
	return b, nil
}

// Start locks the optional bombardment selection before any battle dice roll.
func (b *Battle) Start(bombarders []string) error {
	if b.Started || b.Round != 0 || b.Pending != nil || b.stage != "aaa" {
		return fmt.Errorf("battle has already started")
	}
	amphibious := 0
	for _, u := range b.State.UnitsAt(b.Territory) {
		if u.Owner == b.Attacker && u.Amphibious {
			amphibious++
		}
	}
	if len(bombarders) > amphibious {
		return fmt.Errorf("bombardment cannot exceed amphibious units")
	}
	seen := map[string]bool{}
	for _, id := range bombarders {
		u := b.State.Units[id]
		if seen[id] || u == nil || u.Owner != b.Attacker || u.CombatUsed || (u.Type != Cruiser && u.Type != Battleship) || !b.bombarderSharesAssaultSea(u.Space) {
			return fmt.Errorf("unit %s cannot bombard %s", id, b.Territory)
		}
		seen[id] = true
	}
	b.Bombarders = append([]string(nil), bombarders...)
	b.Started = true
	return nil
}

func forces(s *State, territory string, attacker Power) (attackers, defenders []*Unit) {
	for _, u := range s.UnitsAt(territory) {
		if u.Type == Factory || u.Raided || u.Retreated {
			continue
		}
		if u.Owner == attacker {
			attackers = append(attackers, u)
		} else if !s.Allied(u.Owner, attacker) && u.IgnoredBy != attacker {
			defenders = append(defenders, u)
		}
	}
	return
}

// Step advances until player input is needed or the battle completes.
func (b *Battle) Step() error {
	if b.Complete {
		return nil
	}
	if b.Pending != nil {
		return fmt.Errorf("decision %s is pending", b.Pending.Kind)
	}
	attackers, _ := forces(b.State, b.Territory, b.Attacker)
	for _, u := range attackers {
		u.CombatUsed = true
	}
	b.checkFinished()
	for b.Pending == nil && !b.Complete {
		switch b.stage {
		case "aaa":
			b.fireAAA()
		case "bombard":
			b.fireBombardment()
		case "opening":
			b.fireOpening()
		case "regular":
			b.fireRegular()
		case "queued":
			b.presentQueued()
		case "submerge":
			b.offerSubmerge(true)
		case "submerge-defender":
			b.offerSubmerge(false)
		case "retreat":
			b.offerRetreat()
		default:
			return fmt.Errorf("invalid battle stage %s", b.stage)
		}
	}
	return nil
}

func (b *Battle) roll(purpose string, count int, target int) []int {
	results := b.dice.Roll(count)
	if count > 0 {
		copyResults := append([]int(nil), results...)
		b.Rolls = append(b.Rolls, DiceRoll{Purpose: purpose, Results: copyResults, Target: target})
	}
	return results
}

func (b *Battle) fireAAA() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	air, guns := []string{}, 0
	for _, u := range attackers {
		if UnitSpecs[u.Type].Domain == "air" {
			air = append(air, u.ID)
		}
	}
	for _, u := range defenders {
		if u.Type == AAA {
			guns++
		}
	}
	dice := min(len(air), guns*3)
	hits := countHits(b.roll("AAA fire", dice, 1), 1)
	b.stage = "bombard"
	if hits > 0 {
		b.Pending = &PendingDecision{Kind: ChooseCasualties, Power: b.Attacker, Hits: hits, Eligible: air}
	} else {
		b.resolveNoncombatDefenders()
	}
}

func (b *Battle) resolveNoncombatDefenders() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	if !containsCapturingLandUnit(attackers) {
		return
	}
	for _, u := range defenders {
		if u.Type != AAA {
			return
		}
	}
	b.State.capture(b.Territory, b.Attacker)
	b.checkFinished()
}

func (b *Battle) fireBombardment() {
	eligible := b.defenderIDs(nil)
	hits := 0
	amphibious := 0
	for _, u := range b.State.UnitsAt(b.Territory) {
		if u.Owner == b.Attacker && u.Amphibious {
			amphibious++
		}
	}
	used := 0
	for _, id := range b.Bombarders {
		u := b.State.Units[id]
		if used == amphibious {
			break
		}
		if u == nil || u.Owner != b.Attacker || u.CombatUsed || (u.Type != Cruiser && u.Type != Battleship) || !b.bombarderSharesAssaultSea(u.Space) {
			continue
		}
		u.CombatUsed = true
		if countHits(b.roll("shore bombardment", 1, UnitSpecs[u.Type].Attack), UnitSpecs[u.Type].Attack) == 1 {
			hits++
		}
		used++
	}
	b.stage = "submerge"
	if hits > 0 {
		b.afterQueue = "submerge"
		b.enqueueCasualties(hits, eligible)
		b.presentNextDecision()
	}
}

func (b *Battle) bombarderSharesAssaultSea(sea string) bool {
	for _, u := range b.State.UnitsAt(b.Territory) {
		if u.Owner != b.Attacker || !u.Amphibious || u.AssaultFrom == "" {
			continue
		}
		if transport := b.State.Units[u.AssaultFrom]; transport != nil && transport.Space == sea {
			return true
		}
	}
	return false
}

func (b *Battle) fireOpening() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	attackSubs, defendSubs := filterType(attackers, Submarine), filterType(defenders, Submarine)
	attackHits, defendHits := 0, 0
	if !containsType(defenders, Destroyer) {
		attackHits = b.rollUnits(attackSubs, true, "attacking submarine surprise strike")
	}
	if !containsType(attackers, Destroyer) {
		defendHits = b.rollUnits(defendSubs, false, "defending submarine surprise strike")
	}
	b.stage = "regular"
	b.afterQueue = "regular"
	if attackHits > 0 {
		b.enqueueCasualties(attackHits, idsSea(defenders))
	}
	if defendHits > 0 {
		b.enqueueCasualties(defendHits, idsSea(attackers))
	}
	b.presentNextDecision()
}

func (b *Battle) fireRegular() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	attackRollers := withoutSurpriseSubs(attackers, containsType(defenders, Destroyer))
	defendRollers := withoutSurpriseSubs(defenders, containsType(attackers, Destroyer))
	attackGroups := b.rollGroups(attackRollers, true, containsType(attackRollers, Destroyer), "attacker regular fire")
	defendGroups := b.rollGroups(defendRollers, false, containsType(defendRollers, Destroyer), "defender regular fire")
	b.Round++
	b.stage = "retreat"
	b.afterQueue = "retreat"
	for _, group := range attackGroups {
		b.enqueueCasualties(group.hits, eligibleTargets(defenders, group.restriction))
	}
	for _, group := range defendGroups {
		b.enqueueCasualties(group.hits, eligibleTargets(attackers, group.restriction))
	}
	b.presentNextDecision()
	if b.Pending == nil {
		b.checkFinished()
	}
}

func (b *Battle) presentQueued() {
	b.presentNextDecision()
}

func (b *Battle) enqueueCasualties(hits int, eligible []string) {
	if hits <= 0 || len(eligible) == 0 {
		return
	}
	byPower := map[Power][]string{}
	for _, id := range eligible {
		u := b.State.Units[id]
		if u != nil {
			byPower[u.Owner] = append(byPower[u.Owner], id)
		}
	}
	b.nextGroup++
	for _, power := range TurnOrder {
		if len(byPower[power]) > 0 {
			b.queue = append(b.queue, PendingDecision{Kind: ChooseCasualties, Power: power, Hits: hits, Eligible: byPower[power], Group: b.nextGroup})
		}
	}
}

func (b *Battle) presentNextDecision() {
	if b.Pending != nil {
		return
	}
	for len(b.queue) > 0 && b.queue[0].Kind == ChooseCasualties && b.queue[0].Group > 0 && b.queue[0].Hits == 0 {
		b.queue = b.queue[1:]
	}
	if len(b.queue) == 0 {
		return
	}
	next := b.queue[0]
	b.queue = b.queue[1:]
	if next.Kind == ChooseCasualties && next.Group > 0 {
		capacity := casualtyCapacity(b.State, next.Eligible)
		laterCapacity := 0
		for _, queued := range b.queue {
			if queued.Kind == ChooseCasualties && queued.Group == next.Group {
				laterCapacity += casualtyCapacity(b.State, queued.Eligible)
			}
		}
		next.MinHits = min(capacity, max(0, next.Hits-laterCapacity))
		next.Hits = min(next.Hits, capacity)
	}
	b.Pending = &next
	b.stage = "queued"
}

func (b *Battle) ChooseCasualties(ids []string) error {
	p := b.Pending
	if p == nil || p.Kind != ChooseCasualties {
		return fmt.Errorf("no casualties are pending")
	}
	capacity := 0
	for _, id := range p.Eligible {
		if u := b.State.Units[id]; u != nil {
			capacity++
			if u.Type == Battleship && u.Damage == 0 {
				capacity++
			}
		}
	}
	expected := min(p.Hits, capacity)
	if p.Group > 0 {
		minimum := min(p.MinHits, expected)
		if len(ids) < minimum || len(ids) > expected {
			return fmt.Errorf("must assign between %d and %d hits", minimum, expected)
		}
	} else if len(ids) != expected && (p.Power != "" || len(ids) < 1 || len(ids) > expected) {
		return fmt.Errorf("must assign %d hits", expected)
	}
	allowed, chosen := map[string]int{}, map[string]bool{}
	for _, id := range p.Eligible {
		allowed[id] = 1
		if u := b.State.Units[id]; u != nil && u.Type == Battleship && u.Damage == 0 {
			allowed[id] = 2
		}
	}
	for _, id := range ids {
		if allowed[id] == 0 {
			return fmt.Errorf("unit %s is not an eligible casualty", id)
		}
		u := b.State.Units[id]
		if p.Power != "" && u.Owner != p.Power {
			return fmt.Errorf("unit %s is not controlled by %s", id, p.Power)
		}
		if u.Type == Transport && b.hasUnchosenCombatUnit(p, chosen) {
			return fmt.Errorf("defenseless transports must be chosen last")
		}
		allowed[id]--
		chosen[id] = true
	}
	for _, id := range ids {
		u := b.State.Units[id]
		if u.Type == Battleship && u.Damage == 0 {
			u.Damage = 1
		} else {
			if u.Type == Transport {
				for cargoID, cargo := range b.State.Units {
					if cargo.TransportID == id || cargo.AssaultFrom == id {
						delete(b.State.Units, cargoID)
					}
				}
			}
			delete(b.State.Units, id)
		}
	}
	if p.Group > 0 {
		for i := range b.queue {
			if b.queue[i].Kind == ChooseCasualties && b.queue[i].Group == p.Group {
				b.queue[i].Hits -= len(ids)
			}
		}
	} else if len(ids) < expected {
		b.Pending.Hits -= len(ids)
		return nil
	}
	b.Pending = nil
	if len(b.queue) > 0 {
		b.presentNextDecision()
	} else {
		if b.stage == "queued" {
			b.stage = b.afterQueue
		}
		if b.stage == "bombard" {
			b.resolveNoncombatDefenders()
			if b.Complete {
				return nil
			}
		}
		b.checkFinished()
	}
	return nil
}

func (b *Battle) hasUnchosenCombatUnit(p *PendingDecision, chosen map[string]bool) bool {
	if hasUnchosenCombatUnit(b.State, p.Eligible, chosen) {
		return true
	}
	for _, queued := range b.queue {
		if p.Group > 0 && queued.Kind == ChooseCasualties && queued.Group == p.Group && hasUnchosenCombatUnit(b.State, queued.Eligible, nil) {
			return true
		}
	}
	return false
}

func casualtyCapacity(s *State, eligible []string) int {
	capacity := 0
	for _, id := range eligible {
		if u := s.Units[id]; u != nil {
			capacity++
			if u.Type == Battleship && u.Damage == 0 {
				capacity++
			}
		}
	}
	return capacity
}

func (b *Battle) offerSubmerge(attacking bool) {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	byPower := map[Power][]string{}
	if attacking && !containsType(defenders, Destroyer) {
		for _, u := range attackers {
			if u.Type == Submarine {
				byPower[u.Owner] = append(byPower[u.Owner], u.ID)
			}
		}
	}
	if !attacking && !containsType(attackers, Destroyer) {
		for _, u := range defenders {
			if u.Type == Submarine {
				byPower[u.Owner] = append(byPower[u.Owner], u.ID)
			}
		}
	}
	nextStage := "opening"
	if attacking {
		nextStage = "submerge-defender"
	}
	b.stage = nextStage
	b.afterQueue = nextStage
	for _, power := range TurnOrder {
		if len(byPower[power]) > 0 {
			b.queue = append(b.queue, PendingDecision{Kind: ChooseSubmerge, Power: power, Eligible: byPower[power]})
		}
	}
	b.presentNextDecision()
}

func (b *Battle) Submerge(ids []string) error {
	if b.Pending == nil || b.Pending.Kind != ChooseSubmerge {
		return fmt.Errorf("no submerge decision is pending")
	}
	allowed := map[string]bool{}
	for _, id := range b.Pending.Eligible {
		allowed[id] = true
	}
	for _, id := range ids {
		if !allowed[id] {
			return fmt.Errorf("submarine %s cannot submerge", id)
		}
		b.State.Units[id].Space = "submerged:" + b.Territory
	}
	b.Pending = nil
	if len(b.queue) > 0 {
		b.presentNextDecision()
	} else if b.stage == "queued" {
		b.stage = b.afterQueue
	}
	b.checkFinished()
	return nil
}

// LandFighter resolves one excess defending fighter after its carrier was
// destroyed. A fighter with no listed destination is destroyed.
func (b *Battle) LandFighter(id, destination string) error {
	p := b.Pending
	if p == nil || p.Kind != ChooseFighterLanding {
		return fmt.Errorf("no fighter landing decision is pending")
	}
	allowed := false
	for _, eligible := range p.Eligible {
		allowed = allowed || eligible == id
	}
	if !allowed {
		return fmt.Errorf("fighter %s cannot be landed", id)
	}
	u := b.State.Units[id]
	if u == nil || u.Type != Fighter || u.Space != b.Territory {
		return fmt.Errorf("fighter %s cannot be landed", id)
	}
	options := p.Destinations[id]
	if destination == "" {
		if len(options) != 0 {
			return fmt.Errorf("fighter %s has a legal landing space", id)
		}
		delete(b.State.Units, id)
	} else {
		for _, option := range options {
			if option == destination {
				u.Space = destination
				allowed = true
				b.Pending = nil
				b.checkFinished()
				return nil
			}
		}
		return fmt.Errorf("fighter %s cannot land in %s", id, destination)
	}
	b.Pending = nil
	b.checkFinished()
	return nil
}

func (b *Battle) offerRetreat() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	_ = defenders
	var eligible []string
	for _, u := range attackers {
		if !u.Amphibious {
			eligible = append(eligible, u.ID)
		}
	}
	options := b.retreatDestinations(eligible)
	hasAir := false
	for _, id := range eligible {
		hasAir = hasAir || UnitSpecs[b.State.Units[id].Type].Domain == "air"
	}
	if len(eligible) == 0 || len(options) == 0 && !hasAir {
		b.stage = "regular"
		return
	}
	b.Pending = &PendingDecision{Kind: ChooseRetreat, Power: b.Attacker, Eligible: eligible, Options: options}
}

func (b *Battle) Retreat(destination string) error {
	if b.Pending == nil || b.Pending.Kind != ChooseRetreat {
		return fmt.Errorf("no retreat decision is pending")
	}
	options := b.Pending.Options
	if options == nil {
		options = b.retreatDestinations(b.Pending.Eligible)
	}
	allowed, hasNonAir := false, false
	for _, option := range options {
		allowed = allowed || option == destination
	}
	for _, id := range b.Pending.Eligible {
		u := b.State.Units[id]
		if u != nil && UnitSpecs[u.Type].Domain != "air" {
			hasNonAir = true
		}
	}
	if !allowed && (destination != "" || hasNonAir) {
		return fmt.Errorf("invalid retreat destination %s", destination)
	}
	for _, id := range b.Pending.Eligible {
		if u := b.State.Units[id]; u != nil {
			u.Retreated = true
			if UnitSpecs[u.Type].Domain == "air" {
				continue
			}
			u.Space = destination
			if u.Type == Transport {
				for _, cargo := range b.State.Units {
					if cargo.AssaultFrom == u.ID {
						cargo.Space, cargo.TransportID, cargo.Amphibious, cargo.AssaultFrom = "", u.ID, false, ""
					}
				}
			}
		}
	}
	b.Pending = nil
	b.stage = "submerge"
	b.checkFinished()
	return nil
}

func (b *Battle) retreatDestinations(eligible []string) []string {
	kind := b.State.Board.Spaces[b.Territory].Kind
	set := map[string]bool{}
	for _, id := range eligible {
		u := b.State.Units[id]
		if u == nil || UnitSpecs[u.Type].Domain == "air" {
			continue
		}
		origin := u.CombatOrigin
		if origin == "" {
			origin = b.State.Start.Units[id].Space
		}
		if !b.State.Board.Adjacent[b.Territory][origin] || b.State.Board.Spaces[origin].Kind != kind {
			continue
		}
		if kind == "land" && !b.State.Allied(b.State.Owners[origin], b.Attacker) {
			continue
		}
		if kind == "sea" && (b.State.hasEnemySeaUnit(origin, b.Attacker) || !seaWasFriendly(b.State, origin, b.Attacker)) {
			continue
		}
		set[origin] = true
	}
	options := make([]string, 0, len(set))
	for destination := range set {
		options = append(options, destination)
	}
	sort.Strings(options)
	return options
}

func seaWasFriendly(s *State, space string, p Power) bool {
	for _, u := range s.Start.Units {
		if u.Space == space && !s.Allied(u.Owner, p) && u.Type != Submarine && u.Type != Transport {
			return false
		}
	}
	return true
}

func (b *Battle) Continue() error {
	if b.Pending == nil || b.Pending.Kind != ChooseRetreat {
		return fmt.Errorf("no retreat decision is pending")
	}
	b.Pending = nil
	b.stage = "submerge"
	return nil
}

func (b *Battle) checkFinished() {
	attackers, defenders := forces(b.State, b.Territory, b.Attacker)
	if b.State.Board.Spaces[b.Territory].Kind == "sea" && hasAttackCapableUnit(attackers, defenders) && onlyTransports(defenders) {
		for _, u := range defenders {
			b.State.destroyTransport(u.ID)
		}
		attackers, defenders = forces(b.State, b.Territory, b.Attacker)
	}
	if len(attackers) > 0 && len(defenders) > 0 {
		if canHitAny(attackers, defenders, true) || canHitAny(defenders, attackers, false) {
			return
		}
	}
	if len(defenders) > 0 {
		b.Winner = defenders[0].Owner
	}
	if b.State.Board.Spaces[b.Territory].Kind == "sea" && b.offerDefendingFighterLanding(defenders) {
		return
	}
	b.Complete = true
	if len(attackers) > 0 && len(defenders) == 0 {
		b.Winner = b.Attacker
		if b.State.Board.Spaces[b.Territory].Kind == "land" && containsCapturingLandUnit(attackers) {
			b.State.capture(b.Territory, b.Attacker)
		}
	}
	for _, u := range b.State.Units {
		if u.Space == b.Territory {
			u.Amphibious = false
			u.AssaultFrom = ""
		}
		if u.Type == Battleship && u.Space == b.Territory {
			u.Damage = 0
		}
		if u.Space == "submerged:"+b.Territory {
			u.Space = u.Space[10:]
		}
	}
}

func containsCapturingLandUnit(units []*Unit) bool {
	for _, u := range units {
		if UnitSpecs[u.Type].Domain == "land" && u.Type != AAA {
			return true
		}
	}
	return false
}

func onlyTransports(units []*Unit) bool {
	if len(units) == 0 {
		return false
	}
	for _, u := range units {
		if u.Type != Transport {
			return false
		}
	}
	return true
}

func hasAttackCapableUnit(attackers, defenders []*Unit) bool {
	for _, u := range attackers {
		if UnitSpecs[u.Type].Attack > 0 && len(eligibleTargets(defenders, map[UnitType]string{Submarine: "sea"}[u.Type])) > 0 {
			return true
		}
	}
	return false
}

func canHitAny(shooters, targets []*Unit, attacking bool) bool {
	airCanHitSubs := containsType(shooters, Destroyer)
	for _, u := range shooters {
		value := UnitSpecs[u.Type].Defense
		if attacking {
			value = UnitSpecs[u.Type].Attack
		}
		if value == 0 {
			continue
		}
		restriction := "all"
		if u.Type == Submarine {
			restriction = "sea"
		} else if UnitSpecs[u.Type].Domain == "air" && !airCanHitSubs {
			restriction = "non-sub"
		}
		if len(eligibleTargets(targets, restriction)) > 0 {
			return true
		}
	}
	return false
}

func (b *Battle) offerDefendingFighterLanding(defenders []*Unit) bool {
	fighters, slots := []*Unit{}, 0
	for _, u := range defenders {
		if u.Type == Fighter {
			fighters = append(fighters, u)
		}
		if u.Type == Carrier {
			slots += 2
		}
	}
	if len(fighters) <= slots {
		return false
	}
	power := Power("")
	for _, candidate := range TurnOrder {
		for _, fighter := range fighters {
			if fighter.Owner == candidate {
				power = candidate
				break
			}
		}
		if power != "" {
			break
		}
	}
	eligible := make([]string, 0, len(fighters))
	destinations := map[string][]string{}
	for _, fighter := range fighters {
		if fighter.Owner != power {
			continue
		}
		eligible = append(eligible, fighter.ID)
		for neighbor := range b.State.Board.Adjacent[b.Territory] {
			space := b.State.Board.Spaces[neighbor]
			if space.Kind == "land" && b.State.aircraftCanLand(neighbor, fighter.Owner) && !b.State.hasEnemyUnit(neighbor, fighter.Owner) {
				destinations[fighter.ID] = append(destinations[fighter.ID], neighbor)
				continue
			}
			if space.Kind != "sea" || b.State.hasEnemySeaUnit(neighbor, fighter.Owner) {
				continue
			}
			capacity := 0
			for _, u := range b.State.UnitsAt(neighbor) {
				if b.State.Allied(u.Owner, fighter.Owner) && u.Type == Carrier {
					capacity += 2
				}
				if b.State.Allied(u.Owner, fighter.Owner) && u.Type == Fighter {
					capacity--
				}
			}
			if capacity > 0 {
				destinations[fighter.ID] = append(destinations[fighter.ID], neighbor)
			}
		}
		sort.Strings(destinations[fighter.ID])
	}
	b.stage = "fighter-landing"
	b.Pending = &PendingDecision{Kind: ChooseFighterLanding, Power: power, Eligible: eligible, Destinations: destinations}
	return true
}

func (b *Battle) defendingPower() Power {
	_, d := forces(b.State, b.Territory, b.Attacker)
	if len(d) == 0 {
		return ""
	}
	return d[0].Owner
}
func (b *Battle) defenderIDs(_ []UnitType) []string {
	_, d := forces(b.State, b.Territory, b.Attacker)
	return unitIDs(d)
}
func countHits(rolls []int, threshold int) int {
	hits := 0
	for _, die := range rolls {
		if die >= 1 && die <= threshold {
			hits++
		}
	}
	return hits
}
func rollUnits(d Dice, units []*Unit, attacking bool) int {
	hits, supported := 0, 0
	if attacking {
		artillery, infantry := 0, 0
		for _, u := range units {
			if u.Type == Artillery {
				artillery++
			}
			if u.Type == Infantry {
				infantry++
			}
		}
		supported = min(artillery, infantry)
	}
	for _, u := range units {
		value := UnitSpecs[u.Type].Defense
		if attacking {
			value = UnitSpecs[u.Type].Attack
			if u.Type == Infantry && supported > 0 {
				value = 2
				supported--
			}
		}
		hits += countHits(d.Roll(1), value)
	}
	return hits
}

func (b *Battle) rollUnits(units []*Unit, attacking bool, purpose string) int {
	hits, supported := 0, 0
	if attacking {
		artillery, infantry := 0, 0
		for _, u := range units {
			if u.Type == Artillery {
				artillery++
			}
			if u.Type == Infantry {
				infantry++
			}
		}
		supported = min(artillery, infantry)
	}
	for _, u := range units {
		value := UnitSpecs[u.Type].Defense
		if attacking {
			value = UnitSpecs[u.Type].Attack
			if u.Type == Infantry && supported > 0 {
				value = 2
				supported--
			}
		}
		hits += countHits(b.roll(purpose+" "+string(u.Type), 1, value), value)
	}
	return hits
}

type hitGroup struct {
	restriction string
	hits        int
}

func (b *Battle) rollGroups(units []*Unit, attacking, airCanHitSubs bool, purpose string) []hitGroup {
	supported := 0
	if attacking {
		supported = min(len(filterType(units, Artillery)), len(filterType(units, Infantry)))
	}
	hits := map[string]int{}
	for _, u := range units {
		value := UnitSpecs[u.Type].Defense
		if attacking {
			value = UnitSpecs[u.Type].Attack
			if u.Type == Infantry && supported > 0 {
				value = 2
				supported--
			}
		}
		restriction := "all"
		if u.Type == Submarine {
			restriction = "sea"
		} else if UnitSpecs[u.Type].Domain == "air" && !airCanHitSubs {
			restriction = "non-sub"
		}
		hits[restriction] += countHits(b.roll(purpose+" "+string(u.Type), 1, value), value)
	}
	// Restricted hits are assigned first so broad surface hits retain all legal targets.
	order := []string{"non-sub", "sea", "all"}
	result := make([]hitGroup, 0, len(order))
	for _, restriction := range order {
		if hits[restriction] > 0 {
			result = append(result, hitGroup{restriction: restriction, hits: hits[restriction]})
		}
	}
	return result
}

func eligibleTargets(targets []*Unit, restriction string) []string {
	var result []string
	for _, u := range targets {
		if restriction == "sea" && UnitSpecs[u.Type].Domain != "sea" {
			continue
		}
		if restriction == "non-sub" && u.Type == Submarine {
			continue
		}
		result = append(result, u.ID)
	}
	return result
}
func filterType(units []*Unit, t UnitType) []*Unit {
	var r []*Unit
	for _, u := range units {
		if u.Type == t {
			r = append(r, u)
		}
	}
	return r
}
func containsType(units []*Unit, t UnitType) bool { return len(filterType(units, t)) > 0 }
func withoutSurpriseSubs(units []*Unit, enemyDestroyer bool) []*Unit {
	if enemyDestroyer {
		return units
	}
	var r []*Unit
	for _, u := range units {
		if u.Type != Submarine {
			r = append(r, u)
		}
	}
	return r
}
func unitIDs(units []*Unit) []string {
	r := make([]string, 0, len(units))
	for _, u := range units {
		r = append(r, u.ID)
	}
	return r
}
func idsSea(units []*Unit) []string {
	var r []string
	for _, u := range units {
		if UnitSpecs[u.Type].Domain == "sea" {
			r = append(r, u.ID)
		}
	}
	return r
}
func eligibleForFire(firing, targets []*Unit) []string {
	if len(firing) == 0 {
		return nil
	}
	onlyAir := true
	onlySubs := true
	for _, u := range firing {
		onlyAir = onlyAir && UnitSpecs[u.Type].Domain == "air"
		onlySubs = onlySubs && u.Type == Submarine
	}
	var r []string
	for _, u := range targets {
		if onlySubs && UnitSpecs[u.Type].Domain != "sea" {
			continue
		}
		if onlyAir && u.Type == Submarine && !containsType(firing, Destroyer) {
			continue
		}
		r = append(r, u.ID)
	}
	return r
}
func hasUnchosenCombatUnit(s *State, eligible []string, chosen map[string]bool) bool {
	for _, id := range eligible {
		if !chosen[id] {
			u := s.Units[id]
			if u != nil && u.Type != Transport {
				return true
			}
		}
	}
	return false
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *State) StrategicBomb(target string, bomberIDs []string, dice Dice) (int, error) {
	if s.Phase != ConductCombat || dice == nil {
		return 0, fmt.Errorf("strategic bombing requires combat and dice")
	}
	factory := (*Unit)(nil)
	for _, u := range s.UnitsAt(target) {
		if u.Type == Factory && !s.Allied(u.Owner, s.CurrentPower()) {
			factory = u
			break
		}
	}
	if factory == nil {
		return 0, fmt.Errorf("no enemy industrial complex in %s", target)
	}
	if len(bomberIDs) == 0 {
		return 0, fmt.Errorf("at least one bomber is required")
	}
	survivors := 0
	seen := map[string]bool{}
	for _, id := range bomberIDs {
		u := s.Units[id]
		if seen[id] || u == nil || u.Owner != s.CurrentPower() || u.Type != Bomber || u.Space != target || u.Raided || u.CombatUsed {
			return 0, fmt.Errorf("invalid bombing unit %s", id)
		}
		seen[id] = true
	}
	for _, id := range bomberIDs {
		u := s.Units[id]
		u.Raided = true
		u.CombatUsed = true
		// Every industrial complex has its own SBR-only antiaircraft defense.
		if factory != nil {
			rolls := dice.Roll(1)
			s.Dice = append(s.Dice, DiceRoll{Purpose: "strategic bombing AAA " + id, Results: append([]int(nil), rolls...)})
			if countHits(rolls, 1) == 1 {
				delete(s.Units, id)
				continue
			}
		}
		survivors++
	}
	damage := 0
	rolls := dice.Roll(survivors)
	if survivors > 0 {
		s.Dice = append(s.Dice, DiceRoll{Purpose: "strategic bombing damage", Results: append([]int(nil), rolls...)})
	}
	for _, die := range rolls {
		damage += die
	}
	limit := 2*s.Board.Spaces[target].IPC - factory.Damage
	if damage > limit {
		damage = limit
	}
	if damage < 0 {
		damage = 0
	}
	factory.Damage += damage
	return damage, nil
}
