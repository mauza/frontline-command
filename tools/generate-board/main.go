package main

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type sourceGame struct {
	Map struct {
		Territories []struct {
			Name  string `xml:"name,attr"`
			Water bool   `xml:"water,attr"`
		} `xml:"territory"`
		Connections []struct {
			A string `xml:"t1,attr"`
			B string `xml:"t2,attr"`
		} `xml:"connection"`
	} `xml:"map"`
	Attachments struct {
		Items []struct {
			Territory string `xml:"attachTo,attr"`
			Type      string `xml:"type,attr"`
			Options   []struct {
				Name  string `xml:"name,attr"`
				Value string `xml:"value,attr"`
			} `xml:"option"`
		} `xml:"attachment"`
	} `xml:"attachmentList"`
	Initialize struct {
		Owners struct {
			Items []struct {
				Territory string `xml:"territory,attr"`
				Owner     string `xml:"owner,attr"`
			} `xml:"territoryOwner"`
		} `xml:"ownerInitialize"`
		Units struct {
			Items []struct {
				Type      string `xml:"unitType,attr"`
				Territory string `xml:"territory,attr"`
				Quantity  int    `xml:"quantity,attr"`
				Owner     string `xml:"owner,attr"`
			} `xml:"unitPlacement"`
		} `xml:"unitInitialize"`
	} `xml:"initialize"`
}

type catalog struct {
	Width       int          `json:"width"`
	Height      int          `json:"height"`
	Spaces      []space      `json:"spaces"`
	Connections []connection `json:"connections"`
}

type space struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	X             int            `json:"x"`
	Y             int            `json:"y"`
	Polygons      []string       `json:"polygons"`
	IPC           int            `json:"ipc,omitempty"`
	Owner         string         `json:"owner,omitempty"`
	Capital       bool           `json:"capital,omitempty"`
	VictoryCity   bool           `json:"victoryCity,omitempty"`
	Impassable    bool           `json:"impassable,omitempty"`
	Units         map[string]int `json:"units,omitempty"`
	StartingUnits []startingUnit `json:"startingUnits,omitempty"`
}

type startingUnit struct {
	Owner string `json:"owner"`
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type connection struct {
	A string `json:"a"`
	B string `json:"b"`
}

func main() {
	if len(os.Args) != 5 {
		panic("usage: generate-board centers.txt polygons.txt game.xml output.json")
	}
	centers := readCenters(os.Args[1])
	polygons := readPolygons(os.Args[2])
	raw, err := os.ReadFile(os.Args[3])
	check(err)
	var source sourceGame
	check(xml.Unmarshal(raw, &source))

	byName := map[string]int{}
	result := catalog{Width: 3500, Height: 2000}
	for _, item := range source.Map.Territories {
		center, ok := centers[item.Name]
		if !ok {
			panic("missing center for " + item.Name)
		}
		kind := "land"
		if item.Water {
			kind = "sea"
		}
		shape, ok := polygons[item.Name]
		if !ok {
			panic("missing polygons for " + item.Name)
		}
		s := space{ID: slug(item.Name), Name: item.Name, Kind: kind, X: center[0], Y: center[1], Polygons: shape}
		result.Spaces = append(result.Spaces, s)
		byName[item.Name] = len(result.Spaces) - 1
	}
	for _, item := range source.Attachments.Items {
		index, ok := byName[item.Territory]
		if item.Type != "territory" || !ok {
			continue
		}
		s := &result.Spaces[index]
		for _, option := range item.Options {
			switch option.Name {
			case "production":
				s.IPC, _ = strconv.Atoi(option.Value)
			case "capital":
				s.Capital = true
			case "victoryCity":
				s.VictoryCity = option.Value != "0"
			case "isImpassable":
				s.Impassable = option.Value == "true"
			}
		}
	}
	for _, item := range source.Initialize.Owners.Items {
		if index, ok := byName[item.Territory]; ok {
			result.Spaces[index].Owner = power(item.Owner)
		}
	}
	for _, item := range source.Initialize.Units.Items {
		if index, ok := byName[item.Territory]; ok {
			s := &result.Spaces[index]
			if s.Units == nil {
				s.Units = map[string]int{}
			}
			s.Units[unit(item.Type)] += item.Quantity
			s.StartingUnits = append(s.StartingUnits, startingUnit{Owner: power(item.Owner), Type: unit(item.Type), Count: item.Quantity})
		}
	}
	for _, edge := range source.Map.Connections {
		result.Connections = append(result.Connections, connection{A: slug(edge.A), B: slug(edge.B)})
	}
	sort.Slice(result.Spaces, func(i, j int) bool { return result.Spaces[i].Name < result.Spaces[j].Name })
	out, err := json.MarshalIndent(result, "", "  ")
	check(err)
	check(os.WriteFile(os.Args[4], append(out, '\n'), 0o644))
	fmt.Printf("generated %d spaces and %d connections\n", len(result.Spaces), len(result.Connections))
}

var polygonPattern = regexp.MustCompile(`<\s*([^>]*)\s*>`)
var pointPattern = regexp.MustCompile(`\((\d+),(\d+)\)`)

// readPolygons converts TripleA's pixel outlines into compact, lightly
// simplified SVG paths. Separate outlines remain separate for island groups.
func readPolygons(path string) map[string][]string {
	f, err := os.Open(path)
	check(err)
	defer f.Close()
	result := map[string][]string{}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		first := strings.IndexByte(line, '<')
		if first < 0 {
			panic("invalid polygon line")
		}
		name := strings.TrimSpace(line[:first])
		for _, group := range polygonPattern.FindAllStringSubmatch(line[first:], -1) {
			var points [][2]int
			for _, match := range pointPattern.FindAllStringSubmatch(group[1], -1) {
				x, _ := strconv.Atoi(match[1])
				y, _ := strconv.Atoi(match[2])
				if len(points) == 0 || points[len(points)-1] != [2]int{x, y} {
					points = append(points, [2]int{x, y})
				}
			}
			points = simplifyClosed(points, 1.5)
			if len(points) < 3 {
				panic("invalid polygon for " + name)
			}
			var b strings.Builder
			fmt.Fprintf(&b, "M%d %d", points[0][0], points[0][1])
			for _, point := range points[1:] {
				fmt.Fprintf(&b, "L%d %d", point[0], point[1])
			}
			b.WriteByte('Z')
			result[name] = append(result[name], b.String())
		}
		if len(result[name]) == 0 {
			panic("empty polygons for " + name)
		}
	}
	check(scanner.Err())
	return result
}

