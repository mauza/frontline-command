package board

import (
	"encoding/json"
	"testing"
)

func TestCatalog(t *testing.T) {
	var catalog struct {
		Width  int `json:"width"`
		Height int `json:"height"`
		Spaces []struct {
			ID            string         `json:"id"`
			Kind          string         `json:"kind"`
			Owner         string         `json:"owner"`
			VictoryCity   bool           `json:"victoryCity"`
			Units         map[string]int `json:"units"`
			Polygons      []string       `json:"polygons"`
			StartingUnits []StartingUnit `json:"startingUnits"`
		} `json:"spaces"`
		Connections []struct {
			A string `json:"a"`
			B string `json:"b"`
		} `json:"connections"`
	}
	if err := json.Unmarshal(CatalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.Width != 3500 || catalog.Height != 2000 || len(catalog.Spaces) != 161 || len(catalog.Connections) != 403 {
		t.Fatalf("unexpected board dimensions: %#v", catalog)
	}
	ids := map[string]bool{}
	seaZones, victoryCities, owned, unitSpaces, multiPolygons, polygonComponents := 0, 0, 0, 0, 0, 0
	startingUnits := 0
	for _, space := range catalog.Spaces {
		if ids[space.ID] {
			t.Fatalf("duplicate space id %q", space.ID)
		}
		ids[space.ID] = true
		if len(space.Polygons) == 0 {
			t.Fatalf("space %q has no polygon", space.ID)
		}
		if len(space.Polygons) > 1 {
			multiPolygons++
		}
		polygonComponents += len(space.Polygons)
		for _, polygon := range space.Polygons {
			if len(polygon) < 8 || polygon[0] != 'M' || polygon[len(polygon)-1] != 'Z' {
				t.Fatalf("space %q has invalid SVG polygon %q", space.ID, polygon)
			}
		}
		if space.Kind == "sea" {
			seaZones++
		}
		if space.VictoryCity {
			victoryCities++
		}
		if space.Owner != "" {
			owned++
		}
		if len(space.Units) > 0 {
			unitSpaces++
		}
		for _, stack := range space.StartingUnits {
			if stack.Owner == "" || stack.Type == "" || stack.Count < 1 {
				t.Fatalf("invalid starting stack in %s: %#v", space.ID, stack)
			}
			startingUnits += stack.Count
		}
	}
	if seaZones != 65 || victoryCities != 13 || owned != 80 || unitSpaces != 81 || multiPolygons != 9 || polygonComponents != 199 {
		t.Fatalf("unexpected board contents: sea=%d victory=%d owned=%d units=%d multi=%d polygons=%d", seaZones, victoryCities, owned, unitSpaces, multiPolygons, polygonComponents)
	}
	if startingUnits != 227 {
		t.Fatalf("unexpected starting unit count %d", startingUnits)
	}
	for _, edge := range catalog.Connections {
		if !ids[edge.A] || !ids[edge.B] {
			t.Fatalf("connection references unknown space: %#v", edge)
		}
	}
}
