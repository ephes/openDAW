# Round 109 audio and script contracts

Implementation uses source inspection and synthetic Vitest/Chromium regressions.
Changes are grouped by the six ordered bundles; no external reviewer ran here.
Regression failures and full local gate output are retained in the worker log directory.

## B05 — output routing

Selecting Default passes the empty sink ID to AudioContext.setSinkId. Refusals
propagate to the existing selector error path. Enumeration publishes only for the
latest sinkchange and a still-matching context sink.

## B06 — graph lifetime and scaling

Graph tests reproduce source-first teardown, duplicate releases and the old
transitive-closure work count. Iterative SCC discovery and ordering handle a
20,000-vertex reverse chain without recursive stack growth. Engine registration
leases already release once; incident-edge cleanup makes their release order safe.

## B07 — shared note and recording state

Signed-word presence tests preserve the four-word MIDI wire format. The recording
ring reserves one slot and stores sticky loss evidence in a third header word.
Both polling and finalization inspect it, preventing a save before a delayed
poll observes overflow. Faults terminate capture resources and require a fresh
ring. Unit tests cover wrapping and owner refusal; the Chromium fixture exchanges
real SAB blocks with a worker and checks overflow before reader startup.

## B08 — parameter lifetime

Real field removal/readd tests check registry and notification cleanup. Compiler
regressions use a real project skeleton, BoxEditing, automation track and MIDI
controller to check stable addresses/values, reset metadata and undo/redo. Numeric
domain changes retain the prior explicit recreate policy. Saved source replaces
the mutable declaration cache as the authoritative previous domain.

## B09 — declaration admission

Parser and real compiler tests reject invalid numeric domains and duplicate
resources before installation or graph publication. Valid scientific notation,
integer rounding and unique declaration reordering remain supported. Older test
fixtures using zero exponential endpoints now use positive minima.

## B10 — script installation publication

A context/device request serial fences compilation and load independently of the
saved update number. Preparation evaluates the user module into a private
candidate. Activation has a worklet-side request fence; graph publication checks
client ownership, source-change history and live box identity after each await.
Even invalid newer requests retire older installs. Rollback skips retired ancestors
so a failed overlapping publication cannot resurrect a discarded activation.
Retirement frees the candidate and conditionally restores its own activation if
publication did not occur. Failed graph transactions cannot restore over a newer
registry entry. Successful publication logs cleanup refusal without reporting the
saved compile as failed.

Compiler tests evaluate actual generated Blob payloads, including reverse order,
evaluation rejection, superseded activation, external edits, rejected installation,
failed graph publication and intentional loading of older source. Integration
tests run exact-update lookup through real Werkstatt/Spielwerk processors. The
Chromium fixtures repeat reverse completion and undo in a real AudioWorklet.

## Local verification

All twelve scout slices still applied at fresh main bceae5b. No owner decision was
needed and no package version changed. Each slice's new regression failed against
its pre-fix implementation; production build, lint and aggregate unit tests are
the final local gates. Chromium execution is blocked by this macOS sandbox's Mach
port bootstrap permission; the merge clerk must run `npm run test:browser`, including
`tests/browser/r109.spec.ts`, outside it. Logs are retained under
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r109-opendaw/`.

Final gate results: `npm ci`, `npm run build`, `npm run lint` and `npm test`
passed (24 build/lint tasks and 44 aggregate test/dependency tasks). The targeted
compiler suite has 19 tests; exact Werkstatt/Spielwerk processor integration has
two tests. The three new browser modules also bundle successfully with esbuild.
`npm run test:browser -- tests/browser/r109.spec.ts tests/browser/scripts.spec.ts`
was attempted: all four cases are blocked before execution by Chromium's
`bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`.
No browser pass is claimed. No pushes, merges, tags or external review commands ran.
