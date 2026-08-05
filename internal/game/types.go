// Package game implements deterministic Axis & Allies 1942 Second Edition
// domain rules. It has no persistence or transport concerns.
package game

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/mauza/axis-and-allies/internal/board"
)

type Power string
type Alliance string
type UnitType string
type Phase string

const (
	SovietUnion   Power    = "Soviet Union"
	Germany       Power    = "Germany"
	UnitedKingdom Power    = "United Kingdom"
	Japan         Power    = "Japan"
	UnitedStates  Power    = "United States"
	Allies        Alliance = "Allies"
	Axis          Alliance = "Axis"

	Purchase      Phase = "Purchase Units"
	CombatMove    Phase = "Combat Move"
	ConductCombat Phase = "Conduct Combat"
	NoncombatMove Phase = "Noncombat Move"
	Mobilize      Phase = "Mobilize New Units"
	CollectIncome Phase = "Collect Income"

	Infantry   UnitType = "Infantry"
	Artillery  UnitType = "Artillery"
	Tank       UnitType = "Tank"
	AAA        UnitType = "AAA"
	Fighter    UnitType = "Fighter"
	Bomber     UnitType = "Bomber"
	Submarine  UnitType = "Submarine"
	Transport  UnitType = "Transport"
	Destroyer  UnitType = "Destroyer"
	Cruiser    UnitType = "Cruiser"
	Carrier    UnitType = "Aircraft Carrier"
	Battleship UnitType = "Battleship"
	Factory    UnitType = "Industrial Complex"
)

var TurnOrder = []Power{SovietUnion, Germany, UnitedKingdom, Japan, UnitedStates}
var PhaseOrder = []Phase{Purchase, CombatMove, ConductCombat, NoncombatMove, Mobilize, CollectIncome}

type UnitSpec struct {
	Cost, Move, Attack, Defense int
	Domain                      string
}

var UnitSpecs = map[UnitType]UnitSpec{
	Infantry: {3, 1, 1, 2, "land"}, Artillery: {4, 1, 2, 2, "land"}, Tank: {6, 2, 3, 3, "land"},
	AAA: {5, 1, 0, 0, "land"}, Fighter: {10, 4, 3, 4, "air"}, Bomber: {12, 6, 4, 1, "air"},
	Submarine: {6, 2, 2, 1, "sea"}, Transport: {7, 2, 0, 0, "sea"}, Destroyer: {8, 2, 2, 2, "sea"},
	Cruiser: {12, 2, 3, 3, "sea"}, Carrier: {14, 2, 1, 2, "sea"}, Battleship: {20, 2, 4, 4, "sea"},
	Factory: {15, 0, 0, 0, "land"},
}

type Space struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	IPC           int    `json:"ipc,omitempty"`
	OriginalOwner Power  `json:"originalOwner,omitempty"`
	Capital       bool   `json:"capital,omitempty"`
	VictoryCity   bool   `json:"victoryCity,omitempty"`
	Impassable    bool   `json:"impassable,omitempty"`
}

type Board struct {
	Spaces   map[string]Space           `json:"spaces"`
	Adjacent map[string]map[string]bool `json:"adjacent"`
}

type Unit struct {
	ID           string   `json:"id"`
	Type         UnitType `json:"type"`
	Owner        Power    `json:"owner"`
	Space        string   `json:"space"`
	Damage       int      `json:"damage,omitempty"`
	Moved        int      `json:"moved,omitempty"`
	TransportID  string   `json:"transportId,omitempty"`
	Amphibious   bool     `json:"amphibious,omitempty"`
	CreatedRound int      `json:"createdRound,omitempty"`
	Raided       bool     `json:"raided,omitempty"`
	CombatUsed   bool     `json:"combatUsed,omitempty"`
	CombatOrigin string   `json:"combatOrigin,omitempty"`
	AssaultFrom  string   `json:"assaultTransportId,omitempty"`
	IgnoredBy    Power    `json:"ignoredBy,omitempty"`
	Retreated    bool     `json:"retreated,omitempty"`
}

type PowerState struct {
	IPC         int  `json:"ipc"`
	CapitalHeld bool `json:"capitalHeld"`
}

type State struct {
	Board      *Board               `json:"board"`
	Round      int                  `json:"round"`
	Turn       int                  `json:"turn"`
	Phase      Phase                `json:"phase"`
	Powers     map[Power]PowerState `json:"powers"`
	Owners     map[string]Power     `json:"owners"`
	Units      map[string]*Unit     `json:"units"`
	Purchased  []UnitType           `json:"purchased,omitempty"`
	Start      *TurnSnapshot        `json:"turnStart"`
	Winner     Alliance             `json:"winner,omitempty"`
	Dice       []DiceRoll           `json:"diceTranscript,omitempty"`
	nextUnitID int
}

