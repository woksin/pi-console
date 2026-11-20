# Run from the repository root: vhs spikes/tui-opentui/capture-wide.tape
Output .ai-work/opentui-r2-wide.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 2062
Set Height 1182
Set Padding 16
Hide
Type "node spikes/mock-daemon/server.ts > .ai-work/opentui-r2-wide-daemon.log 2>&1 & DAEMON=$!"
Enter
Sleep 1s
Type "stty size > .ai-work/opentui-r2-wide-size; PI_CONSOLE_TOKEN_FILE=$PWD/.pi-console-dev/token npm --prefix spikes/tui-opentui start -- --colors truecolor"
Enter
Sleep 3s
Show
Type "t"
Sleep 1s
Screenshot spikes/tui-opentui/timeline-200.png
Type "g"
Sleep 1s
Screenshot spikes/tui-opentui/graph-200.png
Type "i"
Sleep 1s
Screenshot spikes/tui-opentui/composer-200.png
Hide
Escape
Sleep 500ms
Type "q"
Sleep 1s
Type "kill $DAEMON; exit"
Enter
