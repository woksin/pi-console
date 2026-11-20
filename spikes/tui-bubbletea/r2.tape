# Reference 120x36 tape. r2-capture.mjs creates size-specific tapes and a private
# daemon, then runs these actions at 120x36, 200x50 and 90x30.
# Manual use: start the mock at :4777, build npm/build.mjs, then vhs this file.
Output docs/spikes/media/r2-bubbletea-motion.gif
Set Shell bash
Set Width 1144
Set Height 703
Set FontFamily "Menlo"
Set FontSize 14
Set LineHeight 1.15
Set Padding 16
Set Framerate 10
Set TypingSpeed 0
Hide
Type "stty cols 120 rows 36; exec .ai-work/tasks/m0r2-bubbletea/output/npm/darwin-arm64/bin/pi-console --screen graph --colors truecolor"
Enter
Sleep 500ms
Show
Sleep 2s
Screenshot docs/spikes/media/r2-bubbletea-graph-120x36.png
Sleep 500ms
Type "t"
Sleep 2s
Screenshot docs/spikes/media/r2-bubbletea-timeline-120x36.png
Sleep 500ms
Type "i"
Type "Verify the checkpoint before handoff."
Enter
Type "Keep the retry budget bounded."
Ctrl+S
Sleep 1s
Screenshot docs/spikes/media/r2-bubbletea-composer-120x36.png
Sleep 500ms
Escape
Enter
Type "f[ [ "
Sleep 1s
Screenshot docs/spikes/media/r2-bubbletea-transcript-120x36.png
Sleep 1s
