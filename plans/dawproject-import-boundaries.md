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
or waveform-offset absolute export is explicitly refused. An ordinary no-stretch
XML round-trip protects the empty pointer path. The old unloaded sample smoke
now expects explicit refusal; loaded synthetic cases cover successful export.
