package main

import (
	"sort"
	"strings"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
)

type action struct {
	id, label, kind string
	score           int
}

func fuzzy(query, text string) (int, bool) {
	query = strings.ToLower(query)
	text = strings.ToLower(text)
	pos, score := 0, 0
	for _, r := range query {
		i := strings.IndexRune(text[pos:], r)
		if i < 0 {
			return 0, false
		}
		score += i
		pos += i + len(string(r))
	}
	return score, true
}
func (m *Model) actions() []action {
	all := []action{{id: "fleet", label: "Go to fleet overview", kind: "navigation"}, {id: "needs", label: "Filter needs-you sessions", kind: "filter"}, {id: "theme", label: "Toggle Midnight / Contrast theme", kind: "appearance"}, {id: "quit", label: "Quit console (agents keep running)", kind: "application"}}
	for _, s := range m.frame.Sessions {
		all = append(all, action{id: "session:" + s.ID, label: s.LaneID + " · " + s.Name, kind: "session · " + s.Status})
	}
	matches := []action{}
	for _, a := range all {
		if score, ok := fuzzy(strings.TrimSpace(m.input.Value()), a.label); ok {
			a.score = score
			matches = append(matches, a)
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].score < matches[j].score })
	return matches
}
func (m *Model) execute(id string) tea.Cmd {
	m.overlay = ""
	m.input.Blur()
	switch id {
	case "quit":
		return tea.Quit
	case "fleet":
		m.detail = false
	case "needs":
		m.detail = false
		m.needsOnly = !m.needsOnly
		m.top = 0
		m.ensureSelection()
	case "theme":
		m.contrast = !m.contrast
		setTheme(m.contrast)
	default:
		if strings.HasPrefix(id, "session:") {
			m.selected = strings.TrimPrefix(id, "session:")
			m.key = "session-" + m.selected
			m.frame = m.feed.frame(m.selected)
			m.detail = true
			m.anchor = 0
			m.newCount = 0
			m.railTop = 0
			m.ensureSelection()
		}
	}
	return nil
}

func (m *Model) overlayView(base string) string {
	w := min(72, m.width-8)
	title := "COMMAND PALETTE"
	lines := []string{m.input.View(), paint(strings.Repeat("─", w-4), dim)}
	switch m.overlay {
	case "help":
		title = "KEYBOARD / help"
		lines = []string{strong("A quieter place to run a busy fleet.", ink), "", paint("j / k · ↑ / ↓    Select session / scroll timeline", muted), paint("Enter            Open session; expand transcript", muted), paint("Esc              Back to fleet / dismiss overlay", muted), paint("Tab              Focus the other pane", muted), paint("Mouse            Click selects · wheel scrolls", muted), paint("g / G · Home/End  Oldest / follow latest", muted), paint("f                Resume follow · clear new counter", muted), paint("Space            Expand thinking and tool payloads", muted), paint("/ · n            Search transcript · next match", muted), paint("n (fleet)        Toggle needs-you filter", muted), paint("Ctrl+P / :       Fuzzy command & session palette", muted), paint("q / Ctrl+C       Quit UI, never abort agents", muted), "", paint("Mock-only · no interventions are sent.", amber)}
	case "search":
		title = "SEARCH / transcript"
		lines = append(lines, paint("Enter jumps to a match · n finds the next · Esc cancels", muted))
	default:
		actions := m.actions()
		start := max(0, m.choice-7)
		for i := start; i < min(len(actions), start+8); i++ {
			a := actions[i]
			prefix := "  "
			c := ink
			if i == m.choice {
				prefix = "▸ "
				c = cyan
			}
			line := paint(prefix+cell(a.label, w-23), c) + paint(cell(a.kind, 17), dim)
			if i == m.choice {
				line = lg.NewStyle().Background(lg.Color(raised)).Render(line)
			}
			lines = append(lines, line)
		}
		if len(actions) == 0 {
			lines = append(lines, paint("No matching commands or sessions.", muted))
		}
		lines = append(lines, "", paint("↑↓ choose     enter run     esc close", muted))
	}
	h := min(m.height-4, len(lines)+2)
	box := panel(title, strings.Join(lines, "\n"), w, h, true, cyan)
	return lg.NewCompositor(lg.NewLayer(base), lg.NewLayer(box).X((m.width-w)/2).Y((m.height-h)/2).Z(1)).Render()
}
