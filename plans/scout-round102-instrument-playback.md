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
