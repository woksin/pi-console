package main

import (
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
	"github.com/charmbracelet/harmonica"
)

type tickMsg time.Time

type Model struct {
	feed                               *Feed
	frame                              Frame
	width, height                      int
	now                                time.Time
	selected, key                      string
	detail, focus, needsOnly, contrast bool
	top, railTop                       int
	// A paused transcript is anchored by cursor, not offset from the moving tail.
	anchor, newCount, lastCursor               int
	expanded                                   bool
	overlay                                    string
	input                                      textinput.Model
	choice                                     int
	search                                     string
	client                                     *Client
	screen                                     string
	timeStart                                  time.Time
	timeSpan                                   time.Duration
	timelineTop, markerIndex                   int
	collapsed                                  map[string]bool
	graphEdge                                  bool
	edgeIndex                                  int
	blocks                                     map[int]bool
	blockCursor                                int
	transcriptHits                             map[int]int
	frozen                                     []Entry
	composer                                   textarea.Model
	composeTarget, composeStatus, pendingAudit string
	composeMode                                int
	submitting                                 bool
	motion, motionVelocity                     float64
	spring                                     harmonica.Spring
}

func newModel(feed *Feed) *Model {
	input := textinput.New()
	input.Placeholder = "Find a command or session…"
	input.Prompt = "› "
	input.SetWidth(50)
	return &Model{feed: feed, width: 120, height: 36, selected: "s2", key: "needs-s2", now: time.Now(), input: input, collapsed: map[string]bool{}, blocks: map[int]bool{}, transcriptHits: map[int]int{}, motion: 1, spring: harmonica.NewSpring(0.05, 6, 0.8)}
}
func tick() tea.Cmd {
	return tea.Tick(50*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}
func (m *Model) Init() tea.Cmd { return tick() }

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = max(20, msg.Width)
		m.height = max(10, msg.Height)
	case interventionResult:
		m.submitting = false
		if msg.err != nil {
			m.composeStatus = msg.err.Error()
		} else {
			m.pendingAudit = msg.audit.ID
			m.composeStatus = "Accepted · waiting for stream audit " + msg.audit.ID
		}
	case tickMsg:
		m.motion, m.motionVelocity = m.spring.Update(m.motion, m.motionVelocity, 1)
		m.now = time.Time(msg)
		m.frame = m.feed.frame(m.selected)
		for _, audit := range m.frame.Interventions {
			if audit.ID == m.pendingAudit {
				m.composeStatus = "✓ SSE intervention.recorded · " + audit.ID + " · " + audit.Result
			}
		}
		if len(m.frame.Entries) > 0 {
			cursor := m.frame.Entries[len(m.frame.Entries)-1].Cursor
			if m.anchor > 0 && m.lastCursor > 0 {
				m.newCount += max(0, cursor-m.lastCursor)
			}
			m.lastCursor = cursor
		}
		m.ensureSelection()
		return m, tick()
	case tea.KeyPressMsg:
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
		if m.overlay == "composer" {
			return m, m.composerKey(msg)
		}
		if m.overlay != "" {
			return m, m.overlayKey(msg)
		}
		return m, m.keypress(msg.String())
	case tea.PasteMsg:
		if m.overlay == "composer" {
			var cmd tea.Cmd
			m.composer, cmd = m.composer.Update(msg)
			return m, cmd
		}
		if m.overlay == "palette" || m.overlay == "search" {
			var cmd tea.Cmd
			m.input, cmd = m.input.Update(msg)
			m.choice = 0
			return m, cmd
		}
		// Single-character pastes are useful in terminal automation. Never
		// interpret a pasted multi-command string as keyboard shortcuts.
		if len([]rune(msg.Content)) == 1 && m.overlay == "" {
			return m, m.keypress(msg.Content)
		}
	case tea.MouseClickMsg:
		m.mouseClick(msg.Mouse().X, msg.Mouse().Y)
	case tea.MouseWheelMsg:
		mouse := msg.Mouse()
		if m.screen == "timeline" {
			direction := 1
			if mouse.Button == tea.MouseWheelUp {
				direction = -1
			}
			m.panTimeline(direction)
			return m, nil
		}
		m.focus = mouse.X >= m.leftWidth()
		if mouse.Button == tea.MouseWheelUp {
			m.move(-3)
		} else {
			m.move(3)
		}
	}
	return m, nil
}

