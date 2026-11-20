# Run from repository root: bash spikes/tui-pitui/capture.sh
# VHS dimensions are global: the companion wide.tape captures the 200x50 PNGs.
# This tape creates the 120x36 PNGs and the <=15s navigation/streaming GIF.
Output docs/spikes/media/tui-pitui-demo.gif
Require node
Require bash
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1230
Set Height 840
Set Padding 0
Set LineHeight 1.25
Set Framerate 10
Set Theme {"background":"#0b1019","foreground":"#d9e3ee","black":"#101925","red":"#f48291","green":"#8dd5ad","yellow":"#f4c16e","blue":"#8aa5ff","magenta":"#b7a0ed","cyan":"#6cdef1","white":"#d9e3ee","brightBlack":"#8193a9","brightRed":"#f48291","brightGreen":"#8dd5ad","brightYellow":"#f4c16e","brightBlue":"#8aa5ff","brightMagenta":"#e79fd1","brightCyan":"#6cdef1","brightWhite":"#ffffff"}
Hide
Type "bash spikes/tui-pitui/record.sh 120 36 4783 30"
Enter
Sleep 1s
Wait+Screen /NEEDS YOU/
Show
Sleep 1s
Screenshot docs/spikes/media/tui-pitui-fleet-120x36.png
Type@10ms ":L192 aurora"
Sleep 500ms
Enter
Wait+Screen /TRANSCRIPT/
Type "r"
Sleep 700ms
Screenshot docs/spikes/media/tui-pitui-detail-120x36.png
Sleep 1s
Type "k"
Sleep 700ms
Type "f"
Sleep 1s
Type@10ms ":theme"
Sleep 500ms
Enter
Sleep 700ms
Type "?"
Sleep 1s
Escape
Sleep 500ms
Hide
Type "q"
Sleep 500ms
