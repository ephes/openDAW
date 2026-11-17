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
