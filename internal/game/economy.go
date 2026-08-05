package game

import (
	"fmt"
	"sort"
)

type PurchaseOrder struct {
	Units   map[UnitType]int
	Repairs map[string]int
}
type Placement struct {
	Type  UnitType
	Space string
	Count int
}

const maxOrderQuantity = 1000

func (s *State) Income(p Power) int {
	total := 0
	for id, owner := range s.Owners {
		if owner == p {
			total += s.Board.Spaces[id].IPC
		}
	}
	return total
}

func (s *State) Purchase(order PurchaseOrder) error {
	if s.Phase != Purchase {
		return fmt.Errorf("purchases are only allowed during %s", Purchase)
	}
	p := s.CurrentPower()
	if !s.Powers[p].CapitalHeld {
		return fmt.Errorf("%s cannot purchase units while its capital is controlled by an enemy", p)
	}
	cost := 0
	total := 0
	for t, count := range order.Units {
		spec, ok := UnitSpecs[t]
		if !ok || count < 1 || count > maxOrderQuantity-total {
			return fmt.Errorf("invalid purchase %q", t)
		}
		total += count
		if count > (maxInt-cost)/spec.Cost {
			return fmt.Errorf("purchase cost is too large")
		}
		cost += spec.Cost * count
	}
	for id, amount := range order.Repairs {
		u := s.Units[id]
		if amount < 1 || amount > maxOrderQuantity-total || u == nil || u.Owner != p || u.Type != Factory || amount > u.Damage {
			return fmt.Errorf("invalid repair for %s", id)
		}
		total += amount
		if amount > maxInt-cost {
			return fmt.Errorf("purchase cost is too large")
		}
		cost += amount
	}
	ps := s.Powers[p]
	if cost > ps.IPC {
		return fmt.Errorf("purchase costs %d IPCs but only %d are available", cost, ps.IPC)
	}
	ps.IPC -= cost
	s.Powers[p] = ps
	for id, amount := range order.Repairs {
		s.Units[id].Damage -= amount
	}
	for _, t := range sortedUnitTypes(order.Units) {
		for range order.Units[t] {
			s.Purchased = append(s.Purchased, t)
		}
	}
	return nil
}

func sortedUnitTypes(counts map[UnitType]int) []UnitType {
	order := []UnitType{Infantry, Artillery, Tank, AAA, Fighter, Bomber, Submarine, Transport, Destroyer, Cruiser, Carrier, Battleship, Factory}
	var result []UnitType
	for _, t := range order {
		if counts[t] != 0 {
			result = append(result, t)
		}
	}
	return result
}

