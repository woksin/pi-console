package main

import (
	"fmt"
	"image/color"
	"sort"
	"strings"
	"time"

	lg "charm.land/lipgloss/v2"
)

type fleetRow struct {
	key, title string
	session    *Session
}

func (m *Model) rows() []fleetRow {
	var rows []fleetRow
	rows = append(rows, fleetRow{title: "NEEDS YOU  /  attention inbox"})
	for i := range m.frame.Sessions {
		s := &m.frame.Sessions[i]
		if s.Status == "needs-you" {
			rows = append(rows, fleetRow{key: "needs-" + s.ID, session: s})
		}
	}
	if m.needsOnly {
		return rows
	}
	repos := []string{}
	for _, s := range m.frame.Sessions {
		if !contains(repos, s.RepositoryID) {
			repos = append(repos, s.RepositoryID)
		}
	}
	sort.Strings(repos)
	for _, repo := range repos {
		rows = append(rows, fleetRow{title: repo + "  /  repository"})
		for i := range m.frame.Sessions {
			s := &m.frame.Sessions[i]
			if s.RepositoryID != repo || s.ParentSessionID != "" {
				continue
			}
			rows = append(rows, fleetRow{key: "session-" + s.ID, session: s})
			for j := range m.frame.Sessions {
				child := &m.frame.Sessions[j]
				if child.ParentSessionID == s.ID {
					rows = append(rows, fleetRow{key: "session-" + child.ID, session: child})
				}
			}
		}
	}
	return rows
}
func contains(items []string, s string) bool {
	for _, item := range items {
		if item == s {
			return true
		}
	}
	return false
}

func (m *Model) ensureSelection() {
	rows := m.rows()
	for _, row := range rows {
		if row.key == m.key && row.session != nil {
			return
		}
	}
	for _, row := range rows {
		if row.session != nil && row.session.ID == m.selected {
			m.key = row.key
			return
		}
	}
	for _, row := range rows {
		if row.session != nil {
			m.selectRow(row)
			return
		}
	}
}
func (m *Model) selectRow(row fleetRow) {
	if row.session == nil {
		return
	}
	if m.selected != row.session.ID {
		m.railTop = 0
	}
	m.key = row.key
	m.selected = row.session.ID
	m.frame = m.feed.frame(m.selected)
}
func (m *Model) fleetView() string {
	w, h := m.leftWidth(), m.contentHeight()
	totalH := h
	if m.width < 100 {
		h = max(5, h*2/3)
	}
	rows := m.rows()
	index := 0
	for i, row := range rows {
		if row.key == m.key {
			index = i
		}
	}
	visible := h - 4
	if index < m.top {
		m.top = index
	}
	if index >= m.top+visible {
		m.top = index - visible + 1
	}
	m.top = max(0, min(m.top, max(0, len(rows)-visible)))
	inner := w - 4
	title := paint(cell("ST LANE   SESSION", 28)+cell("ROLE", 6), dim)
	activityWidth := max(6, inner-60)
	title += paint(cell("ACTIVITY", activityWidth)+" "+cell("CONTEXT", 10)+cell("SPEND", 8)+" AGE", dim)
	lines := []string{title, paint(strings.Repeat("─", inner), dim)}
	for i := m.top; i < min(len(rows), m.top+visible); i++ {
		row := rows[i]
		if row.session == nil {
			c := muted
			if strings.HasPrefix(row.title, "NEEDS") {
				c = amber
			}
			lines = append(lines, strong("── "+safe(row.title)+" ", c)+paint(strings.Repeat("─", max(0, inner-len(row.title)-4)), dim))
		} else {
			lines = append(lines, m.sessionRow(*row.session, inner, row.key == m.key))
		}
	}
	left := panel(fmt.Sprintf("FLEET / %02d", len(m.frame.Sessions)), strings.Join(lines, "\n"), w, h, !m.focus, cyan)
	if m.width < 100 {
		return left + "\n" + panel("SESSION PREVIEW", m.preview(w-4), w, max(3, totalH-h-1), m.focus, ink)
	}
	rw := m.width - w - 1
	previewH := max(12, h*62/100)
	preview := panel("SESSION PREVIEW", m.preview(rw-4), rw, previewH, m.focus, ink)
	chart := panel("TOKEN BURN / fleet", m.chart(rw-4, h-previewH-3), rw, h-previewH-1, false, cyan)
	return lg.JoinHorizontal(lg.Top, left, " ", lg.JoinVertical(lg.Left, preview, "", chart))
}

