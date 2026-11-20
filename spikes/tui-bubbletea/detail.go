package main

import (
	"fmt"
	"strings"

	lg "charm.land/lipgloss/v2"
)

func (m *Model) detailView() string {
	w, h := m.leftWidth(), m.contentHeight()
	totalH := h
	if m.width < 100 {
		h = max(5, h*2/3)
	}
	label := "TRANSCRIPT / following live"
	if m.anchor > 0 {
		label = fmt.Sprintf("TRANSCRIPT / paused · ↓ %d new", m.newCount)
	}
	if m.search != "" {
		label += " · /" + safe(m.search)
	}
	left := panel(label, m.transcript(w-4, h-2), w, h, !m.focus, cyan)
	if m.width < 100 {
		return left + "\n" + panel("SESSION / inspector", m.rail(w-4), w, max(3, totalH-h-1), m.focus, amber)
	}
	rail := strings.Split(m.rail(m.width-w-5), "\n")
	start := min(m.railTop, max(0, len(rail)-h+2))
	right := panel("SESSION / inspector", strings.Join(rail[start:], "\n"), m.width-w-1, h, m.focus, amber)
	return lg.JoinHorizontal(lg.Top, left, " ", right)
}

func (m *Model) transcript(w, h int) string {
	entries := m.transcriptEntries()
	if len(entries) == 0 {
		return paint("\n No transcript recorded for this session.\n\n The mock records the streaming timeline for s2.\n Use : → aurora implementation to inspect it.", muted)
	}
	end := len(entries)
	if m.anchor > 0 {
		end = 0
		for i, e := range entries {
			if e.Cursor <= m.anchor {
				end = i + 1
			}
		}
		if end == 0 {
			end = 1
		}
	}
	start := max(0, end-80)
	lines := []string{}
	hits := map[int]int{}
	if start > 0 {
		lines = append(lines, paint("  ↑ earlier entries · scroll to explore retained history", dim))
	}
	for i := start; i < end; i++ {
		entry := entries[i]
		// Stream deltas form one growing assistant block, not a new paragraph
		// per network event. The frame rate stays independent of token rate.
		for entry.Kind == "assistant.delta" && i+1 < end && entries[i+1].Kind == "assistant.delta" {
			i++
			entry.Text += entries[i].Text
		}
		rendered := m.entryView(entry, w)
		if m.search != "" && strings.Contains(strings.ToLower(entry.Text), strings.ToLower(m.search)) {
			rendered = lg.NewStyle().Background(lg.Color("#453c2a")).Render(rendered)
		}
		if disclosed(entry) {
			for n := range strings.Split(rendered, "\n") {
				hits[len(lines)+n] = entry.Cursor
			}
		}
		if entry.Cursor == m.blockCursor {
			rendered = lg.NewStyle().Background(lg.Color(raised)).Render(rendered)
		}
		lines = append(lines, strings.Split(rendered, "\n")...)
	}
	offset := max(0, len(lines)-h)
	m.transcriptHits = map[int]int{}
	for row, cursor := range hits {
		if row >= offset {
			m.transcriptHits[row-offset] = cursor
		}
	}
	if len(lines) > h {
		lines = lines[len(lines)-h:]
	}
	return strings.Join(lines, "\n")
}

