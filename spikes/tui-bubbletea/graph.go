package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	lg "charm.land/lipgloss/v2"
)

type edge struct {
	from, to string
	messages []Message
}
type point struct{ x, y int }
type graphNode struct {
	session Session
	x, y    int
}
type canvas struct {
	cells [][]string
	w, h  int
}

func newCanvas(w, h int) *canvas {
	c := &canvas{w: w, h: h}
	for y := 0; y < h; y++ {
		row := make([]string, w)
		for x := range row {
			row[x] = " "
		}
		c.cells = append(c.cells, row)
	}
	return c
}
func (c *canvas) put(x, y int, text, color string) {
	for _, r := range text {
		if x >= 0 && x < c.w && y >= 0 && y < c.h {
			c.cells[y][x] = paint(string(r), color)
		}
		x++
	}
}
func (c *canvas) String() string {
	lines := []string{}
	for _, row := range c.cells {
		lines = append(lines, strings.Join(row, ""))
	}
	return strings.Join(lines, "\n")
}
func (m *Model) graphEdges() []edge {
	byPair := map[string]*edge{}
	keys := []string{}
	for _, msg := range m.frame.Messages {
		a, b := msg.FromSessionID, msg.ToSessionID
		if a > b {
			a, b = b, a
		}
		key := a + ":" + b
		if byPair[key] == nil {
			byPair[key] = &edge{from: a, to: b}
			keys = append(keys, key)
		}
		byPair[key].messages = append(byPair[key].messages, msg)
	}
	sort.Strings(keys)
	out := []edge{}
	for _, k := range keys {
		out = append(out, *byPair[k])
	}
	return out
}
func (m *Model) graphSessions() []Session {
	repo := m.current().RepositoryID
	out := []Session{}
	for _, s := range m.frame.Sessions {
		if s.RepositoryID == repo {
			out = append(out, s)
		}
	}
	return out
}
func (m *Model) graphMove(delta int) {
	if m.graphEdge {
		m.edgeIndex = max(0, min(len(m.visibleEdges())-1, m.edgeIndex+delta))
		return
	}
	sessions := m.graphSessions()
	for i, s := range sessions {
		if s.ID == m.selected {
			m.selected = sessions[(i+delta+len(sessions))%len(sessions)].ID
			return
		}
	}
}
func (m *Model) visibleEdges() []edge {
	sessions := m.graphSessions()
	ids := map[string]bool{}
	for _, s := range sessions {
		ids[s.ID] = true
	}
	out := []edge{}
	for _, e := range m.graphEdges() {
		if ids[e.from] && ids[e.to] {
			out = append(out, e)
		}
	}
	return out
}
func (m *Model) graphNodes(w, h int) []graphNode {
	layers := [3][]Session{}
	for _, s := range m.graphSessions() {
		layer := 1
		if s.Role == "orchestrator" {
			layer = 0
		}
		if s.Role == "subagent" {
			layer = 2
		}
		layers[layer] = append(layers[layer], s)
	}
	out := []graphNode{}
	cols := max(1, w/19)
	for level, sessions := range layers {
		rows := (len(sessions) + cols - 1) / cols
		for i, s := range sessions {
			row, col := i/cols, i%cols
			count := min(cols, len(sessions)-row*cols)
			x := (col*2+1)*w/(count*2) - 8
			y := 1 + level*(h-4)/3 + row*4
			if rows > 1 && level == 1 {
				y -= 1
			}
			out = append(out, graphNode{s, max(0, x), min(h-4, y)})
		}
	}
	return out
}
func edgePath(a, b graphNode) []point {
	start, end := point{a.x + 8, a.y + 3}, point{b.x + 8, b.y - 1}
	if a.y > b.y {
		start, end = point{a.x + 8, a.y - 1}, point{b.x + 8, b.y + 3}
	}
	mid := (start.y + end.y) / 2
	out := []point{start}
	walk := func(x, y int) {
		p := out[len(out)-1]
		for p.x != x || p.y != y {
			if p.x < x {
				p.x++
			} else if p.x > x {
				p.x--
			} else if p.y < y {
				p.y++
			} else {
				p.y--
			}
			out = append(out, p)
		}
	}
	walk(start.x, mid)
	walk(end.x, mid)
	walk(end.x, end.y)
	return out
}
func (m *Model) graphView() string {
	w, h := m.width, m.contentHeight()
	leftW := w * 67 / 100
	plotH := h - 5
	sideH := h
	if w < 100 {
		leftW = w
		plotH = max(2, h*2/3-4)
		sideH = h - plotH - 5
	}
	c := newCanvas(leftW-4, plotH)
	nodes := m.graphNodes(c.w, c.h)
	byID := map[string]graphNode{}
	for _, n := range nodes {
		byID[n.session.ID] = n
	}
	edges := m.visibleEdges()
	for i, e := range edges {
		a, okA := byID[e.from]
		b, okB := byID[e.to]
		if !okA || !okB {
			continue
		}
		path := edgePath(a, b)
		color := dim
		glyph := "·"
		if len(e.messages) > 1 {
			color = muted
			glyph = "─"
		}
		if m.graphEdge && i == m.edgeIndex {
			color = amber
			glyph = "━"
		}
		for j, p := range path {
			g := glyph
			if j > 0 && path[j-1].x == p.x {
				g = "│"
			}
			c.put(p.x, p.y, g, color)
		}
		for _, msg := range e.messages {
			at, ok := m.frame.Pulses[msg.ID]
			age := m.now.Sub(at)
			if !ok || age < 0 || age > 3*time.Second || len(path) == 0 {
				continue
			}
			if msg.FromSessionID != e.from {
				age = 3*time.Second - age
			}
			index := min(len(path)-1, int(float64(age)/float64(3*time.Second)*float64(len(path))))
			p := path[index]
			c.put(p.x, p.y, "●", cyan)
			if index > 0 {
				p = path[index-1]
				c.put(p.x, p.y, "•", violet)
			}
		}
	}
	for _, n := range nodes {
		s := n.session
		_, color := badge(s.Status)
		border := dim
		if s.ID == m.selected && !m.graphEdge {
			border = cyan
		}
		c.put(n.x, n.y, "╭────────────────╮", border)
		c.put(n.x, n.y+1, "│"+cell(s.LaneID+" "+s.Role, 16)+"│", color)
		c.put(n.x, n.y+2, "│"+cell(s.Status, 16)+"│", color)
		c.put(n.x, n.y+3, "╰────────────────╯", border)
	}
	body := paint("L0 / ORCHESTRATORS   →   LANES   →   WORKERS", muted) + "\n" + c.String() + "\n" + paint(" ● live packet · 3s transit   ━ volume / selected edge", muted)
	left := panel("03 / NEURAL SWITCHBOARD · "+safe(m.current().RepositoryID), body, leftW, plotH+4, true, violet)
	side := panel("TRAFFIC / conversation", m.graphInspector(max(16, w-leftW-5)), max(6, w-leftW-1), sideH, false, amber)
	if w < 100 {
		side = panel("TRAFFIC / conversation", m.graphInspector(w-4), w, sideH, false, amber)
		return left + "\n" + side
	}
	return lg.JoinHorizontal(lg.Top, left, " ", side)
}
func (m *Model) graphInspector(w int) string {
	title := m.current().LaneID + " / " + m.current().Name
	messages := []Message{}
	edges := m.visibleEdges()
	if m.graphEdge && len(edges) > 0 {
		e := edges[min(m.edgeIndex, len(edges)-1)]
		title = e.from + " ⇄ " + e.to
		messages = e.messages
	} else {
		for _, msg := range m.frame.Messages {
			if msg.FromSessionID == m.selected || msg.ToSessionID == m.selected {
				messages = append(messages, msg)
			}
		}
	}
	lines := []string{strong(cut(safe(title), w), cyan), statusLabel(m.current().Status), paint(fmt.Sprintf("%d messages · r switches repository", len(messages)), muted), ""}
	for _, msg := range messages[max(0, len(messages)-6):] {
		lines = append(lines, strong(cut(msg.FromSessionID+" → "+msg.ToSessionID+"  "+msg.Status, w), violet), paint(wrapped(safe(msg.Text), w), ink), "")
	}
	if len(messages) == 0 {
		lines = append(lines, paint("No messages recorded for this node.", muted))
	}
	return strings.Join(lines, "\n")
}
func (m *Model) graphClick(x, y int) {
	leftW := m.width * 67 / 100
	if m.width < 100 {
		leftW = m.width
	}
	h := m.contentHeight() - 5
	if m.width < 100 {
		h = max(2, m.contentHeight()*2/3-4)
	}
	nodes := m.graphNodes(leftW-4, h)
	for _, n := range nodes {
		if x >= n.x+2 && x <= n.x+19 && y >= n.y+8 && y <= n.y+11 {
			m.selected = n.session.ID
			m.graphEdge = false
			return
		}
	}
	byID := map[string]graphNode{}
	for _, n := range nodes {
		byID[n.session.ID] = n
	}
	for i, e := range m.visibleEdges() {
		for _, p := range edgePath(byID[e.from], byID[e.to]) {
			if abs(x-p.x-2) <= 1 && abs(y-p.y-8) <= 1 {
				m.edgeIndex = i
				m.graphEdge = true
				return
			}
		}
	}
}
func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
