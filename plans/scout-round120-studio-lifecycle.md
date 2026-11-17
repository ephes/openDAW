# Round 120 studio and stream contracts

Fresh SSH checkout: main at 4e37ee8c070bc12d16d8bf59ad240b370c66112c.
Implementation uses Codex with source inspection and synthetic regressions; no
external inference, microphone, account data or agent reviewer is required.
Cross-family review and integration belong to the external merge clerk.

## B01: startup ownership

`ensureInference` caches the import plus installation promise before yielding.
Overlapping callers receive the same host; a failed generation clears itself so
retry remains possible. `InferenceLoader.test.ts` covers overlap and retry.

`installLatencyReporter` returns an idempotent Terminable, deduplicates per audio
context, and removes its timer and state listener on close or explicit disposal.
Boot registers the handle with the studio surface after successful setup.
`LatencyReporter.test.ts` uses fake contexts and timers for close/replacement and
owner teardown. The regressions fail on the original implementation and pass
with the fixes. Full local gate results are recorded below after all bundles.
