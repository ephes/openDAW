# Note display ownership

`NoteBroadcaster` publishes one bit per pitch for device and instrument note
displays. It now counts starts per pitch: overlapping notes of the same pitch keep
the bit set until the last one stops, and a stop without a displayed start is
ignored. `clear()`/`reset()` drop all counts.

Pitch, Velocity and Zeitgeist own a note display but did not clear it on reset,
so notes active during a transport jump or chain rebuild stayed lit. Their
`reset()` now clears the display, like the instruments already do.

The Velocity device writes one packed entry per note into a 1024-slot broadcast
buffer and terminates it with zero when the frame is sent. When the main thread
does not read for a while, the cursor ran past the buffer, the terminator was
lost and the editor drew the whole stale buffer. Writes now stop one slot short of
the end, so the terminator always fits; excess notes in that frame are dropped
from the display only.

Regressions: `core-processors/src/devices/midi-effects/NoteDisplay.test.ts`.
