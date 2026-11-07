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

The existing note-track encoder appends exactly one zero-delta end-of-track event
after the last encoded event, including for empty tracks. Files containing multiple
tracks use format 1. This does not extend the encoder's existing channel/event support.

Run synthetic byte-fixture and round-trip regressions with `npm test -w @opendaw/lib-midi`.
