package game

import (
	"fmt"
	"sort"
)

type Move struct {
	UnitID string   `json:"unitId"`
	Path   []string `json:"path"`
}
type TransportOrder struct {
	TransportID string   `json:"transportId"`
	LandUnits   []string `json:"landUnits"`
	Unload      string   `json:"unload,omitempty"`
}
type MovementPlan struct {
	Moves          []Move           `json:"moves"`
	Transports     []TransportOrder `json:"transports,omitempty"`
	IgnoreSeaZones []string         `json:"ignoreSeaZones,omitempty"`
}

func (s *State) Move(plan MovementPlan) error {
	combat := s.Phase == CombatMove
	if !combat && s.Phase != NoncombatMove {
		return fmt.Errorf("movement is not allowed during %s", s.Phase)
	}
	p := s.CurrentPower()
	paths := map[string][]string{}
	destinations := map[string]string{}
	for _, move := range plan.Moves {
		if _, exists := paths[move.UnitID]; exists {
			return fmt.Errorf("unit %s appears more than once", move.UnitID)
		}
		u := s.Units[move.UnitID]
		if u == nil || u.Owner != p || u.TransportID != "" {
			return fmt.Errorf("unit %s cannot be moved", move.UnitID)
		}
		if len(move.Path) < 2 || move.Path[0] != u.Space {
			return fmt.Errorf("path for %s must start at its current space", move.UnitID)
		}
		if err := s.validatePath(u, move.Path, combat); err != nil {
			return err
		}
		paths[u.ID] = move.Path
		destinations[u.ID] = move.Path[len(move.Path)-1]
	}
	loaded := map[string]bool{}
	orderedTransports := map[string]bool{}
	for _, order := range plan.Transports {
		transport := s.Units[order.TransportID]
		path := paths[order.TransportID]
		if transport == nil || !s.Allied(transport.Owner, p) || transport.Type != Transport || (transport.Owner != p && len(path) != 0) {
			return fmt.Errorf("transport %s cannot be ordered", order.TransportID)
		}
		if len(path) == 0 {
			path = []string{transport.Space}
		}
		if orderedTransports[order.TransportID] {
			return fmt.Errorf("transport %s appears more than once", order.TransportID)
		}
		orderedTransports[order.TransportID] = true
		if len(order.LandUnits) < 1 || len(order.LandUnits) > 2 {
			return fmt.Errorf("transport %s has invalid cargo count", order.TransportID)
		}
		infantry, unloadable := 0, 0
		existing := map[string]bool{}
		for id, cargo := range s.Units {
			if cargo.TransportID == order.TransportID {
				existing[id] = true
			}
		}
		for _, id := range order.LandUnits {
			u := s.Units[id]
			if loaded[id] || u == nil || !s.Allied(u.Owner, transport.Owner) || (u.TransportID != "" && u.TransportID != order.TransportID) || UnitSpecs[u.Type].Domain != "land" || u.Type == Factory {
				return fmt.Errorf("unit %s cannot be cargo", id)
			}
			if u.TransportID == "" {
				if u.Owner != p || u.Moved != 0 || paths[id] != nil || (combat && u.Type == AAA) {
					return fmt.Errorf("unit %s cannot move before loading", id)
				}
				alongRoute := false
				for _, sea := range path {
					if s.Board.Adjacent[u.Space][sea] {
						alongRoute = true
						break
					}
				}
				if !alongRoute {
					return fmt.Errorf("unit %s is not adjacent to transport route", id)
				}
			}
			if u.Type == Infantry {
				infantry++
			}
			if u.Owner == p {
				unloadable++
			}
			loaded[id] = true
			delete(existing, id)
		}
		if len(existing) != 0 {
			return fmt.Errorf("transport %s order must include all existing cargo", order.TransportID)
		}
		if len(order.LandUnits) == 2 && infantry == 0 {
			return fmt.Errorf("a transport carrying two units must carry an infantry")
		}
		if order.Unload != "" {
			if unloadable == 0 {
				return fmt.Errorf("transport %s has no cargo belonging to %s to unload", order.TransportID, p)
			}
			if combat {
				for _, id := range order.LandUnits {
					if u := s.Units[id]; u.Owner == p && u.Type == AAA {
						return fmt.Errorf("AAA %s cannot unload during combat movement", id)
					}
				}
			}
			if transport.Moved >= UnitSpecs[Transport].Move {
				return fmt.Errorf("transport %s has already unloaded", order.TransportID)
			}
			last := path[len(path)-1]
			space, ok := s.Board.Spaces[order.Unload]
			if !ok || space.Kind != "land" || !s.Board.Adjacent[last][order.Unload] {
				return fmt.Errorf("invalid unload destination %s", order.Unload)
			}
			hostile := s.hostileLand(order.Unload, p)
			if combat != hostile {
				return fmt.Errorf("unload destination %s does not match movement phase", order.Unload)
			}
		}
	}
	if err := s.validateCarrierLandings(paths, destinations, combat); err != nil {
		return err
	}
	ignored := map[string]bool{}
	for _, sea := range plan.IgnoreSeaZones {
		if ignored[sea] {
			return fmt.Errorf("sea zone %s is ignored more than once", sea)
		}
		ignored[sea] = true
		if !combat || !s.friendlyMoveEndsAt(sea, p, destinations) || !s.onlyEnemySubsAndTransports(sea, p) {
			return fmt.Errorf("enemy units in %s cannot be ignored", sea)
		}
	}
	for id, path := range paths {
		u := s.Units[id]
		u.Space = path[len(path)-1]
		u.Moved += len(path) - 1
		if combat {
			u.CombatOrigin = path[len(path)-2]
		}
		if combat && u.Type == Tank {
			for _, space := range path[1 : len(path)-1] {
				if s.hostileLand(space, p) {
					s.capture(space, p)
				}
			}
		}
		if combat && UnitSpecs[u.Type].Domain == "land" {
			destination := path[len(path)-1]
			if s.hostileLand(destination, p) && !s.hasEnemyCombatUnit(destination, p) {
				s.capture(destination, p)
			}
		}
	}
	for _, order := range plan.Transports {
		for _, id := range order.LandUnits {
			u := s.Units[id]
			if order.Unload == "" || u.Owner != p {
				u.TransportID, u.Space = order.TransportID, ""
			} else {
				u.Space, u.TransportID, u.Amphibious = order.Unload, "", combat
				if combat {
					u.AssaultFrom = order.TransportID
				} else {
					u.AssaultFrom = ""
				}
			}
			if u.Owner == p {
				u.Moved = UnitSpecs[u.Type].Move
			}
		}
		if order.Unload != "" {
			s.Units[order.TransportID].Moved = UnitSpecs[Transport].Move
			if combat && s.hostileLand(order.Unload, p) && !s.hasEnemyCombatUnit(order.Unload, p) {
				s.capture(order.Unload, p)
			}
		}
	}
	for sea := range ignored {
		for _, u := range s.UnitsAt(sea) {
			if !s.Allied(u.Owner, p) && (u.Type == Submarine || u.Type == Transport) {
				u.IgnoredBy = p
			}
		}
	}
	if combat {
		s.resolveDefenselessTransports(p, destinations, ignored)
	}
	return nil
}

