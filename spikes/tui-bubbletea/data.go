package main

import (
	"encoding/json"
	"sort"
	"sync"
	"time"
)

type Sample struct {
	ContextPercent int
	Tokens         int
	CostUsd        float64
}
type Session struct {
	ID                                                                               string `json:"id"`
	RepositoryID                                                                     string `json:"repositoryId"`
	Name, LaneID, Role, ParentSessionID, Branch, Model, Status, StartedAt, UpdatedAt string
	ContextPercent                                                                   int
	Samples                                                                          []Sample
}
type Answer struct{ Text string }
type Request struct {
	ID, SessionID, Text, Origin, Status, ResetID string
	Answer                                       *Answer
	InterimAnswers                               []Answer
}
type Question struct {
	ID, SessionID, Text, Status string
	Blocking                    bool
}
type Job struct {
	ID, SessionID, Name, Kind, Status string
	ExitCode                          *int
}
type Reset struct {
	ID, SessionID, Kind                      string
	CarriedRequestIDs, InterruptedRequestIDs []string
}
type Entry struct {
	ID, SessionID, At, Kind, Text, ToolCallID, ResetID string
	Cursor                                             int
}
type Snapshot struct {
	Sessions  []Session
	Requests  []Request
	Questions []Question
	Jobs      []Job
	Resets    []Reset
}
type Event struct {
	Seq     int
	Type    string
	Payload json.RawMessage
}

// The network writer never drives the renderer. The UI samples a bounded read
// model at 20 Hz, regardless of whether SSE emits 5 or 5,000 entries per second.
type Feed struct {
	mu            sync.Mutex
	state         Snapshot
	entries       map[string][]Entry
	changed       map[string]time.Time
	connected     bool
	problem       string
	seq, received int
}

type Frame struct {
	Snapshot
	Entries       []Entry
	Changed       map[string]time.Time
	Connected     bool
	Problem       string
	Seq, Received int
}

func newFeed() *Feed { return &Feed{entries: map[string][]Entry{}, changed: map[string]time.Time{}} }

func upsert[T any](items []T, value T, id func(T) string) []T {
	for i, item := range items {
		if id(item) == id(value) {
			items[i] = value
			return items
		}
	}
	return append(items, value)
}

func decodeUpsert[T any](raw json.RawMessage, items []T, id func(T) string) []T {
	var value T
	if json.Unmarshal(raw, &value) != nil {
		return items
	}
	return upsert(items, value, id)
}

func (f *Feed) apply(event Event) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq = event.Seq
	f.connected = true
	f.problem = ""
	switch event.Type {
	case "snapshot":
		var snapshot Snapshot
		if json.Unmarshal(event.Payload, &snapshot) == nil {
			f.state = snapshot
			f.entries = map[string][]Entry{}
		}
	case "session.updated":
		var s Session
		if json.Unmarshal(event.Payload, &s) == nil {
			f.state.Sessions = upsert(f.state.Sessions, s, func(s Session) string { return s.ID })
			f.changed[s.ID] = time.Now()
		}
	case "transcript.appended":
		var e Entry
		if json.Unmarshal(event.Payload, &e) == nil {
			f.appendEntry(e)
			f.received++
		}
	case "request.observed", "request.interrupted":
		f.state.Requests = decodeUpsert(event.Payload, f.state.Requests, func(r Request) string { return r.ID })
	case "question.asked":
		f.state.Questions = decodeUpsert(event.Payload, f.state.Questions, func(q Question) string { return q.ID })
	case "job.updated", "job.finished":
		f.state.Jobs = decodeUpsert(event.Payload, f.state.Jobs, func(j Job) string { return j.ID })
	case "reset.occurred":
		f.state.Resets = decodeUpsert(event.Payload, f.state.Resets, func(r Reset) string { return r.ID })
	}
}

func (f *Feed) appendEntry(e Entry) {
	items := f.entries[e.SessionID]
	if len(items) > 0 && e.Cursor <= items[len(items)-1].Cursor {
		return
	}
	if len(items) >= 5000 {
		copy(items, items[1000:])
		items = items[:len(items)-1000]
	}
	f.entries[e.SessionID] = append(items, e)
}

func (f *Feed) mergeHistory(id string, history []Entry) {
	f.mu.Lock()
	defer f.mu.Unlock()
	all := append(history, f.entries[id]...)
	sort.Slice(all, func(i, j int) bool { return all[i].Cursor < all[j].Cursor })
	unique := make([]Entry, 0, len(all))
	for _, e := range all {
		if len(unique) == 0 || unique[len(unique)-1].Cursor != e.Cursor {
			unique = append(unique, e)
		}
	}
	if len(unique) > 5000 {
		unique = unique[len(unique)-5000:]
	}
	f.entries[id] = unique
}

func (f *Feed) frame(id string) Frame {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.state
	s.Sessions = append([]Session(nil), s.Sessions...)
	s.Requests = append([]Request(nil), s.Requests...)
	s.Questions = append([]Question(nil), s.Questions...)
	s.Jobs = append([]Job(nil), s.Jobs...)
	s.Resets = append([]Reset(nil), s.Resets...)
	changed := make(map[string]time.Time, len(f.changed))
	for id, at := range f.changed {
		changed[id] = at
	}
	return Frame{s, append([]Entry(nil), f.entries[id]...), changed, f.connected, f.problem, f.seq, f.received}
}

func (f *Feed) disconnected(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.connected = false
	f.problem = err.Error()
}
