# Run from the repository root: vhs spikes/tui-opentui/demo.tape
Output spikes/tui-opentui/demo.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1262
Set Height 734
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms
Hide
Type "node spikes/mock-daemon/server.ts > .ai-work/opentui-daemon.log 2>&1 & DAEMON=$!"
Enter
Sleep 1s
Type "stty size > .ai-work/opentui-capture-size; COLORTERM=truecolor npm --prefix spikes/tui-opentui start -- --colors truecolor"
Enter
Sleep 3s
Show
Screenshot spikes/tui-opentui/overview-120.png
Sleep 6s
Enter
Sleep 2s
Screenshot spikes/tui-opentui/session-120.png
Sleep 3s
Up 3
Sleep 1s
Type "f"
Sleep 1s
Ctrl+P
Sleep 500ms
Type "theme"
Sleep 1s
Escape
Sleep 500ms
Type "?"
Sleep 2s
Escape
Sleep 500ms
Type "q"
Hide
Sleep 1s
Type "kill $DAEMON; exit"
Enter