// ValidateAircraftLanded enforces the mandatory landing step at the end of
// noncombat movement, including allied carrier capacity.
func (s *State) ValidateAircraftLanded() error {
	p := s.CurrentPower()
	carrierSlots := map[string]int{}
	for _, u := range s.Units {
		if u.Type == Carrier && s.Allied(u.Owner, p) {
			carrierSlots[u.Space] += 2
		}
	}
	for _, u := range s.Units {
		if u.Type == Fighter && s.Allied(u.Owner, p) && s.Board.Spaces[u.Space].Kind == "sea" {
			carrierSlots[u.Space]--
		}
	}
	for space, slots := range carrierSlots {
		if slots < 0 {
			return fmt.Errorf("not enough carrier capacity in %s", space)
		}
	}
	for _, u := range s.Units {
		if u.Owner != p || UnitSpecs[u.Type].Domain != "air" {
			continue
		}
		space := s.Board.Spaces[u.Space]
		if space.Kind == "land" && s.aircraftCanLand(u.Space, p) {
			continue
		}
		if u.Type == Fighter && space.Kind == "sea" && s.Allied(u.Owner, p) {
			continue
		}
		return fmt.Errorf("air unit %s has not landed", u.ID)
	}
	return nil
}

func (s *State) validatePath(u *Unit, path []string, combat bool) error {
	spec := UnitSpecs[u.Type]
	steps := len(path) - 1
	if steps+u.Moved > spec.Move {
		return fmt.Errorf("unit %s exceeds movement %d", u.ID, spec.Move)
	}
	if spec.Move == 0 || (u.Type == AAA && combat) {
		return fmt.Errorf("unit %s cannot move in this phase", u.ID)
	}
	for i := 1; i < len(path); i++ {
		from, to := path[i-1], path[i]
		if !s.Board.Adjacent[from][to] {
			return fmt.Errorf("%s and %s are not adjacent", from, to)
		}
		next, ok := s.Board.Spaces[to]
		if !ok || next.Impassable {
			return fmt.Errorf("unit %s cannot enter %s", u.ID, to)
		}
		last := i == len(path)-1
		switch spec.Domain {
		case "land":
			if next.Kind != "land" {
				return fmt.Errorf("land unit %s cannot enter water", u.ID)
			}
			hostile := s.hostileLand(to, u.Owner)
			if hostile && (!combat || (!last && u.Type != Tank)) {
				return fmt.Errorf("unit %s cannot pass through hostile %s", u.ID, to)
			}
			if !combat && hostile {
				return fmt.Errorf("unit %s cannot enter hostile %s in noncombat movement", u.ID, to)
			}
			if !last && hostile && s.hasEnemyCombatUnit(to, u.Owner) {
				return fmt.Errorf("tank %s cannot blitz through occupied %s", u.ID, to)
			}
		case "sea":
			if next.Kind != "sea" {
				return fmt.Errorf("sea unit %s cannot enter land", u.ID)
			}
			if err := s.validateCanal(from, to, u.Owner); err != nil {
				return err
			}
			hostile := s.hasEnemySeaUnit(to, u.Owner)
			if u.Type == Submarine {
				if s.hasEnemyDestroyer(to, u.Owner) && !last {
					return fmt.Errorf("submarine %s must stop at enemy destroyer in %s", u.ID, to)
				}
				continue
			}
			blocking := hostile && !s.onlyEnemySubsAndTransports(to, u.Owner)
			if blocking && (!combat || !last) {
				return fmt.Errorf("ship %s cannot pass through hostile %s", u.ID, to)
			}
		case "air":
			// Air units may cross hostile spaces and canals without restriction.
		}
	}
	return nil
}

