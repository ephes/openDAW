# Effect lifecycle and deterministic restart (round 96)

## Scope and process

Twelve scout slices in six ordered bundles cover NAM loading/activation and owned
cleanup, effect input leases and silence, delay timing/restart, vocoder sample
cadence/restart, and gate sidechain/stereo-tool restart. Codex implements each
bundle with synthetic public-entry-point regression tests, first run against the
unfixed implementation. No native model, external service or personal data is
used. Production build, lint and the full test suite are the local release gates.
The combined branch is parked for an external cross-family review; no merge,
Claude command, release or deployment is part of this work.

## B01 — NAM loading and activation

Concurrent NAM module reads share one attempt. A rejected transport or module
initialization is forgotten so a later explicit request can retry; successful
modules remain shared. Switching a loaded mono device to stereo admits the right
instance only after its model load succeeds. A false return or exception leaves
usable mono processing in place and retires the failed candidate. Changing the
mono control again retries. An unloaded device remains in dry bypass until a
complete model load succeeds.

Regression: shared rejected attempt then concurrent successful retry; false and
throwing right-channel loads, mono output, candidate retirement and stereo retry.
All three tests failed before the B01 fix and pass afterward.