func (m *Model) sessionRow(s Session, w int, selected bool) string {
	glyph, c := badge(s.Status)
	name := strings.TrimPrefix(s.Name, s.RepositoryID+" ")
	if s.ParentSessionID != "" {
		name = "└─ " + name
	}
	role := s.Role
	if role == "orchestrator" {
		role = "orch"
	}
	if role == "subagent" {
		role = "sub"
	}
	activity := m.activity(s)
	activityWidth := max(6, w-60)
	spend := 0.0
	for _, sample := range s.Samples {
		spend += sample.CostUsd
	}
	age := "—"
	started, e1 := time.Parse(time.RFC3339, s.StartedAt)
	updated, e2 := time.Parse(time.RFC3339, s.UpdatedAt)
	if e1 == nil && e2 == nil {
		age = fmt.Sprintf("%dm", max(0, int(updated.Sub(started).Minutes())))
	}
	line := paint(glyph+" ", c) + paint(cell(s.LaneID, 7), ink) + paint(cell(name, 19), ink) + paint(cell(role, 6), muted)
	line += paint(cell(activity, activityWidth), c) + " " + spark(s.Samples, 5) + paint(fmt.Sprintf(" %2d%% ", s.ContextPercent), muted)
	line += paint(fmt.Sprintf("$%-6.2f", spend), ink) + paint(cell(age, 4), muted)
	background := surface
	if at, ok := m.frame.Changed[s.ID]; ok {
		fade := m.now.Sub(at).Seconds() / 1.2
		if fade < 1 {
			background = blend(color.RGBA{R: 35, G: 66, B: 75}, color.RGBA{R: 16, G: 25, B: 39}, max(0, fade))
		}
	}
	if selected {
		background = "#22374d"
		line = strong("▸", cyan) + line[0:]
		line = cut(line, w)
	}
	return lg.NewStyle().Background(lg.Color(background)).Width(w).Render(pad(cut(line, w), w))
}

func (m *Model) activity(s Session) string {
	for _, q := range m.frame.Questions {
		if q.SessionID == s.ID && q.Status == "open" && q.Blocking {
			return "Decision requested"
		}
	}
	for _, j := range m.frame.Jobs {
		if j.SessionID == s.ID && j.Status == "running" {
			return j.Name
		}
	}
	for _, r := range m.frame.Requests {
		if r.SessionID == s.ID && r.Status != "answered" {
			return r.Text
		}
	}
	return s.Status
}

func (m *Model) preview(w int) string {
	s := m.current()
	lines := []string{strong(safe(s.LaneID+" · "+s.Name), ink), statusLabel(s.Status) + paint("  "+s.Role, muted), paint(cell(s.Branch, w), dim), "", strong("REQUESTS & ANSWERS", muted)}
	found := false
	for _, r := range m.frame.Requests {
		if r.SessionID != s.ID {
			continue
		}
		found = true
		lines = append(lines, statusLabel(r.Status)+paint(" · "+r.ID, dim), cut(paint("“"+safe(r.Text)+"”", ink), w))
		if r.Answer != nil {
			lines = append(lines, cut(paint("↳ "+safe(r.Answer.Text), green), w))
		}
		if len(lines) > 12 {
			break
		}
	}
	if !found {
		lines = append(lines, paint("No requests recorded for this session.", dim))
	}
	lines = append(lines, "", strong("OPEN QUESTIONS", amber))
	found = false
	for _, q := range m.frame.Questions {
		if q.SessionID == s.ID && q.Status == "open" {
			lines = append(lines, paint(wrapped("! "+q.Text, w), amber))
			found = true
		}
	}
	if !found {
		lines = append(lines, paint("No open questions.", dim))
	}
	return strings.Join(lines, "\n")
}

func (m *Model) chart(w, h int) string {
	if h < 3 {
		return paint("Waiting for samples…", dim)
	}
	values := make([]int, 24)
	totalTokens := 0
	cost := 0.0
	for _, s := range m.frame.Sessions {
		for i, sample := range s.Samples {
			values[i%24] += sample.Tokens
			totalTokens += sample.Tokens
			cost += sample.CostUsd
		}
	}
	peak := 1
	for _, v := range values {
		peak = max(peak, v)
	}
	lines := []string{strong(fmt.Sprintf("%.0fk tokens", float64(totalTokens)/1000), ink) + paint(fmt.Sprintf("  $%.2f", cost), muted)}
	rows := max(1, h-3)
	blocks := []rune(" ▁▂▃▄▅▆▇█")
	for y := rows - 1; y >= 0; y-- {
		var line strings.Builder
		for x := 0; x < w; x++ {
			level := float64(values[x*24/w])/float64(peak)*float64(rows)*8 - float64(y*8)
			c := cyan
			if y == 0 {
				c = "#367d94"
			}
			line.WriteString(paint(string(blocks[max(0, min(8, int(level)))]), c))
		}
		lines = append(lines, line.String())
	}
	lines = append(lines, paint(pad("−23m", max(0, w-3))+"now", dim), paint("24-point recorded token volume", dim))
	return strings.Join(lines, "\n")
}
