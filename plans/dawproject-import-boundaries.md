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

B06 independently resolves inherited units at the
arrangement admission boundary: beat timelines and seconds in warp source/media
coordinates only. Seconds/mixed timelines fail before box creation. Export source
unit labels now match the emitted seconds. Decode/encode no longer log document
bodies; import warnings omit content. Synthetic console spies verify private
metadata and track/clip names still round-trip without entering console output.

B06 repair adds a loaded synthetic WAV ZIP encode/decode/import round-trip that
asserts the exported source-unit label, both structural-warning privacy paths,
and separate beat-loop/source-second geometry assertions. Reverting the source
label and warning payload fixes makes the corresponding new regressions fail.

## Audio bundle

B05 maps audio playStart to beat playback offsets, keeps warp scale independent of
loop extent, and admits full-source linear mappings only. Synthetic numbered-ramp
WAV data verifies the first source sample, extent and pitch-mode marker geometry.
Nonlinear mappings and unsupported window combinations fail before graph/resource work.

B05 review identified the exporter's visible-duration warp span. Export now serializes
existing warp markers and play offsets, labels source coordinates as seconds and
refuses unloaded audio. Synthetic XML export/import tests protect trimmed and looped
regions. Legacy exports with mislabeled beat source coordinates are explicitly refused.

B05 second repair handles the optional no-stretch play mode. Constant-tempo
absolute extents convert with PPQN's public seconds conversion; tempo-automated
or waveform-offset export is explicitly refused for both no-stretch time bases
and for absolute audio. An ordinary no-stretch
XML round-trip protects the empty pointer path. The old unloaded sample smoke
now expects explicit refusal; loaded synthetic cases cover successful export.

On resumption, current main already covered source-unit labeling and privacy; those
fixes were retained. Audio regressions failed against main's importer/exporter.
The Musical no-stretch guard regressions also failed against the rebased branch
before the repair. The guard now includes no-stretch audio in either time base.
The sub-pulse audio privacy regression now expects admission refusal rather than
the old skip warning. Main's loaded synthetic WAV ZIP round-trip retains successful
full encode/decode/import coverage. Codex implements this repair; a fresh Claude
Opus 5.5 high-effort bundle review and local build/lint/tests gate the merge.

The resumed bundle review confirmed the original guard repair and identified
stretched-region waveform offsets as another silent loss. Both pitch/time stretch
regressions failed before the repair. Export now refuses nonzero waveform offsets
for every audio region instead of silently discarding them. Zero-offset stretch
exports remain supported. The repair delta receives a fresh review.

The resumed review converged CLEAN in round 2 (Opus 5.5, high effort), with no
omissions, redactions or remaining findings. Local build, lint, full tests and core
test typechecking passed after repair. No subagents were used.
