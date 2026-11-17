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
