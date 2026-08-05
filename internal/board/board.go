package board

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// CatalogJSON contains independently rendered board metadata cross-checked
// against the printed 1942 Second Edition board.
//
//go:embed catalog.json
var CatalogJSON []byte

type Catalog struct {
	Width       int          `json:"width"`
	Height      int          `json:"height"`
	Spaces      []Space      `json:"spaces"`
	Connections []Connection `json:"connections"`
}

type Space struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	IPC           int            `json:"ipc,omitempty"`
	Owner         string         `json:"owner,omitempty"`
	Capital       bool           `json:"capital,omitempty"`
	VictoryCity   bool           `json:"victoryCity,omitempty"`
	Impassable    bool           `json:"impassable,omitempty"`
	StartingUnits []StartingUnit `json:"startingUnits,omitempty"`
}

type StartingUnit struct {
	Owner string `json:"owner"`
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type Connection struct {
	A string `json:"a"`
	B string `json:"b"`
}

const maxStartingUnitCount = 1000

// Decode returns the rules-facing board data. It deliberately does not infer
// ownership from territory control because allied units can share a space.
func Decode() (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(CatalogJSON, &c); err != nil {
		return nil, err
	}
	for _, s := range c.Spaces {
		for _, u := range s.StartingUnits {
			if u.Owner == "" || u.Type == "" || u.Count < 1 || u.Count > maxStartingUnitCount {
				return nil, fmt.Errorf("invalid starting unit in %s", s.ID)
			}
		}
	}
	return &c, nil
}
