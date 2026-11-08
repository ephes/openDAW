# DAWproject import boundaries

Round 80 applies small admission checks and coordinate conversions to the existing
importer. Synthetic XML fixtures exercise the production importer and inspect real
boxes and playback loop phases. No external project or sample is added.

Codex implements the changes, checks regressions against the preceding implementation,
and runs build, lint and tests locally. Each ordered two-slice bundle receives a direct
Claude Opus 5.5 high-effort review before merging. No versions, releases or workflows change.

B04 refuses ambiguous nested clip multiplicity. Notes normalize declared loop windows
and split a nonrepeating lead-in when playStart precedes loopStart. Notes starting before
a source window are omitted rather than retriggered; note ends are clipped and
sub-pulse pieces are omitted. Nonlooping clips
use one clipped source window. Full nonlinear/nested coordinate composition is outside
this change.

B04 review converged with suggestions only after correcting held-note onsets and
zero-pulse pieces. Adopted final admission suggestion: refuse clips whose derived
pieces are all sub-pulse, rather than return a successful empty clip.

B06 is independent of the parked B05 branch. It resolves inherited units at the
arrangement admission boundary: beat timelines and seconds in warp source/media
coordinates only. Seconds/mixed timelines fail before box creation. Export source
unit labels now match the emitted seconds. Decode/encode no longer log document
bodies; import warnings omit content. Synthetic console spies verify private
metadata and track/clip names still round-trip without entering console output.

B06 repair adds a loaded synthetic WAV ZIP encode/decode/import round-trip that
asserts the exported source-unit label, both structural-warning privacy paths,
and separate beat-loop/source-second geometry assertions. Reverting the source
label and warning payload fixes makes the corresponding new regressions fail.

## Parked audio bundle

B05 remains on `fix/r80-import-audio-offsets` at `c5aa2d5e`; it is not merged.
Local build, lint and tests pass. The review gate stopped after round 3 with one
Warning: the no-stretch fallback must also refuse tempo automation/waveform offsets
for Musical regions, not only Seconds regions. The optional no-stretch pointer
Critical was fixed. A remaining advisory asks to restore loaded full-project export
smoke coverage. Rebase this branch onto current main and complete its review gate
before merging; B06 intentionally proceeded independently.
