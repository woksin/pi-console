# Run from the repository root.
Output .ai-work/opentui-wide.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 2062
Set Height 1007
Set Padding 16
Hide
Type "node spikes/mock-daemon/server.ts > .ai-work/opentui-wide-daemon.log 2>&1 & DAEMON=$!"
Enter
Sleep 1s
Type "stty size > .ai-work/opentui-wide-size; npm --prefix spikes/tui-opentui start -- --colors truecolor"
Enter
Sleep 3s
Show
Escape
Sleep 500ms
Screenshot spikes/tui-opentui/overview-200.png
Enter
Sleep 2s
Screenshot spikes/tui-opentui/session-200.png
Hide
Type "q"
Sleep 1s
Type "kill $DAEMON; exit"
Enter
