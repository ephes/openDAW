# Collection and lifecycle repairs (round 94)

Implementation assisted by Codex, starting from main at
`9adfc7df36ef85fbb8137576aac5d33e3b62b4d3`. All twelve scout findings still apply.
Work proceeds O1 through O6 on one parked branch for external review and merge.
No in-sandbox Claude review is run, following the owner's current workflow.

## O1: bulk sorted sets

Stage extracted keys and values, use stable comparator sorting, keep the first of
each equal run, and publish only after all user code succeeds. The existing value
wins over incoming duplicates. This matches repeated default `add` calls.
The three new tests failed on the original source (comparator identity, iterator
rollback, extractor/comparator rollback); all ten sorted-set tests pass after repair.
Fault injection visits every comparison/extraction in a successful admission and
each iterator step including completion. Fixtures use synthetic UUIDs/numbers.

## O2: factory and clone ownership

Recompute insertion positions after factory code and keep a reentrantly installed
entry. The collection has no disposal policy for unused results; the factory
retains resource ownership until it compares its result to the returned entry.
Clone bucket arrays independently while retaining the optional comparator.
All three regressions failed before repair; all 82 sorted-set/multimap tests pass
after repair, including sorted equal-value stability and mutation in both clones.

## O3: large multimap operations

Stage bulk buckets using iteration and publish only after sorting succeeds.
Reorder complete map entries without replaying value admission. Stable insertion
uses an upper-bound binary search instead of scanning equal runs. Four new tests
failed before repair (200k admission, iterator-created empty bucket, comparator
rollback, 65,536-equal-key comparison count). All 85 multimap/binary-search tests
pass after repair. The O2 clone test also exercises stable equal-value insertion.

## O4: observable reentrancy

Register default/optional/mapped catchup observers before calling them and release
on failure. Clearing an option commits and notifies empty before disposing its
detached resource; a nested replacement survives. Disposal also runs when an
observer throws, retaining the primary notification error. Five of seven new
observable tests failed on the previous source; all seven pass after repair.
Tests cover reentrant updates, failed initial delivery and disposal/observer errors.

## O5: subscription acquisition and retirement

Acquire multi-source subscriptions incrementally and unwind in reverse order,
continuing past cleanup failures while retaining the acquisition error. Mapped
observable termination clears downstream listeners before releasing upstream,
and makes new subscriptions inert. Three regression cases failed before repair;
all eleven notifier/observable tests pass afterward. Synthetic sources fail at
the second and third acquisition, with every earlier cleanup also throwing.
The mapped test inspects its notifier via a subscription spy, using public
`isEmpty`, and verifies no retained listeners or post-termination catchup delivery.

## O6: RPC request lifecycle

Reserve request IDs before sending and remove the exact pending entry on failure.
Ignore retired/unknown replies and callbacks. Sender creation accepts an optional
existing lifetime owner without changing the protocol object or colliding with a
remote `terminate` method. Termination rejects/clears pending work, releases the
receive subscription, and refuses new dispatches. Engine worklet and offline
renderer pass their current terminators. Failed binding also releases the sender.

The three primary regressions failed before repair: transport failure followed
by stale first-ID traffic, synchronous reentrant send, and owner termination of
two stalled requests. They pass after repair using real paired `Messenger`
wrappers over deterministic structured-cloning port stubs, plus a real executor
for the stalled request test. A fourth test covers failed binding and failing
unsubscribe while preserving the binding error. No network or worker service is
needed; the existing BroadcastChannel protocol suite also passes.

## Local validation and handoff

- `npm ci --ignore-scripts`: passed (Node 26.13.1, npm 11.20.0).
- `npm run build`: passed, 24 tasks, including production TypeScript checks and studio/worker bundles.
- `npm run lint`: passed, 24 tasks; existing warnings remain, no errors.
- `npm test`: passed, 2,456 tests in 231 files, 44 tasks (including dependency builds).
- `npx tsc --noEmit -p packages/lib/std/tsconfig.test.json`: passed.
- `npx tsc --noEmit -p packages/lib/runtime/tsconfig.test.json`: passed.
- Focused final collection/observable/notifier tests: 108 passed; paired RPC and BroadcastChannel tests: 10 passed.
- `git diff --check`: passed.

The extra test typecheck found a spy-context type and an overly narrow throwing
mock return type; both were corrected. Lint found a block-scoped generator
declaration, changed to a function expression; the 108 focused tests passed again.
No gate was blocked by the sandbox. Logs are outside the checkout under
`~/workspaces/ws-work-planning/coordination/codex/logs/cx-r94-opendaw/`.
No owner decisions or skipped slices remain. No versions, workflows, releases or
deployments changed. Park `codex-q/r94-openDAW` after the push-remote guard and
verify its SHA with `git ls-remote`; external review and merge remain pending.
