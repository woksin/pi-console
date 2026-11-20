package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"pi-console/spikes/tui-bubbletea/api"
)

// Opt-in Tier 2: starts an unchanged, private loopback mock, then requires every
// documented endpoint and every distinct SSE event to decode to generated types.
func TestLiveGeneratedConformance(t *testing.T) {
	if os.Getenv("PI_CONFORMANCE") != "1" {
		t.Skip("set PI_CONFORMANCE=1 for live daemon conformance")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(filepath.Join(root, ".ai-work"), "bubbletea-conformance-")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	script := `import {startDaemon} from './spikes/mock-daemon/server.ts'; const d=await startDaemon({port:0,speed:300,dataDirectory:process.argv[1]}); console.log(JSON.stringify({port:d.port,token:d.token}));`
	process := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, dir)
	process.Dir = root
	process.Stderr = os.Stderr
	stdout, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = process.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { process.Process.Kill(); process.Wait() }()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("mock did not start", scanner.Err())
	}
	var boot struct {
		Port  json.Number
		Token string
	}
	if err = json.Unmarshal(scanner.Bytes(), &boot); err != nil {
		t.Fatal(err)
	}
	client, err := newClient("http://127.0.0.1:"+boot.Port.String(), boot.Token, newFeed())
	if err != nil {
		t.Fatal(err)
	}
	decode := func(path string, target any) {
		t.Helper()
		resp, err := client.request(ctx, path, 0)
		if err != nil {
			t.Fatal(path, err)
		}
		defer resp.Body.Close()
		decoder := json.NewDecoder(resp.Body)
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(target); err != nil {
			t.Fatal(path, err)
		}
	}
	decode("/overview", new(api.Overview))
	sessions := new(api.Sessions)
	decode("/sessions", sessions)
	for _, s := range sessions.Items {
		decode("/sessions/"+s.ID, new(api.SessionDetail))
		decode("/sessions/"+s.ID+"/transcript?limit=1000", new(api.Transcript))
	}
	decode("/requests?filter=all", new(api.Requests))
	decode("/requests?filter=unanswered", new(api.Requests))
	decode("/requests?filter=interrupted", new(api.Requests))
	decode("/questions", new(api.Questions))
	decode("/messages", new(api.Messages))
	decode("/jobs", new(api.Jobs))
	stream, err := client.request(ctx, "/stream", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	events := bufio.NewScanner(stream.Body)
	events.Buffer(make([]byte, 65536), 4<<20)
	required := map[string]bool{"snapshot": false, "session.updated": false, "transcript.appended": false, "request.observed": false, "request.interrupted": false, "question.asked": false, "message.sent": false, "job.updated": false, "job.finished": false, "reset.occurred": false, "intervention.recorded": false}
	submitted := false
	var data bytes.Buffer
	for events.Scan() {
		line := events.Bytes()
		if bytes.HasPrefix(line, []byte("data: ")) {
			data.Write(line[6:])
		}
		if len(line) != 0 || data.Len() == 0 {
			continue
		}
		var event api.Event
		decoder := json.NewDecoder(bytes.NewReader(data.Bytes()))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
		data.Reset()
		if _, err = event.DecodePayload(); err != nil {
			t.Fatal(event.Type, err)
		}
		required[event.Type] = true
		if !submitted {
			submitted = true
			for _, kind := range composeModes {
				input := api.InterventionInput{Type: kind, SessionID: "s2", Text: "conformance"}
				if kind == "abort" {
					input.Confirmation = "L192"
					input.Text = ""
				}
				if kind == "answer" {
					input.QuestionID = "q2"
				}
				if _, err = client.intervene(ctx, input); err != nil {
					t.Fatal(kind, err)
				}
			}
		}
		done := true
		for _, seen := range required {
			done = done && seen
		}
		if done {
			t.Logf("decoded %d event variants, all GET endpoints and five intervention variants", len(required))
			return
		}
	}
	if err = events.Err(); err != nil && err != io.EOF {
		t.Log(err)
	}
	for name, seen := range required {
		if !seen {
			t.Error("missing event", name)
		}
	}
}