func (s *State) validateCanal(from, to string, p Power) error {
	required := []string(nil)
	if from == "17-sea-zone" && to == "34-sea-zone" || from == "34-sea-zone" && to == "17-sea-zone" {
		required = []string{"egypt", "trans-jordan"}
	}
	if from == "18-sea-zone" && to == "19-sea-zone" || from == "19-sea-zone" && to == "18-sea-zone" {
		required = []string{"central-america"}
	}
	for _, land := range required {
		if s.Start == nil || !s.Allied(s.Start.Owners[land], p) {
			return fmt.Errorf("%s does not control the canal", p)
		}
	}
	return nil
}

func (s *State) validateCarrierLandings(paths map[string][]string, destinations map[string]string, combat bool) error {
	p := s.CurrentPower()
	carrierSlots := map[string]int{}
	futureCarriers := map[string][]string{}
	for _, u := range s.Units {
		if u.Type == Carrier && s.Allied(u.Owner, p) {
			d := u.Space
			if x := destinations[u.ID]; x != "" {
				d = x
			} else if combat && u.Owner == p && u.Moved == 0 && !u.CombatUsed && !s.hasEnemySeaUnit(u.Space, p) {
				futureCarriers[u.ID] = s.noncombatCarrierDestinations(u)
				continue
			}
			carrierSlots[d] += 2
		}
	}
	if combat {
		return s.validateCombatAirLandings(paths, destinations, carrierSlots, futureCarriers)
	}
	for _, u := range s.Units {
		if u.Type != Fighter || !s.Allied(u.Owner, p) || u.TransportID != "" {
			continue
		}
		d := u.Space
		if x := destinations[u.ID]; x != "" {
			d = x
		}
		if s.Board.Spaces[d].Kind == "sea" {
			carrierSlots[d]--
		}
	}
	for space, slots := range carrierSlots {
		if slots < 0 {
			return fmt.Errorf("not enough carrier capacity in %s", space)
		}
	}
	for id, path := range paths {
		u := s.Units[id]
		if UnitSpecs[u.Type].Domain != "air" {
			continue
		}
		destination := path[len(path)-1]
		space := s.Board.Spaces[destination]
		if space.Kind == "land" && !s.aircraftCanLand(destination, p) {
			return fmt.Errorf("air unit %s cannot land in %s", id, destination)
		}
		if space.Kind == "sea" && u.Type != Fighter {
			return fmt.Errorf("bomber %s cannot land at sea", id)
		}
	}
	return nil
}

