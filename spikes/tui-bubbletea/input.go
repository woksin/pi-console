package main

import (
	"strings"

	tea "charm.land/bubbletea/v2"
)

func (m *Model) keypress(key string) tea.Cmd {
	switch key {
	case "q":
		return tea.Quit
	case "ctrl+p", ":":
		return m.openOverlay("palette")
	case "?":
		m.overlay = "help"
	case "/":
		return m.openOverlay("search")
	case "esc":
		m.detail = false
		m.anchor = 0
		m.newCount = 0
		m.search = ""
	case "enter":
		if !m.detail {
			m.detail = true
			m.anchor = 0
			m.newCount = 0
			m.railTop = 0
		} else {
			m.expanded = !m.expanded
		}
	case "tab", "shift+tab":
		m.focus = !m.focus
	case "j", "down":
		m.move(1)
	case "k", "up":
		m.move(-1)
	case "pgdown":
		m.move(10)
	case "pgup":
		m.move(-10)
	case "g", "home":
		if m.detail && len(m.frame.Entries) > 0 {
			m.anchor = m.frame.Entries[min(8, len(m.frame.Entries)-1)].Cursor
		} else {
			m.move(-10000)
		}
	case "G", "end", "f":
		m.anchor = 0
		m.newCount = 0
		if !m.detail {
			m.move(10000)
		}
	case "space":
		m.expanded = !m.expanded
	case "n":
		if m.detail {
			m.findSearch()
		} else {
			m.needsOnly = !m.needsOnly
			m.top = 0
			m.ensureSelection()
		}
	}
	return nil
}

func (m *Model) move(delta int) {
	if m.focus {
		m.railTop = max(0, m.railTop+delta)
		return
	}
	if m.detail {
		m.scrollTranscript(delta)
		return
	}
	rows := m.rows()
	index := 0
	for i, row := range rows {
		if row.key == m.key {
			index = i
			break
		}
	}
	direction := 1
	if delta < 0 {
		direction = -1
	}
	remaining := delta * direction
	for remaining > 0 {
		next := index + direction
		if next < 0 || next >= len(rows) {
			break
		}
		index = next
		if rows[index].session != nil {
			remaining--
			m.selectRow(rows[index])
		}
	}
}

func (m *Model) scrollTranscript(delta int) {
	entries := m.frame.Entries
	if len(entries) == 0 {
		return
	}
	index := len(entries) - 1
	if m.anchor > 0 {
		for i, e := range entries {
			if e.Cursor <= m.anchor {
				index = i
			}
		}
	}
	index = max(0, min(len(entries)-1, index+delta))
	if delta > 0 && index == len(entries)-1 {
		m.anchor = 0
		m.newCount = 0
		return
	}
	m.anchor = entries[index].Cursor
}

func (m *Model) mouseClick(x, y int) {
	if m.overlay != "" {
		return
	}
	m.focus = x >= m.leftWidth()
	if m.focus || m.detail {
		return
	}
	// Main content starts at row 5: border, column labels, rule, then rows.
	index := m.top + y - 8
	rows := m.rows()
	if index >= 0 && index < len(rows) {
		m.selectRow(rows[index])
	}
}

func (m *Model) openOverlay(kind string) tea.Cmd {
	m.overlay = kind
	m.choice = 0
	m.input.SetValue("")
	if kind == "search" {
		m.input.Placeholder = "Search transcript text…"
	} else {
		m.input.Placeholder = "Find a command or session…"
	}
	return m.input.Focus()
}

func (m *Model) overlayKey(msg tea.KeyPressMsg) tea.Cmd {
	key := msg.String()
	if key == "esc" || (m.overlay == "help" && (key == "?" || key == "enter")) {
		m.overlay = ""
		m.input.Blur()
		return nil
	}
	if m.overlay == "help" {
		return nil
	}
	if key == "enter" {
		if m.overlay == "search" {
			m.search = m.input.Value()
			m.findSearch()
		} else {
			actions := m.actions()
			if len(actions) > 0 {
				return m.execute(actions[min(m.choice, len(actions)-1)].id)
			}
		}
		m.overlay = ""
		m.input.Blur()
		return nil
	}
	if key == "up" {
		m.choice = max(0, m.choice-1)
		return nil
	}
	if key == "down" {
		m.choice = min(max(0, len(m.actions())-1), m.choice+1)
		return nil
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	m.choice = 0
	return cmd
}

func (m *Model) findSearch() {
	if m.search == "" {
		return
	}
	query := strings.ToLower(m.search)
	start := 0
	if m.anchor > 0 {
		for i, e := range m.frame.Entries {
			if e.Cursor <= m.anchor {
				start = i + 1
			}
		}
	}
	for n := 0; n < len(m.frame.Entries); n++ {
		i := (start + n) % len(m.frame.Entries)
		if strings.Contains(strings.ToLower(m.frame.Entries[i].Text), query) {
			m.anchor = m.frame.Entries[i].Cursor
			return
		}
	}
}