type TurnSnapshot struct {
	Round  int              `json:"round"`
	Power  Power            `json:"power"`
	Owners map[string]Power `json:"owners"`
	Units  map[string]Unit  `json:"units"`
}

// MarshalJSON includes the private identity counter. Without it, loading a
// game and placing a unit can overwrite an existing unit with the same ID.
func (s State) MarshalJSON() ([]byte, error) {
	type stateAlias State
	return json.Marshal(struct {
		stateAlias
		NextUnitID int `json:"nextUnitId"`
	}{stateAlias: stateAlias(s), NextUnitID: s.nextUnitID})
}

func (s *State) UnmarshalJSON(data []byte) error {
	type stateAlias State
	decoded := struct {
		*stateAlias
		NextUnitID int `json:"nextUnitId"`
	}{stateAlias: (*stateAlias)(s)}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	s.nextUnitID = decoded.NextUnitID
	if s.nextUnitID == 0 {
		for _, u := range s.Units {
			var id int
			if _, err := fmt.Sscanf(u.ID, "u%04d", &id); err == nil && id > s.nextUnitID {
				s.nextUnitID = id
			}
		}
	}
	return nil
}

func AllianceOf(p Power) Alliance {
	if p == "" {
		return ""
	}
	if p == Germany || p == Japan {
		return Axis
	}
	return Allies
}

func (s *State) CurrentPower() Power    { return TurnOrder[s.Turn] }
func (s *State) Allied(a, b Power) bool { return a != "" && b != "" && AllianceOf(a) == AllianceOf(b) }

func NewStandardGame() (*State, error) {
	c, err := board.Decode()
	if err != nil {
		return nil, err
	}
	b := &Board{Spaces: map[string]Space{}, Adjacent: map[string]map[string]bool{}}
	s := &State{Board: b, Round: 1, Phase: Purchase, Powers: map[Power]PowerState{}, Owners: map[string]Power{}, Units: map[string]*Unit{}}
	startingIPC := map[Power]int{SovietUnion: 24, Germany: 41, UnitedKingdom: 31, Japan: 30, UnitedStates: 42}
	for _, p := range TurnOrder {
		s.Powers[p] = PowerState{IPC: startingIPC[p], CapitalHeld: true}
	}
	for _, raw := range c.Spaces {
		p := Power(raw.Owner)
		b.Spaces[raw.ID] = Space{raw.ID, raw.Name, raw.Kind, raw.IPC, p, raw.Capital, raw.VictoryCity, raw.Impassable}
		if p != "" {
			s.Owners[raw.ID] = p
		}
		b.Adjacent[raw.ID] = map[string]bool{}
		for _, stack := range raw.StartingUnits {
			for range stack.Count {
				s.addUnit(UnitType(stack.Type), Power(stack.Owner), raw.ID, 0)
			}
		}
	}
	for _, edge := range c.Connections {
		b.Adjacent[edge.A][edge.B], b.Adjacent[edge.B][edge.A] = true, true
	}
	s.takeSnapshot()
	return s, nil
}

func (s *State) addUnit(t UnitType, owner Power, space string, created int) *Unit {
	s.nextUnitID++
	u := &Unit{ID: fmt.Sprintf("u%04d", s.nextUnitID), Type: t, Owner: owner, Space: space, CreatedRound: created}
	s.Units[u.ID] = u
	return u
}

func (s *State) takeSnapshot() {
	s.Start = &TurnSnapshot{Round: s.Round, Power: s.CurrentPower(), Owners: map[string]Power{}, Units: map[string]Unit{}}
	for k, v := range s.Owners {
		s.Start.Owners[k] = v
	}
	for k, v := range s.Units {
		s.Start.Units[k] = *v
	}
}

// RefreshTurnSnapshot resets movement/placement reference data after an
// external migration establishes the current turn.
func (s *State) RefreshTurnSnapshot() { s.takeSnapshot() }

func (s *State) Snapshot() TurnSnapshot {
	result := TurnSnapshot{Round: s.Round, Power: s.CurrentPower(), Owners: map[string]Power{}, Units: map[string]Unit{}}
	for k, v := range s.Owners {
		result.Owners[k] = v
	}
	for k, v := range s.Units {
		result.Units[k] = *v
	}
	return result
}

func (s *State) UnitsAt(space string) []*Unit {
	var result []*Unit
	for _, u := range s.Units {
		if u.Space == space && u.TransportID == "" {
			result = append(result, u)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}