func (s *State) validateCombatAirLandings(paths map[string][]string, destinations map[string]string, fixedSlots map[string]int, futureCarriers map[string][]string) error {
	p := s.CurrentPower()
	for _, u := range s.Units {
		if u.Type != Fighter || !s.Allied(u.Owner, p) || s.Board.Spaces[u.Space].Kind != "sea" {
			continue
		}
		// Allied aircraft cannot move during this power's noncombat phase.
		if u.Owner != p {
			fixedSlots[u.Space]--
		}
	}
	type landingNeed struct {
		id       string
		carriers []string
	}
	var needs []landingNeed
	for _, u := range s.Units {
		path := paths[u.ID]
		if u.Owner != p || UnitSpecs[u.Type].Domain != "air" || (path == nil && u.Moved == 0) {
			continue
		}
		destination := u.Space
		steps := 0
		if path != nil {
			destination = destinations[u.ID]
			steps = len(path) - 1
		}
		remaining := UnitSpecs[u.Type].Move - u.Moved - steps
		land, carriers := s.airLandingOptions(destination, u.Type, p, remaining, nil)
		if land {
			continue
		}
		needs = append(needs, landingNeed{id: u.ID, carriers: carriers})
	}
	sort.Slice(needs, func(i, j int) bool {
		if len(needs[i].carriers) == len(needs[j].carriers) {
			return needs[i].id < needs[j].id
		}
		return len(needs[i].carriers) < len(needs[j].carriers)
	})
	canAssign := func(carrierSlots map[string]int) bool {
		for _, slots := range carrierSlots {
			if slots < 0 {
				return false
			}
		}
		var assign func(int) bool
		assign = func(index int) bool {
			if index == len(needs) {
				return true
			}
			_, spaces := s.airLandingOptions(s.Units[needs[index].id].Space, s.Units[needs[index].id].Type, p, UnitSpecs[s.Units[needs[index].id].Type].Move-s.Units[needs[index].id].Moved, carrierSlots)
			if path := paths[needs[index].id]; path != nil {
				remaining := UnitSpecs[s.Units[needs[index].id].Type].Move - s.Units[needs[index].id].Moved - len(path) + 1
				_, spaces = s.airLandingOptions(destinations[needs[index].id], s.Units[needs[index].id].Type, p, remaining, carrierSlots)
			}
			for _, space := range spaces {
				if carrierSlots[space] == 0 {
					continue
				}
				carrierSlots[space]--
				if assign(index + 1) {
					return true
				}
				carrierSlots[space]++
			}
			return false
		}
		return assign(0)
	}
	carrierIDs := make([]string, 0, len(futureCarriers))
	for id := range futureCarriers {
		carrierIDs = append(carrierIDs, id)
	}
	sort.Strings(carrierIDs)
	var plan func(int, map[string]int) bool
	plan = func(index int, slots map[string]int) bool {
		if index == len(carrierIDs) {
			return canAssign(slots)
		}
		for _, destination := range futureCarriers[carrierIDs[index]] {
			slots[destination] += 2
			if plan(index+1, slots) {
				return true
			}
			slots[destination] -= 2
		}
		return false
	}
	if !plan(0, cloneCounts(fixedSlots)) {
		return fmt.Errorf("not enough carrier capacity for attacking aircraft")
	}
	return nil
}

func cloneCounts(source map[string]int) map[string]int {
	result := make(map[string]int, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func (s *State) noncombatCarrierDestinations(carrier *Unit) []string {
	type node struct {
		space string
		steps int
	}
	remaining := UnitSpecs[Carrier].Move - carrier.Moved
	seen := map[string]bool{carrier.Space: true}
	queue := []node{{carrier.Space, 0}}
	var result []string
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		result = append(result, current.space)
		if current.steps == remaining {
			continue
		}
		for next := range s.Board.Adjacent[current.space] {
			if seen[next] || s.Board.Spaces[next].Kind != "sea" || s.hasEnemySeaUnit(next, carrier.Owner) || s.validateCanal(current.space, next, carrier.Owner) != nil {
				continue
			}
			seen[next] = true
			queue = append(queue, node{next, current.steps + 1})
		}
	}
	sort.Strings(result)
	return result
}

func (s *State) airLandingOptions(start string, t UnitType, p Power, movement int, carrierSlots map[string]int) (bool, []string) {
	type node struct {
		id       string
		distance int
	}
	seen := map[string]bool{start: true}
	queue := []node{{start, 0}}
	carrierSet := map[string]bool{}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		space := s.Board.Spaces[n.id]
		if space.Kind == "land" && s.aircraftCanLand(n.id, p) {
			return true, nil
		}
		if t == Fighter && space.Kind == "sea" && carrierSlots[n.id] > 0 {
			carrierSet[n.id] = true
		}
		if n.distance == movement {
			continue
		}
		for next := range s.Board.Adjacent[n.id] {
			if !seen[next] && !s.Board.Spaces[next].Impassable {
				seen[next] = true
				queue = append(queue, node{next, n.distance + 1})
			}
		}
	}
	carriers := make([]string, 0, len(carrierSet))
	for space := range carrierSet {
		carriers = append(carriers, space)
	}
	sort.Strings(carriers)
	return false, carriers
}

