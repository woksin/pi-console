package main

import (
	tea "charm.land/bubbletea/v2"
	"time"
)

func (m *Model) signatureKey(key string) tea.Cmd {
	switch key {
	case "q":
		return tea.Quit
	case "esc":
		m.screen = ""
		m.detail = false
	case ":", "ctrl+p":
		return m.openOverlay("palette")
	case "?":
		m.overlay = "help"
	case "j", "down":
		if m.screen == "timeline" {
			m.timelineMove(1)
		} else {
			m.graphMove(1)
		}
	case "k", "up":
		if m.screen == "timeline" {
			m.timelineMove(-1)
		} else {
			m.graphMove(-1)
		}
	case "+", "=":
		m.zoomTimeline(0.75)
	case "-":
		m.zoomTimeline(1 / 0.75)
	case "h", "left":
		if m.screen == "timeline" {
			m.panTimeline(-1)
		} else {
			m.graphMove(-1)
		}
	case "l", "right":
		if m.screen == "timeline" {
			m.panTimeline(1)
		} else {
			m.graphMove(1)
		}
	case "[":
		m.markerIndex = max(0, m.markerIndex-1)
	case "]":
		m.markerIndex++
	case "c":
		repo := m.current().RepositoryID
		m.collapsed[repo] = !m.collapsed[repo]
		m.timelineTop = 0
	case "tab":
		m.graphEdge = !m.graphEdge
		m.edgeIndex = 0
	case "r":
		repos := []string{}
		for _, s := range m.frame.Sessions {
			if !contains(repos, s.RepositoryID) {
				repos = append(repos, s.RepositoryID)
			}
		}
		for i, repo := range repos {
			if repo == m.current().RepositoryID {
				next := repos[(i+1)%len(repos)]
				for _, s := range m.frame.Sessions {
					if s.RepositoryID == next {
						m.selected = s.ID
						break
					}
				}
				break
			}
		}
		m.edgeIndex = 0
	case "enter":
		p := m.selectedMarker()
		wasTimeline := m.screen == "timeline"
		m.screen = ""
		m.detail = true
		m.frame = m.feed.frame(m.selected)
		m.anchor = 0
		m.frozen = nil
		m.newCount = 0
		if wasTimeline && p != nil {
			target := parseTime(p.at)
			best := time.Duration(1<<63 - 1)
			for _, e := range m.frame.Entries {
				d := parseTime(e.At).Sub(target)
				if d < 0 {
					d = -d
				}
				if d < best {
					best = d
					m.anchor = e.Cursor
				}
			}
			if m.anchor > 0 {
				m.frozen = append([]Entry(nil), m.frame.Entries...)
			}
		}
	}
	return nil
}
func (m *Model) transcriptEntries() []Entry {
	if m.anchor > 0 && m.frozen != nil {
		return m.frozen
	}
	return m.frame.Entries
}
func disclosed(e Entry) bool {
	return e.Kind == "thinking" || e.Kind == "tool.call" || e.Kind == "tool.result"
}
func (m *Model) moveBlock(delta int) {
	entries := m.transcriptEntries()
	blocks := []Entry{}
	for _, e := range entries {
		if disclosed(e) {
			blocks = append(blocks, e)
		}
	}
	if len(blocks) == 0 {
		return
	}
	index := len(blocks) - 1
	for i, e := range blocks {
		if e.Cursor == m.blockCursor {
			index = i
			break
		}
	}
	index = max(0, min(len(blocks)-1, index+delta))
	m.blockCursor = blocks[index].Cursor
	if m.anchor == 0 {
		m.frozen = append([]Entry(nil), entries...)
	}
	m.anchor = blocks[min(len(blocks)-1, index+1)].Cursor
}
func (m *Model) toggleBlock() {
	if m.blockCursor == 0 {
		for _, e := range m.transcriptEntries() {
			if disclosed(e) && (m.anchor == 0 || e.Cursor <= m.anchor) {
				m.blockCursor = e.Cursor
			}
		}
	}
	if m.blockCursor > 0 {
		m.blocks[m.blockCursor] = !m.blocks[m.blockCursor]
	}
}
