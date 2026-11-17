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

## B02: lossless notes and navigation

Preview saves leave the Markdown model untouched. Editable contents are committed
before mode exit, blur or panel teardown replaces the DOM. The editable attribute
identifies the DOM's current ownership even while the mode observable is changing.
Repeated preview saves and reopened heading/link/code notes have exact-source
regressions in `NotePadPanel.test.tsx`.

The existing router owns plain paths only. Query and fragment links use native
navigation, including fragment scrolling, so complete destinations survive.
Modified/non-primary clicks, explicit targets and downloads retain browser
behavior. `MarkdownNavigation.test.ts` covers routing and native admission.
`tests/browser/r120.spec.ts` adds real notes, shortcut and fragment fixtures;
Chromium launch is blocked here by macOS Mach port sandbox refusal.

## B03: auto-gain probes

A probe belongs to one pointer. Cancellation, premature capture loss and teardown
retire subscriptions and timers without editing; unrelated pointers are ignored.
Capture loss following a normal release leaves its one-second minimum measurement
completion intact. Cleanup is idempotent and a new gesture can start immediately.

Only two finite nonnegative channel peaks contribute evidence. Invalid frames are
ignored; silence/no usable evidence and any nonfinite computed gain cause no edit.
Valid stereo evidence retains the existing target and gain limits.
`AutoGainButton.test.tsx` covers these paths with fake meters/timers; separate
cancellation and finite-evidence regressions fail before their respective fixes.
The browser fixture also drives real mouse capture/release and cancellation.

## B04: deliberate microphone capture

Permissions introspection is advisory: missing, throwing or rejected queries let
`getUserMedia` request permission. Explicit denial shows help and fails without
capture; capture refusal resets the shared permission attempt for retry. Temporary
permission streams stop their tracks. Explicit device IDs use an exact constraint,
and missing-device errors propagate; an omitted selector keeps the default.
`AudioDevices.test.ts` uses fake permissions and streams, including a fake browser
that falls back for ideal selectors. Both regressions fail before their fixes.
The browser fixture exercises the same real acquisition entry points with stubs.
