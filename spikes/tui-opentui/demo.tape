# Run from the repository root: vhs spikes/tui-opentui/demo.tape
Output spikes/tui-opentui/signature-tour.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1262
Set Height 812
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 20ms
Hide
Type "node spikes/mock-daemon/server.ts > .ai-work/opentui-r2-daemon.log 2>&1 & DAEMON=$!"
Enter
Sleep 1s
Type "stty size > .ai-work/opentui-r2-size; PI_CONSOLE_TOKEN_FILE=$PWD/.pi-console-dev/token COLORTERM=truecolor npm --prefix spikes/tui-opentui start -- --colors truecolor"
Enter
Sleep 3s
Show
Sleep 1s
Type "t"
Sleep 2s
Screenshot spikes/tui-opentui/timeline-120.png
Type "+"
Sleep 1s
Type "l"
Sleep 1s
Type "c"
Sleep 1s
Type "c"
Sleep 500ms
Type "]"
Sleep 500ms
Enter
Sleep 1s
Type "]"
Sleep 500ms
Enter
Sleep 1s
Type "g"
Sleep 2s
Screenshot spikes/tui-opentui/graph-120.png
Sleep 13s
Type "jjjj"
Sleep 1s
Screenshot spikes/tui-opentui/edge-120.png
Type "i"
Sleep 1s
Type "Preserve the streamed audit trail."
Enter
Type "Report evidence before continuing."
Sleep 1s
Screenshot spikes/tui-opentui/composer-120.png
Ctrl+S
Sleep 2s
Screenshot spikes/tui-opentui/recorded-120.png
Escape
Sleep 1s
Ctrl+P
Type "timeline"
Sleep 1s
Enter
Sleep 1s
Type "q"
Hide
Sleep 1s
Type "kill $DAEMON; exit"
Enter
