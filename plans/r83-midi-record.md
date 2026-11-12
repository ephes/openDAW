# Round 83 B04: MIDI recording latency default and retrigger preservation

Both slices were reverified against main at d08d9519 and still applied.

`opendaw-midi-unknown-latency-safe-default`: `RecordMidi` used
`audioContext.outputLatency ?? 10.0`, i.e. ten *seconds*, when the browser does
not report output latency, so every recorded note was written twenty beats (at
120 bpm) late; NaN, infinite or negative values propagated unchanged. The MIDI
output path in `EngineWorklet` multiplied an undefined latency into NaN send
timestamps. `AudioUtils.outputLatencySeconds` now maps missing, non-finite or
negative values to zero (matching `CaptureAudio`'s `?? 0`) and both paths use it.

`opendaw-midi-retrigger-record-preservation`: active recorded notes were keyed by
pitch only. A note-on for a pitch that was still held replaced the active note,
and the next note-off (the release of the earlier press, e.g. a sequencer sending
the new note-on before the old note-off) stopped the new note, leaving it at the
1/128 minimum length. `RecordMidi` now counts presses per pitch and ends the
recorded note only at the last release. The earlier note still ends at the
retrigger point. Releases without a recorded press keep being ignored.

Tests (`RecordMidi.test.ts`) use a real `ProjectSkeleton` graph with
`BoxEditing` and synthetic engine/timeline observables: unknown latency values
(undefined, NaN, Infinity, negative), a reported-latency control, the helper's
valid values, a retrigger/overlap sequence and a single-press control. The
regression tests fail against the previous production files and pass with the fix.