func (s *State) Place(placements []Placement) error {
	if s.Phase != Mobilize {
		return fmt.Errorf("placements are only allowed during %s", Mobilize)
	}
	p := s.CurrentPower()
	total := 0
	for _, x := range placements {
		if _, ok := UnitSpecs[x.Type]; !ok || x.Count < 1 || x.Count > maxOrderQuantity-total {
			return fmt.Errorf("invalid placement in %s", x.Space)
		}
		total += x.Count
	}
	want := map[UnitType]int{}
	capacity := map[string]int{}
	plannedFactories := map[string]bool{}
	plannedCarriers := map[string]int{}
	plannedFighters := map[string]int{}
	type seaRequest struct{ candidates []string }
	var seaRequests []seaRequest
	addSeaRequest := func(sea string) error {
		var candidates []string
		for neighbor := range s.Board.Adjacent[sea] {
			if s.Owners[neighbor] == p && s.Board.Spaces[neighbor].Kind == "land" && s.hasUsableFactory(p, neighbor) {
				candidates = append(candidates, neighbor)
			}
		}
		sort.Strings(candidates)
		if len(candidates) == 0 {
			return fmt.Errorf("no eligible industrial complex for %s", sea)
		}
		seaRequests = append(seaRequests, seaRequest{candidates: candidates})
		return nil
	}
	// Placement can be submitted in multiple commands. Units already created
	// this round still consume the same factories' production capacity.
	for _, u := range s.Units {
		if u.Owner != p || u.CreatedRound != s.Round || u.Type == Factory || u.TransportID != "" {
			continue
		}
		if s.Board.Spaces[u.Space].Kind == "sea" {
			if err := addSeaRequest(u.Space); err != nil {
				return err
			}
		} else {
			capacity[u.Space]++
		}
	}
	for _, x := range placements {
		space, ok := s.Board.Spaces[x.Space]
		if !ok {
			return fmt.Errorf("invalid placement in %s", x.Space)
		}
		want[x.Type] += x.Count
		if x.Type == Factory {
			if space.Kind != "land" || space.IPC == 0 || s.Owners[x.Space] != p || s.Start.Owners[x.Space] != p || x.Count != 1 || plannedFactories[x.Space] || s.hasFactory(x.Space) {
				return fmt.Errorf("industrial complex cannot be placed in %s", x.Space)
			}
			plannedFactories[x.Space] = true
			continue
		}
		domain := UnitSpecs[x.Type].Domain
		if domain == "sea" && space.Kind != "sea" {
			return fmt.Errorf("sea units must be placed at sea")
		}
		if domain == "land" && space.Kind != "land" {
			return fmt.Errorf("land units must be placed on land")
		}
		if domain == "air" && space.Kind == "sea" {
			if x.Type != Fighter {
				return fmt.Errorf("only fighters can be placed at sea")
			}
			plannedFighters[x.Space] += x.Count
		}
		if x.Type == Carrier {
			plannedCarriers[x.Space] += x.Count
		}
		factorySpace := x.Space
		if space.Kind == "sea" {
			for range x.Count {
				if err := addSeaRequest(x.Space); err != nil {
					return err
				}
			}
			continue
		}
		if factorySpace == "" || s.Owners[factorySpace] != p || s.Start.Owners[factorySpace] != p || !s.hasUsableFactory(p, factorySpace) {
			return fmt.Errorf("no eligible industrial complex for %s", x.Space)
		}
		if UnitSpecs[x.Type].Domain == "land" && x.Space != factorySpace {
			return fmt.Errorf("land units must be placed with their industrial complex")
		}
		capacity[factorySpace] += x.Count
	}
	sort.SliceStable(seaRequests, func(i, j int) bool {
		return len(seaRequests[i].candidates) < len(seaRequests[j].candidates)
	})
	var slots []string
	slotFactories := map[string]bool{}
	for _, request := range seaRequests {
		for _, factory := range request.candidates {
			slotFactories[factory] = true
		}
	}
	for space := range slotFactories {
		for available := s.factoryCapacity(p, space) - capacity[space]; available > 0; available-- {
			slots = append(slots, space)
		}
	}
	sort.Strings(slots)
	assigned := make([]int, len(slots))
	for i := range assigned {
		assigned[i] = -1
	}
	var assign func(int, []bool) bool
	assign = func(request int, seen []bool) bool {
		for slot, factory := range slots {
			if seen[slot] || !containsString(seaRequests[request].candidates, factory) {
				continue
			}
			seen[slot] = true
			if assigned[slot] == -1 || assign(assigned[slot], seen) {
				assigned[slot] = request
				return true
			}
		}
		return false
	}
	for request := range seaRequests {
		if !assign(request, make([]bool, len(slots))) {
			return fmt.Errorf("sea unit placements exceed adjacent industrial complex capacity")
		}
	}
	for slot, request := range assigned {
		if request >= 0 {
			capacity[slots[slot]]++
		}
	}
	have := map[UnitType]int{}
	for _, t := range s.Purchased {
		have[t]++
	}
	for t, n := range want {
		if n > have[t] {
			return fmt.Errorf("only %d purchased %s available", have[t], t)
		}
	}
	for space, used := range capacity {
		limit := s.factoryCapacity(p, space)
		if used > limit {
			return fmt.Errorf("placement in %s exceeds capacity %d", space, limit)
		}
	}
	for sea, newFighters := range plannedFighters {
		slots, fighters := plannedCarriers[sea]*2, newFighters
		for _, u := range s.UnitsAt(sea) {
			if s.Allied(u.Owner, p) && u.Type == Carrier {
				slots += 2
			}
			if s.Allied(u.Owner, p) && u.Type == Fighter {
				fighters++
			}
		}
		if fighters > slots {
			return fmt.Errorf("not enough carrier capacity in %s", sea)
		}
	}
	for _, x := range placements {
		for range x.Count {
			s.addUnit(x.Type, p, x.Space, s.Round)
		}
	}
	remaining := append([]UnitType(nil), s.Purchased...)
	for t, n := range want {
		for ; n > 0; n-- {
			for i, got := range remaining {
				if got == t {
					remaining = append(remaining[:i], remaining[i+1:]...)
					break
				}
			}
		}
	}
	s.Purchased = remaining
	return nil
}

