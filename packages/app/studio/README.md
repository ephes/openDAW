
### Automation editing

Failed point deletions and batch moves restore the visible/playback event index
from graph state before the next edit. Automation and note-property node capture
chooses the nearest point; equal distances keep the first candidate in iteration
order. Property capture retains selected-note priority and the rendered one-pixel
offset.

Tempo lanes display raw BPM ramps through a logarithmic axis. Painted curves,
midpoint handles, capture and slope gestures all use the same stored BPM domain;
panning or clipping the viewport leaves the depicted curve unchanged. Parameter
automation retains its affine display path.
