package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	lg "charm.land/lipgloss/v2"
)

type marker struct {
	session, id, glyph, label, text, at string
	cursor                              int
}
type lane struct {
	repo    string
	session *Session
}

func (m *Model) markers() []marker {
	var out []marker
	for _, r := range m.frame.Requests {
		glyph := "◆"
		if r.Status == "interrupted" {
			glyph = "╳"
		}
		out = append(out, marker{session: r.SessionID, id: r.ID, glyph: glyph, label: r.Status + " request", text: r.Text, at: r.CreatedAt})
		if r.Answer != nil {
			out = append(out, marker{session: r.SessionID, id: r.ID + "-answer", glyph: "●", label: "answer", text: r.Answer.Text, at: r.Answer.At})
		}
	}
	for _, q := range m.frame.Questions {
		out = append(out, marker{session: q.SessionID, id: q.ID, glyph: "?", label: "question", text: q.Text, at: q.CreatedAt})
	}
	for _, r := range m.frame.Resets {
		out = append(out, marker{session: r.SessionID, id: r.ID, glyph: "┃", label: r.Kind, text: "Interrupted: " + strings.Join(r.InterruptedRequestIDs, ", "), at: r.At})
	}
	for _, msg := range m.frame.Messages {
		out = append(out, marker{session: msg.FromSessionID, id: msg.ID + "-sent", glyph: "↗", label: "message sent", text: msg.Text, at: msg.SentAt}, marker{session: msg.ToSessionID, id: msg.ID + "-received", glyph: "↙", label: "message received", text: msg.Text, at: msg.SentAt})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].at < out[j].at })
	return out
}
func parseTime(s string) time.Time { t, _ := time.Parse(time.RFC3339Nano, s); return t }
func (m *Model) timeRange() (time.Time, time.Duration) {
	points := m.markers()
	start := m.now.Add(-5 * time.Minute)
	span := 10 * time.Minute
	if len(points) > 0 {
		start = parseTime(points[0].at).Add(-30 * time.Second)
		end := parseTime(points[len(points)-1].at).Add(30 * time.Second)
		span = max(time.Minute, end.Sub(start))
	}
	return start, span
}
func (m *Model) initTimeline() {
	if m.timeSpan == 0 && len(m.markers()) > 0 {
		m.timeStart, m.timeSpan = m.timeRange()
	}
}
func (m *Model) zoomTimeline(factor float64) {
	m.initTimeline()
	old := m.timeSpan
	m.timeSpan = time.Duration(float64(old) * factor)
	m.timeSpan = max(10*time.Second, min(48*time.Hour, m.timeSpan))
	m.timeStart = m.timeStart.Add((old - m.timeSpan) / 2)
}
func (m *Model) panTimeline(direction int) {
	m.initTimeline()
	m.timeStart = m.timeStart.Add(time.Duration(direction) * m.timeSpan / 8)
}
func (m *Model) lanes() []lane {
	repos := []string{}
	for _, s := range m.frame.Sessions {
		if !contains(repos, s.RepositoryID) {
			repos = append(repos, s.RepositoryID)
		}
	}
	sort.Strings(repos)
	out := []lane{}
	for _, repo := range repos {
		out = append(out, lane{repo: repo})
		if m.collapsed[repo] {
			continue
		}
		for i := range m.frame.Sessions {
			s := &m.frame.Sessions[i]
			if s.RepositoryID == repo {
				out = append(out, lane{repo: repo, session: s})
			}
		}
	}
	return out
}
func (m *Model) selectedMarker() *marker {
	points := m.markers()
	candidates := []marker{}
	for _, p := range points {
		if p.session == m.selected {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	p := candidates[min(m.markerIndex, len(candidates)-1)]
	return &p
}
func (m *Model) timelineMove(delta int) {
	lanes := m.lanes()
	index := 0
	for i, l := range lanes {
		if l.session != nil && l.session.ID == m.selected {
			index = i
		}
	}
	for i := index + delta; i >= 0 && i < len(lanes); i += delta {
		if lanes[i].session != nil {
			m.selected = lanes[i].session.ID
			m.markerIndex = 0
			return
		}
	}
}
func markerColor(p marker) string {
	switch p.glyph {
	case "●":
		return green
	case "↗", "↙":
		return violet
	default:
		return amber
	}
}
func (m *Model) markerGlyph(p marker, chosen *marker) string {
	if chosen != nil && chosen.id == p.id {
		return lg.NewStyle().Background(lg.Color(cyan)).Foreground(lg.Color(bg)).Bold(true).Render(p.glyph)
	}
	return paint(p.glyph, markerColor(p))
}
func (m *Model) timelineLane(l lane, plotWidth, labelWidth, cursor int, points []marker, chosen *marker) []string {
	if l.session == nil {
		arrow := "▾"
		if m.collapsed[l.repo] {
			arrow = "▸"
		}
		return []string{strong(" "+arrow+" "+safe(l.repo), violet), paint(strings.Repeat("─", m.width-4), dim)}
	}
	glyphs, under := make([]string, plotWidth), make([]string, plotWidth)
	for x := range glyphs {
		glyphs[x] = paint("─", dim)
		under[x] = paint("·", dim)
	}
	if cursor >= 0 && cursor < plotWidth {
		glyphs[cursor] = paint("┊", cyan)
	}
	for _, p := range points {
		if p.session != l.session.ID {
			continue
		}
		x := int(float64(parseTime(p.at).Sub(m.timeStart)) / float64(m.timeSpan) * float64(plotWidth-1))
		if x < 0 || x >= plotWidth {
			continue
		}
		if p.glyph == "┃" {
			under[x] = paint("┃", amber)
		}
		glyphs[x] = m.markerGlyph(p, chosen)
	}
	name := paint(cell(l.session.LaneID+" · "+l.session.Name, labelWidth), muted)
	if l.session.ID == m.selected {
		name = strong("▸"+cell(l.session.LaneID+" · "+l.session.Name, labelWidth-1), cyan)
	}
	return []string{name + strings.Join(glyphs, ""), strings.Repeat(" ", labelWidth) + strings.Join(under, "")}
}
func (m *Model) timelineView() string {
	m.initTimeline()
	if m.timeSpan == 0 {
		return panel("02 / EVENT HORIZON", "Waiting for the daemon snapshot…", m.width, m.contentHeight(), true, cyan)
	}
	w, h := m.width, m.contentHeight()
	labelWidth := 24
	plotWidth := max(12, w-labelWidth-5)
	axis := paint(cell("REPOSITORY / SESSION", labelWidth), muted)
	for x := 0; x < plotWidth; x += 16 {
		t := m.timeStart.Add(time.Duration(float64(m.timeSpan) * float64(x) / float64(plotWidth)))
		axis += paint(cell(t.Format("15:04:05"), min(16, plotWidth-x)), muted)
	}
	lines := []string{axis, paint(strings.Repeat("─", w-4), dim)}
	lanes := m.lanes()
	visible := max(1, (h-9)/2)
	selected := 0
	for i, l := range lanes {
		if l.session != nil && l.session.ID == m.selected {
			selected = i
		}
	}
	if selected < m.timelineTop {
		m.timelineTop = selected
	}
	if selected >= m.timelineTop+visible {
		m.timelineTop = selected - visible + 1
	}
	points := m.markers()
	chosen := m.selectedMarker()
	frontier := parseTime(m.frame.LiveAt)
	if frontier.IsZero() && len(points) > 0 {
		frontier = parseTime(points[0].at)
	}
	// Entity timestamps give the replay playhead; the header uses wall time.
	cursor := int(float64(frontier.Sub(m.timeStart)) / float64(m.timeSpan) * float64(plotWidth-1))
	for i := m.timelineTop; i < min(len(lanes), m.timelineTop+visible); i++ {
		lines = append(lines, m.timelineLane(lanes[i], plotWidth, labelWidth, cursor, points, chosen)...)
	}
	for len(lines) < h-7 {
		lines = append(lines, "")
	}
	lines = append(lines, paint("◆ request  ● answer  ╳ interrupted  ┃ reset  ? question  ↗↙ message  ┊ replay now", muted))
	if chosen != nil {
		lines = append(lines, strong("  "+chosen.glyph+" "+chosen.label+" / "+chosen.id+"  "+parseTime(chosen.at).Format("15:04:05"), amber), paint("  "+cut(safe(chosen.text), w-8), ink))
	}
	title := fmt.Sprintf("02 / EVENT HORIZON  ·  %.0fs window", m.timeSpan.Seconds())
	return panel(title, strings.Join(lines, "\n"), w, h, true, cyan)
}
func (m *Model) timelineClick(x, y int) {
	index := m.timelineTop + (y-8)/2
	lanes := m.lanes()
	if y < 8 || index < 0 || index >= len(lanes) {
		return
	}
	l := lanes[index]
	if l.session == nil {
		m.collapsed[l.repo] = !m.collapsed[l.repo]
		return
	}
	m.selected = l.session.ID
	points := m.markers()
	target := m.timeStart.Add(time.Duration(float64(m.timeSpan) * float64(max(0, x-25)) / float64(max(12, m.width-29))))
	best := time.Duration(1<<63 - 1)
	n := 0
	for _, p := range points {
		if p.session != m.selected {
			continue
		}
		d := parseTime(p.at).Sub(target)
		if d < 0 {
			d = -d
		}
		if d < best {
			best = d
			m.markerIndex = n
		}
		n++
	}
}
