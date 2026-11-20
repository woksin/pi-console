package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/colorprofile"
)

func main() {
	base := flag.String("url", "http://127.0.0.1:4777", "loopback mock daemon URL")
	tokenFile := flag.String("token-file", ".pi-console-dev/token", "development token file (run from repository root)")
	colors := flag.String("colors", "auto", "auto, 16, 256, or truecolor")
	duration := flag.Duration("duration", 0, "optional automatic exit, useful for measurement")
	detail := flag.Bool("detail", false, "open the recorded s2 transcript on startup")
	flag.Parse()
	profile, err := colorMode(*colors)
	if err != nil {
		fatal(err)
	}
	token, err := os.ReadFile(*tokenFile)
	if err != nil {
		fatal(fmt.Errorf("read token: %w", err))
	}
	feed := newFeed()
	client, err := newClient(*base, string(token), feed)
	if err != nil {
		fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.run(ctx)
	model := newModel(feed)
	model.detail = *detail
	program := tea.NewProgram(model, tea.WithColorProfile(profile))
	if *duration > 0 {
		go func() {
			select {
			case <-time.After(*duration):
				program.Send(tea.Quit())
			case <-ctx.Done():
			}
		}()
	}
	if _, err := program.Run(); err != nil {
		fatal(err)
	}
}

func colorMode(mode string) (colorprofile.Profile, error) {
	switch mode {
	case "truecolor":
		return colorprofile.TrueColor, nil
	case "256":
		return colorprofile.ANSI256, nil
	case "16":
		return colorprofile.ANSI, nil
	case "auto":
		if os.Getenv("COLORTERM") == "truecolor" || os.Getenv("COLORTERM") == "24bit" {
			return colorprofile.TrueColor, nil
		}
		return colorprofile.Detect(os.Stdout, os.Environ()), nil
	default:
		return colorprofile.Unknown, fmt.Errorf("invalid --colors: use 16, 256, truecolor, or auto")
	}
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
