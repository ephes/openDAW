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
now keeps the newest `CAPTURE_MIDI_MAX_EVENTS` (8192) events. As events leave
the window, their held state is folded into a map of at most 128 MIDI pitches.
Each entry keeps the latest velocity and outstanding press count. Resolution
clips carried starts to the oldest retained event and copies the state before
walking events, so repeated previews cannot consume release counts.
`captureNoteOnCount` includes retained attacks plus one note per carried pitch;
reset, disarm and recording start clear both events and carried state. Invalid
MIDI pitches are ignored by retrospective buffering, keeping the carry bound
independent of callers of `notify`. The limit remains an event-count bound;
there is no additional time-based expiry.

Tests (`CaptureMidi.test.ts`, synthetic `EventTarget` inputs and observables):
cross-channel and cross-input releases, one release per held press on disarm,
200 presses of one key, history bound with newest-note retention and a
below-bound control. The regression tests fail against the previous production
file and pass with the fix.

## Retrospective completion (2026-11-13)

The clerk's two remaining round-83 gaps still applied at main `47fccb8c`:
the retrospective resolver overwrote same-pitch attacks, and trimming discarded
the beginnings of held notes. The live `RecordMidi` fix was already present.
Retrospective resolution now finalizes the preceding note on every retrigger
and ends the latest note only after the last outstanding release, matching live
recording and preserving the existing 1/128-note minimum duration.

Codex implemented the completion directly in `CaptureMidi`, using the existing
test harness with synthetic signals, a controlled clock and transport observables.
Six added regression cases failed against the unchanged production file before
implementation: retrigger durations/velocities, loop wrap, coincident attacks,
open/released held notes across trimming, and retrigger counts across trimming.
Additional coverage exercises playback-mode trimming, all 128 carried pitches,
invalid pitches, repeated resolution and reset/disarm cleanup. Local validation
passed: `npm ci --ignore-scripts`, `npm run build`, `npm run lint` (existing
warnings, no errors), and `npm test`. All 19 targeted `CaptureMidi` tests passed.
Cross-family review and merge remain with
the external clerk; this worker parks the feature branch without invoking Claude.
