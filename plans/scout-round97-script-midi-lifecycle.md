# Round 97: hardware MIDI and script-device lifecycle

Fresh SSH checkout of `ephes/openDAW`, `main` at `4781c5a0`, compared with the
round 97 scout scopes. All twelve slices still applied. No owner decision was
needed. Work is parked on `codex-q/r97-openDAW` for external review and merge.
No versions, workflows, releases or deployment configuration changed.

## Implementation

- B01 (01, 02): MIDI Output retains lifecycle IDs and snapshots the endpoint,
  channel and delay that received each start. Reset, disable, source detachment,
  route edits and teardown retire owned notes once. Later old-route stops do not
  release new-route notes of the same pitch.
- B02 (03, 10): CC and note timestamps add the endpoint delay to block-relative
  milliseconds. Spielwerk's EventProcessor lifecycle copies the actual engine
  tempo and sample bounds before the downstream instrument pulls notes; musical
  windows never reconstruct sample coordinates.
- B03 (04, 05): both script devices catch parameter faults, discard the failed
  processor and report once. The generation number is consumed before
  construction, while a missing/mismatched registry entry remains pollable.
  Only a new compile recovers a failed generation.
- B04 (06, 12): notes require finite coordinates, a representably later finite
  end, integral MIDI pitch, finite velocity and cents. Omitted cents remain zero.
  Werkstatt checks both owned channel identities and lengths. Owned staging
  keeps detached script buffers away from published audio, admits only validated
  samples, and allocates replacement buffers on compile rather than per sample.
- B05 (07, 08): scheduled notes retain source identity. Source stops cancel
  queued descendants and retire sounding ones; same-window descendants before
  the stop retain their valid portion. Discontinuity/stop cleanup is independent
  of retained-note count and guards the user reset hook.
- B06 (09, 11): retained notes carry their source ID so natural completion removes
  reverse mappings immediately. Faults drain matching stops in the failing pull,
  or the next downstream pull for parameter faults. Construction of replacement
  code waits until that drain. Stops in a window precede any later natural end.

README, all three device manuals and core-processors Unreleased notes describe
these contracts. Codex implemented the changes directly with synthetic fixtures,
then inspected the final source and ran local validation. No review agent or
Claude CLI was invoked, as required by the current worker brief.

## Regression evidence

Every bundle's added boundary regressions were run against its preceding source
before the fix and failed, then passed with the fix. Logs live outside the clone
under `~/workspaces/ws-work-planning/coordination/codex/logs/cx-r97-opendaw/`.

| Bundle | Before-fix failures | Coverage |
| --- | --- | --- |
| B01 | 7 | Reset/disable/termination; endpoint/channel/disconnect ownership |
| B02 | 4 | Zero/positive/negative CC delay; actual EventProcessor → MIDI Output chain with changing tempo/partial blocks |
| B03 | 4 | Parameter failures, sibling continuation, 1,000-block constructor bound, late registry and recovery, both devices |
| B04 | 13 | Finite/representable note domain; empty/short/foreign/replaced/detached audio output, normal partial spans and recovery |
| B05 | 4, plus same-window ordering | Source cancellation, anonymous independence, due ownership, pending-only seek/stop, reset faults |
| B06 | 5, plus source-stop/expiry ordering | 2,000 short descendants with empty expired index; throw/flood/invalid-output stop balance; parameter-fault drain before replacement |

Fixtures use real BoxGraph, adapters, processors and EventProcessor/AudioProcessor
chains. Only worklet services and MIDI sinks are synthetic. No physical hardware,
accounts or personal data are used. Tests live in the processor package; the
browser fixture has a narrow import-rule exception because these private
processors intentionally have no public runtime exports.

## Local gates

Toolchain: Node 26.13.1 (README requires >=23), declared npm 11.4.2 via
`npm exec --yes --package=npm@11.4.2 -- npm ...` and the committed lockfile.
Required commands: `npm ci --ignore-scripts`, `npm run build`, `npm run lint`,
`npm test`. Lint includes existing repository warnings; production and test
TypeScript are checked by the build. All four required gates passed on the final
implementation; browser execution is the exception described below.

The browser suite includes the existing pointer/clipboard/HTML tests and a new
AudioWorklet scenario running actual script and MIDI processors with fake MIDI.
Chromium installation succeeded in the workspace cache. Execution is blocked
before any test body: macOS rejects Chromium's MachPortRendezvous registration
with `Permission denied (1100)`. Exact command:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r97-opendaw/.cache/playwright npm run test:browser
```

The worklet entry bundles successfully and its scenario passes in an isolated
JavaScript scope with worklet stubs. This is a fixture sanity check, not a browser
result. The real browser gate remains required outside this sandbox. No GitHub
Actions run was requested or used. Cross-family review and merge remain with the
external Claude clerk.
