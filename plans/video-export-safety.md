# Video export safety

Round 88 implementation uses Codex to add focused synthetic regression fixtures,
then change the existing exporter and renderer. No production audio or browser
profile is used. Lifecycle tests fake WebCodecs and mediabunny; renderer fixtures
use deterministic stereo tones and silence. Local build, lint and test gates
validate the final branch. External cross-family review is left to the clerk.

## Admission

Video dimensions must be positive even integers, at most 4096 per side and
8,294,400 pixels in total (all existing presets fit). Supported video rates are
30, 60 and 120 fps. Audio accepts 1–2 channels at integral rates from 8000 to
192000 Hz. Video bitrate is at most 32 Mbit/s, audio at most 512 kbit/s.
Duration zero selects automatic completion. Explicit duration must be finite,
positive and at most 3600 seconds; work is limited to 432,000 video frames.
Admission runs before canvases, encoders or file creation.

Each submitted frame requires finite, nonnegative, strictly increasing video
timestamps and exactly the configured audio channels. Channel planes must have
equal nonzero lengths of at most one second. Malformed geometry is rejected
before either media source receives data. Samples retain planar channel order.

## Audio clock and automatic duration

Audio timestamps use cumulative submitted samples, independently of video frame
indices. The offline renderer retains its quantum overshoot in the next frame's
sample budget; samples are neither repeated nor discarded. Native AudioData
represents the sample cursor rounded to the nearest microsecond.

Automatic duration preserves the complete arrangement, including silent gaps.
Tail silence is counted only after the final scheduled region. Empty/silent
projects finish within ten seconds after the arrangement end. All automatic
tails, including sustained effects, are capped at ten seconds. Automatic projects
whose arrangement plus tail exceeds the one-hour work limit are refused; use an
explicit shorter duration. Explicit duration ignores silence.
