package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthenticatedSSESnapshotDeltasAndResume(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-test" {
			t.Error("missing bearer")
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/v0/stream":
			if r.Header.Get("Last-Event-ID") == "7" {
				fmt.Fprint(w, "id: 8\nevent: session.updated\ndata: {\"seq\":8,\"type\":\"session.updated\",\"payload\":{\"id\":\"s2\",\"status\":\"done\"}}\n\n")
			} else {
				fmt.Fprint(w, "id: 6\nevent: snapshot\ndata: {\"seq\":6,\"type\":\"snapshot\",\"payload\":{\"sessions\":[{\"id\":\"s2\"}],\"transcriptCursors\":[{\"sessionId\":\"s2\",\"cursor\":1}]}}\n\n")
				fmt.Fprint(w, "id: 7\nevent: transcript.appended\ndata: {\"seq\":7,\"type\":\"transcript.appended\",\"payload\":{\"sessionId\":\"s2\",\"cursor\":2,\"kind\":\"assistant.delta\",\"text\":\"live\"}}\n\n")
			}
		case "/api/v0/sessions/s2/transcript":
			fmt.Fprint(w, `{"items":[{"sessionId":"s2","cursor":1,"kind":"user","text":"history"}],"nextCursor":1,"hasMore":false}`)
		default:
			t.Error("unexpected route", r.URL.Path)
		}
	}))
	defer server.Close()
	feed := newFeed()
	client, err := newClient(server.URL, "synthetic-test", feed)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	seq, _ := client.stream(ctx, 0)
	if seq != 7 {
		t.Fatalf("wrong cursor %d", seq)
	}
	deadline := time.Now().Add(time.Second)
	for len(feed.frame("s2").Entries) < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	frame := feed.frame("s2")
	if len(frame.Entries) != 2 || frame.Entries[0].Text != "history" || frame.Entries[1].Text != "live" {
		t.Fatal("snapshot history/delta merge failed", frame.Entries)
	}
	seq, _ = client.stream(ctx, seq)
	if seq != 8 || feed.frame("s2").Sessions[0].Status != "done" {
		t.Fatal("resume failed")
	}
}

func TestLoopbackOnlyAndHTTPFailure(t *testing.T) {
	for _, base := range []string{"https://example.com", "http://192.0.2.1:4777", "http://user:pass@localhost:4777", "junk"} {
		if _, err := newClient(base, "", newFeed()); err == nil {
			t.Errorf("accepted %s", base)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	client, _ := newClient(server.URL, "synthetic-test", newFeed())
	if _, err := client.request(context.Background(), "/overview", 0); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatal("HTTP error not surfaced", err)
	}
}

func TestProjectionUpserts(t *testing.T) {
	feed := newFeed()
	for _, event := range []Event{
		{Type: "request.observed", Payload: json.RawMessage(`{"id":"r1","sessionId":"s2","status":"open"}`)},
		{Type: "request.interrupted", Payload: json.RawMessage(`{"id":"r1","sessionId":"s2","status":"interrupted"}`)},
		{Type: "question.asked", Payload: json.RawMessage(`{"id":"q1","status":"open"}`)},
		{Type: "job.updated", Payload: json.RawMessage(`{"id":"j1","status":"running"}`)},
		{Type: "job.finished", Payload: json.RawMessage(`{"id":"j1","status":"done"}`)},
		{Type: "reset.occurred", Payload: json.RawMessage(`{"id":"reset1"}`)},
	} {
		feed.apply(event)
	}
	frame := feed.frame("s2")
	if len(frame.Requests) != 1 || frame.Requests[0].Status != "interrupted" || frame.Jobs[0].Status != "done" || len(frame.Resets) != 1 || len(frame.Questions) != 1 {
		t.Fatal("projection upsert failed")
	}
}
