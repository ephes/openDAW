# Round 136: shared primitives and timeline work

Implementation process: Codex inspected the fresh main checkout and added tests
against the real helpers and consumers before each fix. All fixtures use synthetic
values. No release, push or deployment is part of this change; a separate clerk
reviews and integrates the local branch.

## Constant curves

Equal endpoints previously produced 0/0 recurrence coefficients. The exact
identity recurrence fixes the shared primitive without changing nonconstant
interpolation. Before the fix, five Curve cases failed and two curved tempo-map
cases rejected nonfinite BPM. Afterward, all eight Curve tests and all 194 adapter
tests passed, including seeks, adjacent ramps and conversion round trips.

## Random state

The Mulberry32 regression compares every draw through 4,917,824 against a
Uint32Array-wrapped reference. Unfixed code first diverged at draw 4,917,760.
Wrapping the stored state before mixing restores the intended 32-bit sequence.
The six tests also pin the initial sample and signed/unsigned seed reset replay.

## Array replacement

Self-replacement and an ordered 200,000-element input failed before the fix
(empty result and RangeError respectively). Identity-preserving indexed copying
and an alias no-op avoid both failures. The regression suite also checks ordinary
effect reordering and clearing without a live audio graph.

## Fade painting

Five renderer regressions failed before the fix: offscreen path work, clipped
samples and hidden fades. All six tests pass after intersecting with the viewport
and evaluating the original curve at visible positions. DPR 1/2, widths through
one million pixels, fractional zoom, scaled overlapping fades, zero-height
bounds and unchanged handles are covered by the real renderer with counting
Path2D/canvas fixtures. These are operation bounds, not browser timings.

## Initial track catchup

The real TracksManager fixture counted 10,099 / 40,199 / 160,399 listIndex writes
for initial 100 / 200 / 400-unit loads before the fix. A construction guard skips
intermediate ordering and publishes one final synchronous order. The five tests
check exactly one index write per initial track, bounded comparator input reads,
multi-track units, empty collections, subsequent insert/reorder/removal and
subscription/element cleanup. Only the DOM unit view and adapter collections are
synthetic; manager, TrackContext, SortedSet and lifecycle behavior are real.

## Local validation and handoff

Passed on Node >=23 with the frozen lockfile, without version changes:

- `npm ci --ignore-scripts`
- `npm run build` (all 24 tasks)
- `npm run lint` (existing warnings, no errors)
- `npm test` (all 44 tasks successful, including build dependencies)
- `npx tsc --noEmit -p packages/lib/std/tsconfig.test.json`
- `npx tsc --noEmit -p packages/studio/adapters/tsconfig.test.json`
- `git diff --check`

Browser installation succeeded with a workspace-local cache:
`PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r136-opendaw/.cache/playwright npx playwright install chromium`.
The same cache was used for the blocked gate:
`PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r136-opendaw/.cache/playwright npm run test:browser`.
Chromium exits before executing fixtures because macOS sandbox denies
`bootstrap_check_in` for `MachPortRendezvousServer` (Permission denied, 1100).
The merge clerk must rerun the browser gate outside the sandbox.

Detailed red/green and gate logs remain outside the clone in
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r136-opendaw/`.
No owner decisions were needed and no slices were skipped.