func (s *State) airHasLanding(start string, t UnitType, p Power, movement int, carrierSlots map[string]int) bool {
	type node struct {
		id       string
		distance int
	}
	seen := map[string]bool{start: true}
	queue := []node{{start, 0}}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		space := s.Board.Spaces[n.id]
		if space.Kind == "land" && s.aircraftCanLand(n.id, p) {
			return true
		}
		if t == Fighter && space.Kind == "sea" && carrierSlots[n.id] > 0 {
			return true
		}
		if n.distance == movement {
			continue
		}
		for next := range s.Board.Adjacent[n.id] {
			if !seen[next] && !s.Board.Spaces[next].Impassable {
				seen[next] = true
				queue = append(queue, node{next, n.distance + 1})
			}
		}
	}
	return false
}

func (s *State) hostileLand(space string, p Power) bool {
	owner := s.Owners[space]
	return owner != "" && !s.Allied(owner, p)
}

func (s *State) aircraftCanLand(space string, p Power) bool {
	return s.Allied(s.Owners[space], p) && s.Start != nil && s.Allied(s.Start.Owners[space], p)
}
func (s *State) hasEnemyUnit(space string, p Power) bool {
	for _, u := range s.UnitsAt(space) {
		if !s.Allied(u.Owner, p) {
			return true
		}
	}
	return false
}
func (s *State) hasEnemyCombatUnit(space string, p Power) bool {
	for _, u := range s.UnitsAt(space) {
		if !s.Allied(u.Owner, p) && u.Type != Factory {
			return true
		}
	}
	return false
}
func (s *State) hasEnemySeaUnit(space string, p Power) bool {
	for _, u := range s.UnitsAt(space) {
		if !s.Allied(u.Owner, p) && UnitSpecs[u.Type].Domain == "sea" && u.Type != Transport && u.IgnoredBy != p {
			return true
		}
	}
	return false
}

func (s *State) hasEnemyDestroyer(space string, p Power) bool {
	for _, u := range s.UnitsAt(space) {
		if u.Type == Destroyer && !s.Allied(u.Owner, p) {
			return true
		}
	}
	return false
}

func (s *State) onlyEnemySubsAndTransports(space string, p Power) bool {
	found := false
	for _, u := range s.UnitsAt(space) {
		if s.Allied(u.Owner, p) {
			continue
		}
		if u.Type != Submarine && u.Type != Transport {
			return false
		}
		found = true
	}
	return found
}

func (s *State) friendlyMoveEndsAt(space string, p Power, destinations map[string]string) bool {
	for id, destination := range destinations {
		if destination == space && s.Units[id].Owner == p {
			return true
		}
	}
	return false
}

func (s *State) resolveDefenselessTransports(p Power, destinations map[string]string, ignored map[string]bool) {
	for sea := range s.Board.Spaces {
		if ignored[sea] || !s.friendlyMoveEndsAt(sea, p, destinations) {
			continue
		}
		enemySubs, enemyTransports, attackerCanFight := false, []string{}, false
		for _, u := range s.UnitsAt(sea) {
			if u.Owner == p && (UnitSpecs[u.Type].Domain == "air" || UnitSpecs[u.Type].Domain == "sea") && u.Type != Transport {
				attackerCanFight = true
			}
			if !s.Allied(u.Owner, p) {
				enemySubs = enemySubs || u.Type == Submarine
				if u.Type == Transport {
					enemyTransports = append(enemyTransports, u.ID)
				}
			}
		}
		if !attackerCanFight {
			for _, u := range s.UnitsAt(sea) {
				if !s.Allied(u.Owner, p) && (u.Type == Submarine || u.Type == Transport) {
					u.IgnoredBy = p
				}
			}
			continue
		}
		// Transports accompanying combat units remain in the battle and must be
		// taken after those units. Only transport-only defenders are destroyed
		// immediately during combat movement.
		if enemySubs || len(enemyTransports) == 0 || !s.onlyEnemySubsAndTransports(sea, p) {
			continue
		}
		for id, destination := range destinations {
			if destination == sea && s.Units[id].Owner == p {
				s.Units[id].CombatUsed = true
			}
		}
		for _, id := range enemyTransports {
			s.destroyTransport(id)
		}
	}
}

func (s *State) destroyTransport(id string) {
	for cargoID, cargo := range s.Units {
		if cargo.TransportID == id || cargo.AssaultFrom == id {
			delete(s.Units, cargoID)
		}
	}
	delete(s.Units, id)
}
