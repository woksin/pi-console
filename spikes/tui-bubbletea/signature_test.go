package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"pi-console/spikes/tui-bubbletea/api"
)

func TestTimelineZoomPanCollapseAndJump(t *testing.T) {
	m := fixtureModel(t)
	m.keypress("t")
	m.initTimeline()
	start, span := m.timeStart, m.timeSpan
	m.keypress("+")
	if m.timeSpan >= span || !m.timeStart.After(start) {
		t.Fatal("zoom did not keep center")
	}
	center := m.timeStart.Add(m.timeSpan / 2)
	m.zoomTimeline(1e-9)
	if m.timeSpan != 10*time.Second {
		t.Fatal("minimum zoom missing")
	}
	if !m.timeStart.Add(m.timeSpan / 2).Equal(center) {
		t.Fatal("center drift")
	}
	before := m.timeStart
	m.keypress("l")
	if !m.timeStart.After(before) {
		t.Fatal("pan did not move")
	}
	m.keypress("h")
	if !m.timeStart.Equal(before) {
		t.Fatal("pan not reversible")
	}
	count := len(m.lanes())
	m.keypress("c")
	if len(m.lanes()) >= count {
		t.Fatal("repository did not collapse")
	}
	m.keypress("c")
	m.keypress("]")
	if m.selectedMarker() == nil {
		t.Fatal("marker selection missing")
	}
	m.keypress("enter")
	if !m.detail || m.anchor == 0 || m.screen != "" {
		t.Fatal("marker did not jump into transcript")
	}
	glyphs := map[string]bool{}
	for _, p := range m.markers() {
		glyphs[p.glyph] = true
	}
	for _, g := range []string{"◆", "●", "╳", "┃", "?", "↗", "↙"} {
		if !glyphs[g] {
			t.Errorf("missing marker %s", g)
		}
	}
}
func TestGraphSelectionPulseAndConversation(t *testing.T) {
	m := fixtureModel(t)
	m.keypress("g")
	before := m.selected
	m.keypress("down")
	if m.selected == before {
		t.Fatal("graph node did not change")
	}
	m.keypress("tab")
	if !m.graphEdge || len(m.visibleEdges()) == 0 {
		t.Fatal("edge selection unavailable")
	}
	m.keypress("down")
	if m.edgeIndex != 1 {
		t.Fatal("edge cursor did not move")
	}
	text := ansi.Strip(m.graphInspector(70))
	if !strings.Contains(text, "⇄") || !strings.Contains(text, "messages") {
		t.Fatal(text)
	}
	raw := json.RawMessage(`{"id":"live","fromSessionId":"s1","toSessionId":"s2","text":"packet","sentAt":"2026-11-20T09:01:00Z"}`)
	m.feed.apply(Event{Type: "message.sent", Payload: raw})
	m.Update(tickMsg(time.Now()))
	if m.frame.Pulses["live"].IsZero() {
		t.Fatal("no live pulse recorded")
	}
	first := m.graphView()
	m.now = m.now.Add(1500 * time.Millisecond)
	if first == m.graphView() {
		t.Fatal("packet did not move")
	}
	m.keypress("r")
	if m.current().RepositoryID == "aurora" {
		t.Fatal("repository did not change")
	}
}
func TestIndependentDisclosureClickAndFrozenRetention(t *testing.T) {
	m := fixtureModel(t)
	m.detail = true
	m.frame.Entries = []Entry{{Cursor: 1, Kind: "thinking", Text: "reasoning"}, {Cursor: 2, Kind: "tool.call", Text: "command"}, {Cursor: 3, Kind: "tool.result", Text: "output"}}
	m.blockCursor = 1
	m.keypress("space")
	if !m.blocks[1] || m.blocks[2] {
		t.Fatal("block disclosure is not independent")
	}
	m.transcript(70, 12)
	row := -1
	for y, cursor := range m.transcriptHits {
		if cursor == 2 {
			row = y
			break
		}
	}
	if row < 0 {
		t.Fatal("missing block hit target")
	}
	m.mouseClick(12, row+7)
	if !m.blocks[2] {
		t.Fatal("block click did not disclose")
	}
	m.scrollTranscript(-1)
	frozen := m.transcript(70, 12)
	for i := 4; i < 8000; i++ {
		m.feed.mu.Lock()
		m.feed.appendEntry(Entry{Cursor: i, SessionID: "s2", Kind: "assistant.delta", Text: "stream"})
		m.feed.mu.Unlock()
	}
	m.Update(tickMsg(time.Now()))
	if m.transcript(70, 12) != frozen {
		t.Fatal("paused transcript changed after retention eviction")
	}
	m.keypress("f")
	if m.frozen != nil || m.anchor != 0 {
		t.Fatal("follow did not release frozen buffer")
	}
}
func TestComposerSubmitAndStreamAudit(t *testing.T) {
	var body api.InterventionInput
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/api/v0/interventions" || r.Header.Get("Authorization") != "Bearer token" {
			t.Error("wrong intervention transport")
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		w.WriteHeader(202)
		json.NewEncoder(w).Encode(api.Intervention{ID: "audit1", Type: body.Type, SessionID: body.SessionID, Result: "mock-only"})
	}))
	defer server.Close()
	m := fixtureModel(t)
	m.client, _ = newClient(server.URL, "token", m.feed)
	m.openComposer()
	m.composer.SetValue("Please verify\nthe checkpoint")
	cmd := m.submitComposer()
	if cmd == nil {
		t.Fatal(m.composeStatus)
	}
	m.Update(cmd())
	if body.Text != "Please verify\nthe checkpoint" || m.pendingAudit != "audit1" {
		t.Fatal("composer did not submit multiline input")
	}
	m.feed.apply(Event{Type: "intervention.recorded", Payload: json.RawMessage(`{"id":"audit1","type":"steer","sessionId":"s2","result":"mock-only"}`)})
	m.Update(tickMsg(time.Now()))
	if !strings.Contains(m.composeStatus, "SSE intervention.recorded") {
		t.Fatal(m.composeStatus)
	}
	m.composeMode = 3
	m.composer.SetValue("yes")
	if _, err := m.interventionInput(); err == nil {
		t.Fatal("abort accepted without lane confirmation")
	}
	m.composer.SetValue("L192")
	input, err := m.interventionInput()
	if err != nil || input.Confirmation != "L192" {
		t.Fatal("lane confirmation rejected", err)
	}
	m.composeMode = 4
	m.composer.SetValue("Keep 14 days")
	input, err = m.interventionInput()
	if err != nil || input.QuestionID == "" {
		t.Fatal("answer has no belonging question", err)
	}
}
func TestSignatureViewsFitAndNarrowStacks(t *testing.T) {
	m := fixtureModel(t)
	for _, size := range [][2]int{{120, 36}, {200, 50}, {90, 30}, {60, 18}} {
		m.width, m.height = size[0], size[1]
		for _, screen := range []string{"timeline", "graph", "transcript", "composer"} {
			m.screen = ""
			m.detail = screen == "transcript"
			m.overlay = ""
			if screen == "timeline" || screen == "graph" {
				m.screen = screen
			}
			if screen == "composer" {
				m.openComposer()
			}
			view := m.View()
			lines := strings.Split(view.Content, "\n")
			if len(lines) != m.height {
				t.Errorf("%v %s: height %d", size, screen, len(lines))
			}
			for _, line := range lines {
				if ansi.StringWidth(line) > m.width {
					t.Errorf("%v %s: width %d", size, screen, ansi.StringWidth(line))
				}
			}
		}
		m.overlay = ""
		m.screen = ""
		m.detail = true
		if m.width == 90 && !strings.Contains(ansi.Strip(m.detailView()), "SESSION / inspector") {
			t.Fatal("narrow inspector hidden")
		}
	}
}
