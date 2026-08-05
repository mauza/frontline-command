package game

func (s *State) Capture(space string, conqueror Power) { s.capture(space, conqueror) }

func (s *State) capture(space string, conqueror Power) {
	info := s.Board.Spaces[space]
	old := s.Owners[space]
	if old == conqueror || info.Kind != "land" {
		return
	}
	newOwner := conqueror
	if info.OriginalOwner != "" && s.Allied(info.OriginalOwner, conqueror) && s.Powers[info.OriginalOwner].CapitalHeld {
		newOwner = info.OriginalOwner
	}
	s.Owners[space] = newOwner
	for _, u := range s.UnitsAt(space) {
		if (u.Type == Factory || u.Type == AAA) && !s.Allied(u.Owner, conqueror) {
			u.Owner = newOwner
		}
	}
	if info.Capital {
		original := info.OriginalOwner
		ps := s.Powers[original]
		if !s.Allied(original, conqueror) {
			winner := s.Powers[conqueror]
			winner.IPC += ps.IPC
			ps.IPC = 0
			ps.CapitalHeld = false
			s.Powers[conqueror], s.Powers[original] = winner, ps
		} else {
			ps.CapitalHeld = true
			s.Powers[original] = ps
			for id, owner := range s.Owners {
				if s.Board.Spaces[id].OriginalOwner == original && s.Allied(owner, original) {
					s.Owners[id] = original
				}
			}
			for _, u := range s.Units {
				if u.Type == Factory && s.Board.Spaces[u.Space].OriginalOwner == original && s.Owners[u.Space] == original {
					u.Owner = original
				}
			}
		}
	}
}

func (s *State) CheckVictory() Alliance {
	axisCities := 0
	for id, space := range s.Board.Spaces {
		if space.VictoryCity && AllianceOf(s.Owners[id]) == Axis {
			axisCities++
		}
	}
	if axisCities >= 9 {
		s.Winner = Axis
	}
	if 13-axisCities >= 10 {
		s.Winner = Allies
	}
	return s.Winner
}