func (m *Model) leftWidth() int {
	if m.width < 100 {
		return m.width
	}
	return m.width * 65 / 100
}
func (m *Model) contentHeight() int { return max(3, m.height-8) }
func (m *Model) current() Session {
	for _, s := range m.frame.Sessions {
		if s.ID == m.selected {
			return s
		}
	}
	return Session{ID: m.selected, Name: "Connecting to mock daemon", Status: "stale"}
}

func (m *Model) View() tea.View {
	if m.width < 60 || m.height < 18 {
		v := tea.NewView("pi-console · terminal too small\nResize to at least 60 × 18. Ctrl+C quits.")
		v.AltScreen = true
		return v
	}
	body := ""
	switch {
	case m.screen == "timeline":
		body = m.timelineView()
	case m.screen == "graph":
		body = m.graphView()
	case m.detail:
		body = m.detailView()
	default:
		body = m.fleetView()
	}
	content := m.header() + "\n" + m.tabs() + "\n" + body + "\n" + m.footer()
	content = lg.NewStyle().Width(m.width).Height(m.height).Background(lg.Color(bg)).Foreground(lg.Color(ink)).Render(content)
	if m.overlay == "composer" {
		content = m.composerView(content)
	} else if m.overlay != "" {
		content = m.overlayView(content)
	}
	view := tea.NewView(content)
	view.AltScreen = true
	view.MouseMode = tea.MouseModeCellMotion
	view.BackgroundColor = lg.Color(bg)
	if m.contrast {
		view.BackgroundColor = lg.Color("#000000")
	}
	view.WindowTitle = "pi-console · Bubble Tea"
	return view
}

func (m *Model) header() string {
	counts := map[string]int{}
	for _, s := range m.frame.Sessions {
		counts[s.Status]++
	}
	brand := " " + gradient("pi-console") + paint(" / CONTROL ROOM", muted)
	stats := ""
	for _, status := range []string{"working", "needs-you", "blocked", "failed"} {
		_, c := badge(status)
		stats += " " + lg.NewStyle().Background(lg.Color(raised)).Foreground(lg.Color(c)).Render(fmt.Sprintf(" %d %s ", counts[status], status))
	}
	link := paint("● LIVE", green)
	if !m.frame.Connected {
		link = paint("○ RETRY", red)
	}
	right := link + "  " + paint(m.now.Format("15:04:05"), ink) + " "
	line := brand + strings.Repeat(" ", max(1, m.width-lg.Width(brand)-lg.Width(stats)-lg.Width(right)-2)) + stats + "  " + right
	return "\n" + cut(line, m.width) + "\n"
}

func (m *Model) tabs() string {
	tab := strong(" 01  FLEET ", cyan) + paint(" / overview", muted)
	if m.detail {
		s := m.current()
		tab = paint(" 01  Fleet  /  ", muted) + strong(safe(s.LaneID+" "+s.Name), ink) + "  " + statusLabel(s.Status)
	}
	if m.screen == "timeline" {
		tab = strong(" 02  EVENT HORIZON ", cyan) + paint(" / swimlane timeline", muted)
	}
	if m.screen == "graph" {
		tab = strong(" 03  NEURAL SWITCHBOARD ", violet) + paint(" / agent communication", muted)
	}
	right := paint("SYNTHETIC DATA  ·  MOCK ONLY ", dim)
	return pad(cut(tab, m.width-lg.Width(right)), m.width-lg.Width(right)) + right + "\n"
}

func (m *Model) footer() string {
	hints := " ↑↓/jk move   enter inspect   tab pane   n needs-you   : commands   ? help   q quit"
	if m.detail {
		hints = " ↑↓ scroll   f follow   space expand tools   / search   tab pane   esc fleet   : commands"
	}
	if m.screen == "timeline" {
		hints = " ↑↓ lane  [ ] marker  +/- zoom  h/l pan  c collapse  enter inspect  g graph  i intervene  esc fleet"
	}
	if m.screen == "graph" {
		hints = " ↑↓ select  tab node/edge  r repository  enter inspect  t timeline  i intervene  esc fleet"
	}
	if m.detail {
		hints = " ↑↓ scroll  [ ] block cursor  space disclose  f follow  i intervene  t timeline  g graph  esc fleet"
	}
	state := fmt.Sprintf(" %d sessions · SSE #%d", len(m.frame.Sessions), m.frame.Seq)
	if !m.frame.Connected {
		state = " " + safe(m.frame.Problem)
	}
	return paint(strings.Repeat("─", m.width), dim) + "\n" + cut(paint(hints, muted)+paint(state, dim), m.width)
}
