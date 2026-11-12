# Round 83 B05: MIDI input note ownership and bounded retrospective history

Both slices were reverified against main at d08d9519 and still applied.

`opendaw-midi-input-channel-note-ownership`: `CaptureMidi`'s live stream counted
held notes in one `Int8Array(128)` shared by every subscribed input and channel.
With all channels/devices selected, a note-off on another channel or input
released a press it did not own (the engine's raw note-off ends the first running
note of that pitch); the counter wrapped after 127 presses so later releases were
dropped; and closing the stream emitted each held count once for each of the 16
channels, i.e. sixteen engine releases per press. Counts are now `Uint32Array`s
keyed by channel and pitch per input, and stream closure emits exactly one
`NoteSignal.off` per held press.

`opendaw-retrospective-midi-bounded-history`: while armed and not recording,
every note signal was appended to the retrospective capture buffer with no bound,
so a long armed session grew memory and commit cost without limit. The buffer
now keeps the newest `CAPTURE_MIDI_MAX_EVENTS` (8192) events, dropping the oldest
and keeping `captureNoteOnCount` consistent. Orphaned releases are already
ignored by note resolution. The limit is a count bound chosen as a conservative
default; a time-based window would need an owner decision.

Tests (`CaptureMidi.test.ts`, synthetic `EventTarget` inputs and observables):
cross-channel and cross-input releases, one release per held press on disarm,
200 presses of one key, history bound with newest-note retention and a
below-bound control. The regression tests fail against the previous production
file and pass with the fix.