func (s *State) factoryCapacity(p Power, space string) int {
	for _, u := range s.UnitsAt(space) {
		if u.Owner == p && u.Type == Factory {
			return max(0, s.Board.Spaces[space].IPC-u.Damage)
		}
	}
	return 0
}

// RefundUnplaced returns all unplaced units to the box and refunds their cost.
func (s *State) RefundUnplaced() int {
	refund := 0
	for _, unitType := range s.Purchased {
		refund += UnitSpecs[unitType].Cost
	}
	p := s.CurrentPower()
	state := s.Powers[p]
	state.IPC += refund
	s.Powers[p] = state
	s.Purchased = nil
	return refund
}

func (s *State) hasUsableFactory(p Power, space string) bool {
	for _, u := range s.UnitsAt(space) {
		if u.Owner == p && u.Type == Factory && u.CreatedRound < s.Round {
			return true
		}
	}
	return false
}

func (s *State) hasFactory(space string) bool {
	for _, u := range s.UnitsAt(space) {
		if u.Type == Factory {
			return true
		}
	}
	return false
}

func (s *State) Collect() error {
	if s.Phase != CollectIncome {
		return fmt.Errorf("income is only collected during %s", CollectIncome)
	}
	p := s.CurrentPower()
	ps := s.Powers[p]
	if ps.CapitalHeld {
		ps.IPC += s.Income(p)
	}
	s.Powers[p] = ps
	s.advanceTurn()
	return nil
}

func (s *State) AdvancePhase() error {
	for i, phase := range PhaseOrder {
		if s.Phase == phase {
			if phase == CollectIncome {
				return fmt.Errorf("use Collect to finish the turn")
			}
			if phase == NoncombatMove {
				if err := s.ValidateAircraftLanded(); err != nil {
					return err
				}
				if !s.Powers[s.CurrentPower()].CapitalHeld {
					s.advanceTurn()
					return nil
				}
			}
			s.Phase = PhaseOrder[i+1]
			return nil
		}
	}
	return fmt.Errorf("invalid phase %q", s.Phase)
}

// BattleTerritories returns deterministic contested spaces for the attacker.
func (s *State) BattleTerritories(attacker Power) []string {
	var result []string
	for id := range s.Board.Spaces {
		attackers, defenders := forces(s, id, attacker)
		if len(attackers) > 0 && len(defenders) > 0 {
			result = append(result, id)
		}
	}
	sort.Strings(result)
	return result
}

func (s *State) advanceTurn() {
	s.Turn++
	if s.Turn == len(TurnOrder) {
		s.Turn = 0
		s.Round++
		s.CheckVictory()
	}
	s.Phase = Purchase
	if !s.Powers[s.CurrentPower()].CapitalHeld {
		s.Phase = CombatMove
	}
	s.Purchased = nil
	for _, u := range s.Units {
		u.Moved = 0
		u.Raided = false
		u.CombatUsed = false
		u.CombatOrigin = ""
		u.AssaultFrom = ""
		u.IgnoredBy = ""
		u.Retreated = false
		if u.Type == Battleship {
			u.Damage = 0
		}
	}
	s.takeSnapshot()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

const maxInt = int(^uint(0) >> 1)
