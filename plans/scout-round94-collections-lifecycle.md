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
