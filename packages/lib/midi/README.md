_This package is part of the openDAW SDK_

# @opendaw/lib-midi

MIDI library
## Standard MIDI files

`MidiFile.decoder(buffer).decode()` validates the header, declared track count and
track chunk spans before returning a model. Bounded extended header bytes and unknown
chunks are skipped; only MTrk chunks count toward the declared number of tracks. Formats 0–2 with positive PPQN timing
are supported (format 0 requires one track); SMPTE timing is refused. Every track
must contain an end-of-track event inside its declared chunk. Truncated events,
invalid fixed-size meta lengths and payloads crossing a chunk boundary throw an
import error rather than reading the following track.

Delta times and payload lengths use at most four VLQ bytes (0 through 0x0fffffff).
F0 and F7 events each consume their own length-prefixed payload, including empty
and escaped messages, and their delta contributes once to absolute event ticks.
Other system statuses are refused; FF introduces a meta event.

Export merges channels and musical metadata into one absolute-tick timeline. At a
shared tick, metadata comes first, followed by numeric channel order; original
order within a channel or metadata list is stable. All seven channel message
kinds use explicit statuses and their correct data lengths, including note-off
release velocity and zero-velocity note-on. Tempo and time signature changes
are re-encoded (signature metronome fields use canonical 24/8); other metadata
and SysEx payloads are intentionally not retained. Exactly one final end-of-track
preserves the latest retained event or terminal tick. Multiple tracks use format 1.

Run synthetic byte-fixture and round-trip regressions with `npm test -w @opendaw/lib-midi`.

Export admits 1–65535 tracks before calling any track encoder. Channel and
metadata lists must have nonnegative, safe-integer, nondecreasing absolute ticks;
interleaved channels are merged before delta calculation. Each resulting delta
must fit 0–0x0fffffff. Tick/delta validation completes before track output
allocation; arithmetic VLQ encoding never uses signed shifts. Invalid channels,
message kinds or seven-bit data are refused instead of producing partial bytes.
