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
