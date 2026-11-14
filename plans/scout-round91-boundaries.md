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

## Regression evidence

Before fixes: B01 had five failing export cases; B02 had nine failing admission
cases; B03 had 45 failing import cases; B04 had one failing picker case and 30
failing WAV cases. Final focused suites contain 119 MIDI, 8 DOM and 320 DSP tests.
The studio smoke uses actual NoteMidiExport/MidiImport code and a real BoxGraph,
with synthetic file access, dialog/progress sinks and a browser worklet class
stub for loading the public package entry point. It covers a successful round
trip and malformed data rejected before graph modification; it is a jsdom smoke,
not native browser picker or audio-device validation.

All twelve slices still applied at the pinned main commit. The WAV encoder in
that fresh checkout lacked the scout's assumed RIFF/maxLength preflight. The
shared WAV source check therefore also validates those arithmetic boundaries;
this is not claimed as prior-round prerequisite work.

## Local validation

Node v26.13.1 / npm 11.20.0. Required commands: `npm ci --ignore-scripts`,
`npm run build`, `npm test`, `npm run lint`. Additional focused suites:
`npm test -w @opendaw/lib-dom -w @opendaw/lib-dsp -w @opendaw/lib-midi` and
`npm test -w @opendaw/app-studio -- --run src/ui/timeline/MidiImport.test.ts`.
Test types: `npm exec -w @opendaw/lib-midi -- tsc -p tsconfig.test.json`,
the same command for lib-dom and lib-dsp, and
`npm exec -w @opendaw/app-studio -- tsc`.

Existing lint warnings and npm audit findings remain outside these slices. No
workflow, version, release, deployment or host change is included. The branch is
parked for review; no Claude CLI, Actions query or work-app write was performed.

Final outcome: frozen install, all 24 build tasks, all 44 aggregate test/build
tasks and all 24 lint tasks passed locally. All targeted suites and test-type
commands passed. No required local gate was blocked by the sandbox. No slice
was skipped and no owner decision is pending.
