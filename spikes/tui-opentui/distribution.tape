# Pack and install as documented in README.md before running this from the repository root.
Output .ai-work/opentui-r2-dist/launch.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1262
Set Height 812
Set Padding 16
Hide
Type "node spikes/mock-daemon/server.ts > .ai-work/opentui-r2-dist/daemon.log 2>&1 & DAEMON=$!"
Enter
Sleep 1s
Type "PI_CONSOLE_TOKEN_FILE=$PWD/.pi-console-dev/token .ai-work/opentui-r2-dist/install-final/node_modules/.bin/pi-console-opentui --colors truecolor"
Enter
Sleep 3s
Show
Type "g"
Sleep 2s
Screenshot spikes/tui-opentui/distribution-120.png
Type "t"
Sleep 1s
Type "q"
Hide
Sleep 1s
Type "kill $DAEMON; exit"
Enter
