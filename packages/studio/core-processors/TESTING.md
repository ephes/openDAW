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
