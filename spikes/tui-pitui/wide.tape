# Run from repository root: vhs spikes/tui-pitui/wide.tape
Output .ai-work/pitui-media/wide.gif
Require node
Require bash
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 2030
Set Height 1170
Set Padding 0
Set LineHeight 1.25
Set Framerate 5
Set Theme {"background":"#0b1019","foreground":"#d9e3ee"}
Hide
Type "bash spikes/tui-pitui/record.sh 200 50 4784 30"
Enter
Wait+Screen /NEEDS YOU/
Show
Sleep 1s
Screenshot docs/spikes/media/tui-pitui-fleet-200x50.png
Type ":L192 aurora"
Enter
Wait+Screen /TRANSCRIPT/
Type "r"
Sleep 1s
Screenshot docs/spikes/media/tui-pitui-detail-200x50.png
Sleep 500ms
Hide
Type "q"
Sleep 500ms
