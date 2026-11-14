# Scout round 91: format boundaries

Codex implemented the scout bundles sequentially from main 2984ab74, using
synthetic inputs only. No external reviewer was invoked in the sandbox; the
parked branch requires the clerk's cross-family review before merge.

For each bundle, new regressions were run against the preceding implementation
before applying the fixes. Export tests use explicit byte oracles as well as the
real encoder/decoder; import tests use hand-authored SMF chunks. Picker tests
exercise the real fallback through a synthetic DOM event target. WAV tests check
admission before output allocation and exact stereo prefix samples/headers.
Validation results and commands are recorded in the worker closeout.
