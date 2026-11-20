package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"charm.land/bubbles/v2/textarea"
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
	"pi-console/spikes/tui-bubbletea/api"
)

var composeModes = []string{"steer", "followUp", "nextTurn", "abort", "answer"}

type interventionResult struct {
	audit api.Intervention
	err   error
}

func (m *Model) openComposer() tea.Cmd {
	m.overlay = "composer"
	m.composeTarget = m.selected
	m.composeMode = 0
	m.composeStatus = ""
	m.pendingAudit = ""
	m.submitting = false
	m.composer = textarea.New()
	m.composer.Placeholder = "A precise nudge. The daemon records an audit; it does not deliver it."
	m.composer.CharLimit = 10000
	m.composer.ShowLineNumbers = false
	m.composer.SetWidth(min(76, m.width-14))
	m.composer.SetHeight(5)
	m.motion = 0
	m.motionVelocity = 0
	return m.composer.Focus()
}
func (m *Model) interventionInput() (api.InterventionInput, error) {
	body := api.InterventionInput{Type: composeModes[m.composeMode], SessionID: m.composeTarget, Text: strings.TrimSpace(m.composer.Value())}
	if body.Type == "abort" {
		lane := ""
		for _, s := range m.frame.Sessions {
			if s.ID == m.composeTarget {
				lane = s.LaneID
			}
		}
		if lane == "" || body.Text != lane {
			return body, fmt.Errorf("confirm abort: type the target lane id exactly")
		}
		body.Confirmation = lane
		body.Text = ""
		return body, nil
	}
	if body.Text == "" {
		return body, fmt.Errorf("write a message before submitting")
	}
	if body.Type == "answer" {
		for _, q := range m.frame.Questions {
			if q.SessionID == body.SessionID && q.Status == "open" {
				body.QuestionID = q.ID
				break
			}
		}
		if body.QuestionID == "" {
			return body, fmt.Errorf("no open question belongs to this session")
		}
	}
	return body, nil
}
func (c *Client) intervene(ctx context.Context, body api.InterventionInput) (api.Intervention, error) {
	var audit api.Intervention
	raw, err := json.Marshal(body)
	if err != nil {
		return audit, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.base+"/api/v0/interventions", bytes.NewReader(raw))
	if err != nil {
		return audit, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return audit, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return audit, fmt.Errorf("intervention HTTP %d", resp.StatusCode)
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&audit)
	return audit, err
}
func (m *Model) submitComposer() tea.Cmd {
	if m.submitting {
		return nil
	}
	body, err := m.interventionInput()
	if err != nil {
		m.composeStatus = err.Error()
		return nil
	}
	if m.client == nil {
		m.composeStatus = "No daemon client configured"
		return nil
	}
	m.submitting = true
	m.composeStatus = "Recording mock intervention…"
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		audit, err := m.client.intervene(ctx, body)
		return interventionResult{audit, err}
	}
}
func (m *Model) composerKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		m.overlay = ""
		m.composer.Blur()
		return nil
	case "tab", "shift+tab":
		delta := 1
		if msg.String() == "shift+tab" {
			delta = -1
		}
		m.composeMode = (m.composeMode + delta + len(composeModes)) % len(composeModes)
		m.composeStatus = ""
		return nil
	case "ctrl+s":
		return m.submitComposer()
	}
	var cmd tea.Cmd
	m.composer, cmd = m.composer.Update(msg)
	return cmd
}
func (m *Model) composerView(base string) string {
	w := min(86, m.width-6)
	tabs := []string{}
	for i, mode := range composeModes {
		label := " " + mode + " "
		if i == m.composeMode {
			label = lg.NewStyle().Background(lg.Color(cyan)).Foreground(lg.Color(bg)).Bold(true).Render(label)
		} else {
			label = paint(label, muted)
		}
		tabs = append(tabs, label)
	}
	target := Session{}
	for _, s := range m.frame.Sessions {
		if s.ID == m.composeTarget {
			target = s
		}
	}
	last := "No request recorded"
	for _, r := range m.frame.Requests {
		if r.SessionID == target.ID {
			last = r.Text
		}
	}
	lines := []string{strings.Join(tabs, " "), "", strong(safe(target.LaneID+" · "+target.Name), ink) + "  " + statusLabel(target.Status), paint("LAST REQUEST  "+cut(safe(last), w-20), muted), paint(strings.Repeat("─", w-4), dim), m.composer.View()}
	if composeModes[m.composeMode] == "abort" {
		lines = append(lines, strong("Confirm abort: replace input with lane id "+safe(target.LaneID), red))
	}
	state := m.composeStatus
	if state == "" {
		state = "MOCK ONLY · audit recorded, no command delivered"
	}
	lines = append(lines, paint(cut(state, w-4), amber), "", paint("tab mode   enter newline   ctrl+s submit   esc close", muted))
	h := min(m.height-2, len(strings.Split(strings.Join(lines, "\n"), "\n"))+2)
	box := panel("INTERVENTION / deliberate control", strings.Join(lines, "\n"), w, h, true, amber)
	y := min(m.height-h, max(0, (m.height-h)/2+int((1-m.motion)*4)))
	return lg.NewCompositor(lg.NewLayer(base), lg.NewLayer(box).X((m.width-w)/2).Y(y).Z(1)).Render()
}
