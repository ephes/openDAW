# Processor tests

Build from the repository root before running `npm test --workspace=@opendaw/studio-core-processors`.
Tests use synthetic audio/events, recording host boundaries, and real processor/DSP exports.
Set worklet globals before dynamic imports when a module initializes from `sampleRate`.
No audio device, browser, platform font, network service or clock is required.

Live MIDI note-off only affects matching pitches, including notes queued before the first render block.
Clip queries own half-open ranges and visit every intersected cycle. With region-end truncation enabled,
each repeated subnote is capped at the same boundary as an ordinary note; disabling it preserves tails.
Pending MIDI transport messages are delivered in order to every enabled nonempty destination, with
its configured delay, then discarded (also when no destination exists).

Lifecycle sorting returns equality for simultaneous peers, with completions before starts.
MIDI ring tests decode real shared memory, observing registration before publication, two-word
messages, wrap/full behavior and the 64-device limit. Explicit position assignment raises one
consumable leap; ordinary advance does not. Pause preserves position/metronome preference and
clears transport, recording and count-in.

Voice fixtures record identities, starts, glides and releases and add deterministic audio.
Strategies clear only their requested output span; Voicing renders tails into a reusable buffer
before summing them into the current strategy output. Retirement waits for the last sounding voice.
Unison preserves parent gain in the sum of squared child gains and centers spreads on the parent.
The initial placeholder strategy has no tail and is never rendered after strategy selection.

Compressor reset preserves parameters and clears all stream histories; warm/reset processing must
match a fresh instance for silence and new stereo signals, with lookahead and automatic modes.

Peak broadcaster clear resets all four immediately published values. Meter processing takes raw
amplitudes into the RMS window, retains squared RMS energy, and takes its square root on publication.
The retained energy decays exponentially; its amplitude RMS therefore decays with the square root
of that multiplier. Monitoring and output-buffer teardown owns a specific registration, including
repeated registrations of the same source. Output registry duplicates retain the first entry and
return an inert terminable; repeated/stale disposal cannot remove a newer entry.

Renderer callbacks own `[p0,p1)`, including its start. Each callback position is handled once per
forward traversal to guarantee forward progress. Dispatch snapshots peers and honors cancellation;
callbacks added at a future position can run in the current render, while additions at an already
handled position wait for a later visit. Loop/marker rewinds permit dispatch on the next traversal. Renderer teardown owns BPM, marker and tempo subscriptions.
Parameter disposal terminates active automation broadcasting as well as its adapter listener;
ordinary stop-automation still restores and notifies the manual value.

Frozen playback maps musical seeks with the tempo map and the source sample rate, then advances
one source frame per output sample (no implicit resampling). PCM bounds and paused blocks are silence.
Metronome downbeats use the full numerator times subdivision count per measure; one-frame synthetic
clicks identify accents independently of waveform generation. Event dispatch tests specify update/note
order, one-shot flags and exact chunk coverage. Mixer fixtures use UUID containers and existing
bus/AuxSend visitors to check audible membership through shared branches and cycles.

FreeVerb tests use stereo impulses through real comb, all-pass and predelay ring wraps, compare
clear/reuse with a fresh instance, and compare chronological whole and uneven subrange processing.
Unity dry gain with zero wet gain preserves PCM exactly.
