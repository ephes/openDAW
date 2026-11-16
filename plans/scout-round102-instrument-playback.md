# Round 102 instrument playback

Fresh main: ba308fc83d302a32424f651a9381acbdfed2446a. All twelve scout
scopes still apply. Work is parked on codex-q/r102-openDAW for external review;
no merge, deployment, release or remote workflow acceptance is part of this pass.

Implementation uses real processor/voice Vitest tests with invented PCM, adapters
and local broadcasters. Codex authored the changes and exercised regressions
before each fix. No Claude command or subscription-backed reviewer was invoked,
as required by the worker brief. Public playback policies live in the core
processor README and pending notes in its CHANGELOG.

## Regression evidence

- B01: both tests failed before the fixes (disabled held note sounded after enable;
  warm limiter differed from a fresh quiet render), then passed.
- B02: empty-geometry tests and both fractional modulo-oracle directions failed
  before the fixes. Adjacent-representable/high-rate loops also run after replacing
  repeated subtraction, so a synchronous old loop cannot hang the test worker.
- B03: the forward/reverse endpoint oracle and 100-start live-voice ceiling failed
  before the fix. Old-event stops, surviving-event stops and mono/choke dispatch
  are covered using real SampleProcessor and SampleVoice instances.
- B04: both collection-order isolation cases and both pitch/stretch disabled-tail
  cases failed before fixing the visitor and adding hard sequencer retirement.
- B05: both active/internal-fade generation replacements and all four fractional
  pitch/stretch gain/partition cases failed first. Tests check every frame against
  an independent envelope/grid oracle and compare whole versus split pitch blocks.
- B06: mode 3 failed the held/release/partition test before retaining its mode;
  modes 0 and 1 already passed. Seventeen geometry/rate/overshoot cases failed
  before validating loop admission, guarding reads and using modulo wrapping.
- Final boundary audit: a subframe stretch region still retired an overlapping
  pitch voice before returning for its empty span. A real-processor regression
  failed first; retirement now happens only after admitting a nonempty span.

## Local validation

Node 26.13.1 / npm 11.20.0; locked `npm ci --ignore-scripts`. Run root
`npm run build` before `npm run lint` and `npm test`, matching Checks. The build
includes production TypeScript and generated sources; the core-processor package
also runs `npm run typecheck`. No browser or hardware gate is required for these
processor-only changes. Test and review logs belong to the worker's external log
directory; no scratch output is committed. User manuals document the changed
restart, geometry, voice-stealing, generation and loop-mode policies.

Final local result: locked install passed; root build 24/24 tasks, root lint
(including browser-fixture lint) and root tests 44/44 tasks passed. The processor
suite passes 270 tests in 50 files, including 46 newly added cases. Focused
processor TypeScript also passed. No local gate was blocked. Expected fixture
error diagnostics and existing lint warnings do not fail the gates. External
cross-family review remains pending; no review verdict is claimed.