func (m *Model) entryView(e Entry, w int) string {
	at := "--:--"
	if len(e.At) >= 19 {
		at = e.At[11:19]
	}
	stamp := paint(at+" ", dim)
	text := safe(e.Text)
	expanded := m.expanded || m.blocks[e.Cursor]
	switch e.Kind {
	case "user":
		origin := "origin not verified"
		for _, r := range m.frame.Requests {
			if r.SessionID == e.SessionID && r.Text == e.Text {
				origin = originLabel(r.Origin)
			}
		}
		return "\n" + stamp + strong("▸ "+origin, amber) + "\n" + paint(wrapped("  "+text, w), ink)
	case "assistant.delta":
		return stamp + paint("◂ ", cyan) + paint(wrapped(text, w-11), ink) + paint(" ▌", cyan)
	case "assistant":
		return stamp + strong("◂ assistant", cyan) + "\n" + paint(wrapped("  "+text, w), ink)
	case "thinking":
		if expanded {
			return stamp + paint("▾ thinking", violet) + "\n" + paint(wrapped("  "+text, w), muted)
		}
		return stamp + paint("▸ thinking · ", violet) + paint(cut(text, w-23), dim)
	case "tool.call":
		disclosure := "▸"
		if expanded {
			disclosure = "▾"
		}
		line := stamp + paint(disclosure+" tool  ", violet) + paint(cut(text, w-27), ink) + paint("  [call]", dim)
		if expanded {
			line += "\n" + paint(wrapped("  args: "+text, w), muted)
		}
		return line
	case "tool.result":
		if expanded {
			return stamp + paint("↳ result received", green) + "\n" + paint(wrapped("  "+text, w), muted)
		}
		return stamp + paint("↳ result received", green) + paint(" · space to expand", dim)
	case "diff":
		lines := []string{stamp + paint("± diff / code changes", muted)}
		for _, line := range strings.Split(text, "\n") {
			c := muted
			if strings.HasPrefix(line, "+") {
				c = green
			}
			if strings.HasPrefix(line, "-") {
				c = red
			}
			lines = append(lines, paint(cut("  "+line, w), c))
		}
		return strings.Join(lines, "\n")
	case "reset":
		carried := "not supplied"
		kind := "reset / compaction"
		for _, r := range m.frame.Resets {
			if r.ID == e.ResetID {
				carried = strings.Join(r.CarriedRequestIDs, ", ")
				kind = r.Kind
			}
		}
		heading := "─ " + kind + " · " + safe(e.ResetID) + " "
		return "\n" + strong(cut(heading+strings.Repeat("─", max(0, w-lg.Width(heading))), w), amber) + "\n" + paint(cut("  carried requests: "+carried, w), amber) + "\n" + paint(cut("  "+text, w), muted) + "\n"
	default:
		return stamp + paint(cut(text, w-9), muted)
	}
}

func originLabel(origin string) string {
	switch origin {
	case "human":
		return "you"
	case "launch":
		return "initial prompt"
	default:
		return "origin not verified"
	}
}

func (m *Model) rail(w int) string {
	s := m.current()
	lines := []string{strong(safe(s.LaneID+" · "+s.Name), ink), statusLabel(s.Status), paint(cell(s.Model, w), muted), paint("CONTEXT PRESSURE", dim), spark(s.Samples, min(24, w-6)) + paint(fmt.Sprintf(" %d%%", s.ContextPercent), ink), "", strong("REQUESTS & ANSWERS", amber)}
	for _, r := range m.frame.Requests {
		if r.SessionID != s.ID {
			continue
		}
		glyph, c := badge(r.Status)
		label := glyph + " " + r.ID + " · " + r.Status
		if r.Status == "interrupted" {
			label = "/ " + r.ID + " · INTERRUPTED REQUEST"
		}
		lines = append(lines, "", strong(cut(label, w), c), paint(originLabel(r.Origin), dim), paint(wrapped(r.Text, w), ink))
		if r.Answer != nil {
			lines = append(lines, paint(wrapped("↳ "+r.Answer.Text, w), green))
		} else {
			lines = append(lines, paint("↳ no final answer recorded", dim))
		}
		if len(r.InterimAnswers) > 0 {
			lines = append(lines, paint(wrapped("Partial: "+r.InterimAnswers[len(r.InterimAnswers)-1].Text, w), muted))
		}
	}
	lines = append(lines, "", strong("SUBAGENTS", muted))
	found := false
	for _, child := range m.frame.Sessions {
		if child.ParentSessionID == s.ID {
			lines = append(lines, statusLabel(child.Status)+" "+paint(safe(child.Name), ink))
			found = true
		}
	}
	if !found {
		lines = append(lines, paint("No subagents", dim))
	}
	lines = append(lines, "", strong("JOBS & PHASES", muted))
	found = false
	for _, j := range m.frame.Jobs {
		if j.SessionID == s.ID {
			lines = append(lines, statusLabel(j.Status)+" "+paint(safe(j.Name), ink))
			found = true
		}
	}
	if !found {
		lines = append(lines, paint("No work items", dim))
	}
	lines = append(lines, "", paint("READ ONLY · no commands delivered", dim))
	return strings.Join(lines, "\n")
}
