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

Local links route with their complete path, query and fragment, so destinations
survive without a full studio reload; a routed page opens at its top. Same-page
fragments scroll natively.
Modified/non-primary clicks, explicit targets and downloads retain browser
behavior. `MarkdownNavigation.test.ts` covers full-destination routing and native fragments.
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
permission streams stop their tracks. The app-level `AudioDevices` input-stream
helper uses an exact constraint for explicit device IDs and propagates missing-device
errors; it has no production caller yet. Track recording (`CaptureAudio` in
studio-core) keeps its deliberate default-input fallback, which is an owner decision.
`AudioDevices.test.ts` uses fake permissions and streams, including a fake browser
that falls back for ideal selectors. Both regressions fail before their fixes.
The browser fixture exercises the same real acquisition entry points with stubs.

## B05: listener ownership and delivery

Subscriptions capture their entry and a unique registration token. Repeated
termination cannot remove another duplicate, and an obsolete handle cannot touch
a replacement entry after clear/reconnect. Clear releases old listener references.
Delivery iterates a registration-order snapshot and skips any registration
removed earlier in the frame, so self-removal cannot skip unrelated listeners and a
terminated listener receives nothing more; additions wait until the next frame. Exceptions still stop dispatch under the existing documented rule.
`Subscribers.test.ts` and real `LiveStreamReceiver.test.ts` regressions fail on
the original implementation, covering all five scalar/array package types.

## B06: payload and optional reporter cleanup

Array package termination clears the per-address payload cache alongside listeners.
Real receiver tests reconnect three generations for every array type, proving
in-connection reuse and fresh payload identities after disconnect. Those three
regressions fail without cache cleanup.

Latency history is bounded to 4096 characters and 501 integer buckets in [0, 500].
Stored duplicates are collapsed before adding a new bucket. Invalid/nonpositive
measured latency is ignored. JSON, schema, storage discovery/read/write and beacon
failures retire the timer and state listener without reaching the app error path.
Reporter tests use synthetic malformed/oversized history, refusal stubs and fake
timers; valid buckets remain deduplicated across contexts. The storage regressions
fail on the earlier reporter implementation.

## Final local validation

All twelve slices remain applicable on the fresh trunk; none require an owner
decision. Six ordered bundle commits share the local `codex-q/r120-openDAW` branch.
No version bump, push, merge, release, deployment or external agent review occurs.

- `npm ci --ignore-scripts`: passed (existing dependency audit findings unchanged).
- `npm run build`: passed, including production typechecks and generated sources.
- `npm run lint`: passed (existing warnings, zero errors).
- `npm test`: passed, 44 Turbo tasks; Studio has 39 files / 308 tests.
- Explicit lint of changed TSX files and typecheck of the new browser fixtures: passed.
- `PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r120-opendaw/.cache/playwright npx playwright install chromium`: passed.
- `PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r120-opendaw/.cache/playwright npm run test:browser`: blocked at Chromium launch
  for all 30 tests: macOS `bootstrap_check_in ... Permission denied (1100)` /
  `KERN_SUCCESS` assertion in `mach_port_rendezvous_mac.cc`. No browser assertion
  ran. The clerk must run this gate outside the sandbox, including the new notes,
  navigation, pointer capture and microphone fixtures. Dynamic fixture dependencies
  are scanned before serving to avoid a cold-cache optimizer reload during tests.
- Merge-time `npm run test:browser` outside the sandbox: 29 passed. The notes fixture
  now types through the keyboard because Playwright `fill()` produces paragraph
  elements whose `innerText` doubles blank lines. `scripts.spec.ts` ('script-contracts'
  not defined) fails identically with the trunk configuration and is pre-existing.

Before/after regression outputs and full gate logs are outside the checkout at
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r120-opendaw/`.
