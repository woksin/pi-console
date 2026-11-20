package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

func fixtureModel(t *testing.T) *Model {
	t.Helper()
	raw, err := os.ReadFile("../fixture/data/fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Snapshot
		Transcript []Entry
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	feed := newFeed()
	feed.apply(Event{Type: "snapshot", Payload: raw})
	feed.mergeHistory("s2", fixture.Transcript)
	m := newModel(feed)
	m.Update(tickMsg(time.Now()))
	return m
}

func TestBothScreensFitTerminal(t *testing.T) {
	m := fixtureModel(t)
	for _, size := range [][2]int{{120, 36}, {200, 50}, {80, 24}, {60, 18}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		for _, detail := range []bool{false, true} {
			m.detail = detail
			view := m.View()
			lines := strings.Split(view.Content, "\n")
			if len(lines) != size[1] {
				t.Errorf("%v detail=%v: got %d lines", size, detail, len(lines))
			}
			for i, line := range lines {
				if ansi.StringWidth(line) > size[0] {
					t.Errorf("%v line %d exceeds width: %d", size, i, ansi.StringWidth(line))
				}
			}
			if !view.AltScreen || view.MouseMode != tea.MouseModeCellMotion {
				t.Fatal("missing fullscreen or mouse support")
			}
		}
	}
}

func TestNavigationAndPausedFollow(t *testing.T) {
	m := fixtureModel(t)
	m.keypress("enter")
	if !m.detail || m.selected != "s2" {
		t.Fatal("Enter did not open selected session")
	}
	m.keypress("up")
	anchor := m.anchor
	if anchor == 0 {
		t.Fatal("scrolling up did not pause follow")
	}
	m.feed.apply(Event{Seq: 1, Type: "transcript.appended", Payload: json.RawMessage(`{"cursor":2001,"sessionId":"s2","kind":"assistant.delta","text":"live"}`)})
	m.Update(tickMsg(time.Now()))
	if m.anchor != anchor || m.newCount != 1 {
		t.Fatalf("paused anchor moved or new counter wrong: %d %d", m.anchor, m.newCount)
	}
	m.keypress("f")
	if m.anchor != 0 || m.newCount != 0 {
		t.Fatal("follow failed")
	}
	m.keypress("esc")
	if m.detail {
		t.Fatal("Esc did not return")
	}
	m.keypress("j")
	if m.selected == "s2" {
		t.Fatal("selection did not move")
	}
	m.keypress("n")
	if !m.needsOnly {
		t.Fatal("needs-you filter failed")
	}
}

func TestTranscriptDisclosureOriginResetAndSearch(t *testing.T) {
	m := fixtureModel(t)
	for _, test := range []struct{ origin, want string }{{"human", "you"}, {"launch", "initial prompt"}, {"unproven", "origin not verified"}} {
		if got := originLabel(test.origin); got != test.want {
			t.Errorf("origin %s: %s", test.origin, got)
		}
	}
	thinking := Entry{Cursor: 1, Kind: "thinking", Text: "private reasoning"}
	m.blockCursor = thinking.Cursor
	if !strings.Contains(ansi.Strip(m.entryView(thinking, 76)), "▸ thinking") {
		t.Fatal("thinking not collapsed")
	}
	m.keypress("space")
	if !strings.Contains(ansi.Strip(m.entryView(thinking, 76)), "▾ thinking") {
		t.Fatal("thinking not expanded")
	}
	reset := Entry{Kind: "reset", ResetID: "reset1"}
	rendered := ansi.Strip(m.entryView(reset, 76))
	if !strings.Contains(rendered, "carried requests: r1, r2") {
		t.Fatal(rendered)
	}
	if !strings.Contains(ansi.Strip(m.rail(40)), "INTERRUPTED REQUEST") {
		t.Fatal("missing interrupted badge")
	}
	m.search = "retry"
	m.findSearch()
	if m.anchor == 0 {
		t.Fatal("search did not anchor a match")
	}
}

func TestPaletteFuzzyActionsAndMouse(t *testing.T) {
	m := fixtureModel(t)
	m.input.SetValue("arimpl")
	matches := m.actions()
	if len(matches) == 0 || matches[0].id != "session:s2" {
		t.Fatalf("fuzzy session missing: %v", matches)
	}
	m.execute(matches[0].id)
	if !m.detail {
		t.Fatal("palette did not navigate")
	}
	m.execute("fleet")
	m.mouseClick(5, 11)
	if m.selected == "s2" {
		t.Fatal("mouse did not select another row")
	}
	m.mouseClick(110, 10)
	if !m.focus {
		t.Fatal("mouse did not focus rail")
	}
}

func TestBracketedPasteInPalette(t *testing.T) {
	m := fixtureModel(t)
	m.Update(tea.PasteMsg{Content: ":"})
	if m.overlay != "palette" {
		t.Fatal("single shortcut paste did not open palette")
	}
	m.Update(tea.PasteMsg{Content: "aur impl"})
	if m.input.Value() != "aur impl" {
		t.Fatal("palette paste ignored")
	}
	m.overlayKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !m.detail || m.selected != "s2" {
		t.Fatal("pasted palette navigation failed")
	}
}

func TestSanitizeUntrustedTerminalText(t *testing.T) {
	hostile := "\x1b[2Jhello\x1b]52;c;YQ==\a\r\x00world"
	if got := safe(hostile); got != "helloworld" {
		t.Fatalf("unsafe text retained: %q", got)
	}
	if _, err := colorMode("invalid"); err == nil {
		t.Fatal("invalid color flag accepted")
	}
	for _, mode := range []string{"16", "256", "truecolor", "auto"} {
		if _, err := colorMode(mode); err != nil {
			t.Fatal(err)
		}
	}
}

func TestBoundedReadModelAndHistoryMerge(t *testing.T) {
	feed := newFeed()
	for i := 1; i <= 12000; i++ {
		feed.mu.Lock()
		feed.appendEntry(Entry{SessionID: "s2", Cursor: i})
		feed.mu.Unlock()
	}
	feed.mergeHistory("s2", []Entry{{SessionID: "s2", Cursor: 12000}, {SessionID: "s2", Cursor: 11999}})
	frame := feed.frame("s2")
	if len(frame.Entries) > 5000 || frame.Entries[len(frame.Entries)-1].Cursor != 12000 {
		t.Fatal("unbounded or unordered buffer")
	}
	for i := 1; i < len(frame.Entries); i++ {
		if frame.Entries[i].Cursor <= frame.Entries[i-1].Cursor {
			t.Fatal("duplicate or unordered cursor")
		}
	}
}
