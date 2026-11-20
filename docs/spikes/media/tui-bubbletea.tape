# Run from the repository root after building spikes/tui-bubbletea/pi-console.
# The hidden final step produces the wide companion screenshots as well.
Require node
Require vhs
Output docs/spikes/media/tui-bubbletea-navigation.gif
Set Shell bash
Set Width 1144
Set Height 700
Set FontSize 14
Set FontFamily "Menlo"
Set Padding 16
Set LineHeight 1.15
Set Framerate 12
Set TypingSpeed 35ms
Set Theme { "name": "Pi Midnight", "background": "#0b101a", "foreground": "#dbe5f3", "black": "#0b101a", "red": "#f08495", "green": "#91d4ad", "yellow": "#f4c077", "blue": "#82aaff", "magenta": "#b2a1f3", "cyan": "#61d6ec", "white": "#dbe5f3", "brightBlack": "#7f95b0", "brightRed": "#f08495", "brightGreen": "#91d4ad", "brightYellow": "#f4c077", "brightBlue": "#82aaff", "brightMagenta": "#b2a1f3", "brightCyan": "#61d6ec", "brightWhite": "#ffffff" }
Hide
Sleep 1s
Type "sh spikes/tui-bubbletea/demo.sh 120 36"
Enter
Sleep 1s
Show
Sleep 800ms
Screenshot docs/spikes/media/tui-bubbletea-fleet-120x36.png
Sleep 200ms
Enter
Sleep 400ms
Type "/"
Type "handoff"
Enter
Sleep 500ms
Screenshot docs/spikes/media/tui-bubbletea-detail-120x36.png
Sleep 200ms
Up 3
Sleep 500ms
Type ":"
Type "aur impl"
Sleep 1s
Enter
Sleep 1s
Type "?"
Sleep 800ms
Escape
Sleep 200ms
Type "f"
Sleep 1s
Escape
Sleep 200ms
Down
Sleep 500ms
Hide
Type "q"
Sleep 700ms
Type "vhs docs/spikes/media/tui-bubbletea-wide.tape >.ai-work/tui-bubbletea/wide-vhs.log 2>&1; echo WIDE_CAPTURE_DONE"
Enter
Sleep 16s
