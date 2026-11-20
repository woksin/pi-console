# Invoked by tui-bubbletea.tape; can also run independently from repository root.
Require node
Output .ai-work/tui-bubbletea/wide.gif
Set Shell bash
Set Width 1864
Set Height 952
Set FontSize 14
Set FontFamily "Menlo"
Set Padding 16
Set LineHeight 1.15
Set Framerate 8
Hide
Sleep 1s
Type "sh spikes/tui-bubbletea/demo.sh 200 50"
Enter
Sleep 1s
Show
Sleep 500ms
Screenshot docs/spikes/media/tui-bubbletea-fleet-200x50.png
Sleep 200ms
Enter
Sleep 400ms
Type "/"
Type "handoff"
Enter
Sleep 500ms
Screenshot docs/spikes/media/tui-bubbletea-detail-200x50.png
Sleep 200ms
Type "q"
Sleep 500ms
