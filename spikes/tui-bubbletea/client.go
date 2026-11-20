package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	base, token string
	http        *http.Client
	feed        *Feed
}

func newClient(base, token string, feed *Feed) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") || u.User != nil {
		return nil, errors.New("daemon URL must be loopback HTTP")
	}
	return &Client{strings.TrimRight(base, "/"), strings.TrimSpace(token), &http.Client{}, feed}, nil
}

func (c *Client) request(ctx context.Context, path string, seq int) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.base+"/api/v0"+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if seq > 0 {
		req.Header.Set("Last-Event-ID", strconv.Itoa(seq))
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("daemon HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

func (c *Client) run(ctx context.Context) {
	seq := 0
	for ctx.Err() == nil {
		next, err := c.stream(ctx, seq)
		seq = next
		if err != nil {
			c.feed.disconnected(err)
		}
		// A restarted daemon may reject a cursor from its previous lifetime.
		if err != nil && strings.Contains(err.Error(), "HTTP 400") {
			seq = 0
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (c *Client) stream(ctx context.Context, seq int) (int, error) {
	resp, err := c.request(ctx, "/stream", seq)
	if err != nil {
		return seq, err
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 65536), 4<<20)
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
		if line != "" || data.Len() == 0 {
			continue
		}
		var event Event
		err := json.Unmarshal([]byte(data.String()), &event)
		data.Reset()
		if err != nil {
			return seq, fmt.Errorf("invalid SSE payload: %w", err)
		}
		c.feed.apply(event)
		seq = event.Seq
		if event.Type == "snapshot" {
			go c.loadHistories(ctx, event.Payload)
		}
	}
	if err := scanner.Err(); err != nil {
		return seq, err
	}
	return seq, io.EOF
}

func (c *Client) loadHistories(ctx context.Context, raw json.RawMessage) {
	var snapshot struct {
		TranscriptCursors []struct {
			SessionID string
			Cursor    int
		}
	}
	if json.Unmarshal(raw, &snapshot) != nil {
		return
	}
	for _, item := range snapshot.TranscriptCursors {
		if item.Cursor > 0 {
			c.loadHistory(ctx, item.SessionID, item.Cursor)
		}
	}
}

func (c *Client) loadHistory(ctx context.Context, id string, target int) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var history []Entry
	after := max(0, target-5000)
	for page := 0; page < 6; page++ {
		path := fmt.Sprintf("/sessions/%s/transcript?after=%d&limit=1000", url.PathEscape(id), after)
		resp, err := c.request(ctx, path, 0)
		if err != nil {
			return
		}
		var result struct {
			Items      []Entry
			NextCursor int
			HasMore    bool
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&result)
		resp.Body.Close()
		if err != nil {
			return
		}
		history = append(history, result.Items...)
		if !result.HasMore || result.NextCursor >= target || result.NextCursor <= after {
			break
		}
		after = result.NextCursor
	}
	c.feed.mergeHistory(id, history)
}
