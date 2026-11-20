package main

import (
	"fmt"
	"image/color"
	"strings"
	"unicode"

	lg "charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

var (
	bg      = "#0b101a"
	surface = "#101927"
	raised  = "#172638"
	ink     = "#dbe5f3"
	muted   = "#7f95b0"
	dim     = "#465c78"
	cyan    = "#61d6ec"
	amber   = "#f4c077"
	green   = "#91d4ad"
	red     = "#f08495"
	violet  = "#b2a1f3"
)

func setTheme(contrast bool) {
	bg = "#0b101a"
	surface = "#101927"
	raised = "#172638"
	ink = "#dbe5f3"
	muted = "#7f95b0"
	dim = "#465c78"
	if contrast {
		bg = "#000000"
		surface = "#050505"
		raised = "#242424"
		ink = "#ffffff"
		muted = "#b8c2cf"
		dim = "#71849b"
	}
}

func paint(text, c string) string { return lg.NewStyle().Foreground(lg.Color(c)).Render(text) }
func strong(text, c string) string {
	return lg.NewStyle().Bold(true).Foreground(lg.Color(c)).Render(text)
}
func safe(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) && r != '\n' {
			return -1
		}
		return r
	}, ansi.Strip(s))
}
func cell(text string, w int) string { return pad(ansi.Truncate(safe(text), max(0, w), "…"), w) }
func pad(s string, w int) string     { return s + strings.Repeat(" ", max(0, w-ansi.StringWidth(s))) }
func cut(s string, w int) string     { return ansi.Truncate(s, max(0, w), "…") }

func badge(status string) (string, string) {
	switch status {
	case "needs-you", "open", "unanswered":
		return "!", amber
	case "working", "running":
		return "*", cyan
	case "waiting", "queued":
		return "~", violet
	case "blocked":
		return "x", "#eba26d"
	case "failed":
		return "x", red
	case "done", "answered":
		return "v", green
	case "interrupted":
		return "/", "#e59ad6"
	case "idle":
		return "-", muted
	default:
		return "?", muted
	}
}
func statusLabel(status string) string { g, c := badge(status); return paint(g+" "+safe(status), c) }

// Every panel owns a fixed cell rectangle, so long content cannot move a sibling.
func panel(title, body string, w, h int, focus bool, accent string) string {
	w = max(6, w)
	h = max(3, h)
	border := dim
	if focus {
		border = cyan
	}
	top := paint("╭─", border) + strong(" "+title+" ", accent)
	top += paint(strings.Repeat("─", max(0, w-ansi.StringWidth(top)-1))+"╮", border)
	lines := strings.Split(body, "\n")
	out := []string{cut(top, w)}
	for i := 0; i < h-2; i++ {
		line := ""
		if i < len(lines) {
			line = lines[i]
		}
		line = pad(cut(line, w-4), w-4)
		out = append(out, paint("│", border)+" "+line+" "+paint("│", border))
	}
	out = append(out, paint("╰"+strings.Repeat("─", w-2)+"╯", border))
	return lg.NewStyle().Background(lg.Color(surface)).Foreground(lg.Color(ink)).Render(strings.Join(out, "\n"))
}

func spark(samples []Sample, n int) string {
	glyphs := []rune("▁▂▃▄▅▆▇█")
	if len(samples) == 0 {
		return strings.Repeat("▁", n)
	}
	var out strings.Builder
	for i := 0; i < n; i++ {
		s := samples[i*len(samples)/n]
		c := cyan
		if s.ContextPercent >= 70 {
			c = amber
		}
		if s.ContextPercent >= 85 {
			c = red
		}
		out.WriteString(paint(string(glyphs[min(7, s.ContextPercent*8/101)]), c))
	}
	return out.String()
}

func gradient(text string) string {
	colors := []string{"#70e4d4", "#6bdedc", "#66d8e5", "#64cfee", "#69c4f4", "#78b7f5", "#8baaf1", "#9c9ce9", "#ad90dc", "#bb87cb"}
	var out strings.Builder
	for i, r := range text {
		out.WriteString(strong(string(r), colors[i%len(colors)]))
	}
	return out.String()
}

func blend(a, b color.RGBA, t float64) string {
	channel := func(x, y uint8) uint8 { return uint8(float64(x) + (float64(y)-float64(x))*t) }
	return fmt.Sprintf("#%02x%02x%02x", channel(a.R, b.R), channel(a.G, b.G), channel(a.B, b.B))
}

func wrapped(text string, w int) string { return ansi.Hardwrap(safe(text), max(1, w), true) }
