
### Automation editing

Failed point deletions and batch moves restore the visible/playback event index
from graph state before the next edit. Automation and note-property node capture
chooses the nearest point; equal distances keep the first candidate in iteration
order. Property capture retains selected-note priority and the rendered one-pixel
offset.
