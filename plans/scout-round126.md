# Round 126: editing and ownership boundaries

Fresh SSH clone of ephes/openDAW, based on main at
`f95f74f9a9ddb1fe850476f0ed106ced025ff151`.
Origin was verified as `git@github.com:ephes/openDAW.git`. All twelve findings
remain applicable on this newer base; S04 is deferred for the owner decision below. Changes are authored in small
local commits; no push, merge or remote review is performed. Regression fixtures
exercise production adapters and graph operations with synthetic data. Tests are
run before and after each repair; full local validation follows all bundles.

## B01

Flatten uses exactly the supplied source list for both copying and deletion and
reduces all complete endpoints for the replacement span. Note copy retains the
ratchet curve. TimelineEdits.test.ts covers source isolation, nested/equal-start/
disjoint/reordered spans, graph replay/inversion and serialized ratchet copies.

Deferred owner decision: `note-flatten-preserves-loop-truncation-playback`.
NoteSequencer computes curved repeat attacks with fractional pulse positions and
clips individual repeats against source loop/region ends. NoteEventBox stores
position/duration as Int32. Shortening a repeated source note changes its attack
spacing; expanding it to persistent single notes rounds attacks and also changes
per-source chance behavior. The current flatten API has no playback-preference
argument. Exact preservation needs a decision on persistent boundary metadata
(or acceptance of quantization/chance changes) and preference plumbing. No partial
clipping repair is included; this slice remains applicable and unfixed.

## B02

Content start translation uses the existing note/value consolidation and play-mode
clone APIs before changing coordinates. The audio path resolves the new adapter
directly because pointer subscription publication waits for transaction end.
TimelineEdits covers single/two-owner trims with a shared clip, graph replay/undo,
serialized content and shared audio warp markers. Preroll tests cover muted-first,
all-muted and enabled holding values. All six new cases failed on the prior code.

## B03

The adapter owns its pointer listeners and current loader subscription. Each
transition retires the old subscription and advances a generation; disposal
retires the whole owner and fences saved callbacks. Synthetic loader tests cover
pending A to cached B, empty and pending B, old loaded/error/idle callbacks, preset
selection and repeated disposal with real pointer listener cleanup. Four tests
failed before the repair. A fifth regression caught an already queued pointer
callback after retirement; the file/preset handlers now also fence that callback. No font downloads or shared-loader disposal is used.

## B04

MIDI registrations count independent idempotent owners and publish aggregate state
before notifying listeners. JSX accepts an explicit connection lifetime; all four
current call sites use their existing view owner. Unit tests with fake frames
verify cancellation, queued callback fencing and first-connection-only dispatch.
The new independent-owner and frame tests failed before the fix.

The r126 browser fixtures construct real NoteEditor/ValueEditor views on synthetic
projects. Their integration run is not qualified locally: Chromium exits before
page creation because macOS sandbox denies MachPortRendezvousServer bootstrap.
Exact attempted command (from repo root):
`PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r126-opendaw/.cache/playwright npm run test:browser -- tests/browser/r126.spec.ts`.
The clerk must run the full `npm run test:browser` outside the sandbox.

## B05

Pointer object assignment validates graph identity and exact current target
identity, with a narrow allowance for the box whose constructor is running
and whose UUID is not already staged.
Transfer APIs continue to remap explicit addresses. Pointer tests cover equal and
distinct foreign UUIDs, detached/reused UUIDs, duplicate construction UUIDs
and current construction.

The recovery update decoder requires bounded input, checks known tags, path and
attachment lengths before allocations, and refuses trailing bytes. Allocation
spies reject giant synthetic declarations without actually allocating them.
Round trips exercise every update/primitive kind and replay/inversion. A real
Project/SyncLogReader test with a valid outer log and trailing nested payload
proves no replay transaction opens and no prefix edit is applied. It failed
before rebuilding the repaired decoder.

## Local validation and clerk handoff

Toolchain: Node v26.13.1 (declared minimum 23). Initial checks used installed
npm 11.20.0; final install/build/lint/test checks use the declared npm 11.4.2 via
`npx --yes npm@11.4.2`. No dependency or version changes were made. Commands ran from the clone
root; all command logs are under
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r126-opendaw/`.

Passed:

- `npx --yes npm@11.4.2 ci --ignore-scripts` (`npm-ci-declared.log`).
- `npx --yes npm@11.4.2 run build` (`build-declared.log`): all 24 Turbo tasks passed.
- `npx --yes npm@11.4.2 run lint` (`lint-declared.log`): all 24 workspace tasks and browser lint passed;
  existing warnings remain.
- `npx --yes npm@11.4.2 test` (`test-declared.log`): all 44 Turbo tasks passed, with 3410 passing tests
  in the 17 test-workspace summaries. The last production edit was included.
- `npx tsc --noEmit -p packages/lib/box/tsconfig.test.json`,
  `npx tsc --noEmit -p packages/studio/adapters/tsconfig.test.json`, and
  `npx tsc --noEmit -p packages/studio/core/tsconfig.test.json`.
- New TSX declarations and the real editor browser fixtures were checked with
  `tsc --noEmit` (temporary fixture config stored with the logs). New/changed
  TypeScript and TSX tests were explicitly linted.
- All 46 new unit/integration cases pass. The final timeline rerun also checks
  that the shared clip's original events retain their original coordinates.
- `npx vitest run src/transfer/TransferRegions.test.ts --root packages/studio/adapters`:
  all 12 supported same/cross-graph transfer cases pass.

Blocked, not passed:

- `PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r126-opendaw/.cache/playwright npm run test:browser`
  (`browser-final.log`): 36 fixtures cannot launch Chromium because macOS sandbox
  refuses `bootstrap_check_in ... MachPortRendezvousServer` with
  `Permission denied (1100)`. Chromium installation itself succeeded using the
  workspace cache. The four new real deferred note/value editor cases remain
  unqualified; the clerk must run this command outside the sandbox.

Extra diagnostic, outside the configured npm-test list:

- `npx vitest run src/transfer/TransferRegions.test.ts src/transfer/TransferAudioUnits.test.ts --root packages/studio/adapters`
  gives 22 passed and 8 failed. The same eight TransferAudioUnits failures were
  reproduced with graph.ts/pointer.ts/pointer-hub.ts from origin/main compiled
  temporarily, then the repaired sources and build were restored. Five fixtures
  lack mandatory audio-region events; three assert old ordering behavior. No
  foreign-pointer admission failure occurs. See `baseline-transfer.log` and
  `b05-transfer.log`; no unrelated transfer repair is included.

No Claude CLI, review agent, work-app mutation, `git ls-remote`, push, merge,
release or deployment was run. The branch stays local for the clerk. The only
owner question is S04: permit quantized expanded ratchets/chance changes, or
choose persistent clipping metadata and preference plumbing for exact playback?