func simplifyClosed(points [][2]int, tolerance float64) [][2]int {
	if len(points) > 1 && points[0] == points[len(points)-1] {
		points = points[:len(points)-1]
	}
	if len(points) < 4 {
		return points
	}
	far, farDistance := 1, 0.0
	for i := 1; i < len(points); i++ {
		dx, dy := float64(points[i][0]-points[0][0]), float64(points[i][1]-points[0][1])
		if distance := dx*dx + dy*dy; distance > farDistance {
			far, farDistance = i, distance
		}
	}
	first := simplify(points[:far+1], tolerance)
	secondInput := append(append([][2]int{}, points[far:]...), points[0])
	second := simplify(secondInput, tolerance)
	return append(first, second[1:len(second)-1]...)
}

func simplify(points [][2]int, tolerance float64) [][2]int {
	if len(points) < 3 {
		return points
	}
	index, maximum := 0, tolerance*tolerance
	for i := 1; i < len(points)-1; i++ {
		if distance := segmentDistanceSquared(points[i], points[0], points[len(points)-1]); distance > maximum {
			index, maximum = i, distance
		}
	}
	if index == 0 {
		return [][2]int{points[0], points[len(points)-1]}
	}
	left, right := simplify(points[:index+1], tolerance), simplify(points[index:], tolerance)
	return append(left[:len(left)-1], right...)
}

func segmentDistanceSquared(point, start, end [2]int) float64 {
	x, y := float64(point[0]), float64(point[1])
	dx, dy := float64(end[0]-start[0]), float64(end[1]-start[1])
	if dx != 0 || dy != 0 {
		t := math.Max(0, math.Min(1, ((x-float64(start[0]))*dx+(y-float64(start[1]))*dy)/(dx*dx+dy*dy)))
		x, y = x-(float64(start[0])+t*dx), y-(float64(start[1])+t*dy)
	} else {
		x, y = x-float64(start[0]), y-float64(start[1])
	}
	return x*x + y*y
}

func readCenters(path string) map[string][2]int {
	f, err := os.Open(path)
	check(err)
	defer f.Close()
	pattern := regexp.MustCompile(`^(.*?)\s+\((\d+),(\d+)\)$`)
	result := map[string][2]int{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		match := pattern.FindStringSubmatch(scanner.Text())
		if match == nil {
			panic("invalid center: " + scanner.Text())
		}
		x, _ := strconv.Atoi(match[2])
		y, _ := strconv.Atoi(match[3])
		result[match[1]] = [2]int{x, y}
	}
	check(scanner.Err())
	return result
}

func slug(value string) string {
	value = strings.ToLower(value)
	value = strings.ReplaceAll(value, ".", "")
	var b strings.Builder
	dash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func power(value string) string {
	return map[string]string{"Russians": "Soviet Union", "Germans": "Germany", "British": "United Kingdom", "Japanese": "Japan", "Americans": "United States"}[value]
}

func unit(value string) string {
	return map[string]string{"infantry": "Infantry", "artillery": "Artillery", "armour": "Tank", "aaGun": "AAA", "fighter": "Fighter", "bomber": "Bomber", "submarine": "Submarine", "transport": "Transport", "destroyer": "Destroyer", "cruiser": "Cruiser", "carrier": "Aircraft Carrier", "battleship": "Battleship", "factory": "Industrial Complex"}[value]
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
