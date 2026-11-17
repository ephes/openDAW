# Round 132 editing, tempo and script repairs

Implementation uses Codex with deterministic synthetic graph/history, canvas and
async doubles. No external reviewer runs inside the sandbox; the local branch is
handed to the merge clerk for cross-family review. No personal data is used.

## B01 — reliable automation editing

The collection lookup follows immediate graph updates, including pending boxes,
integer key changes, transfers, deletion and inverse updates. Sets tolerate
temporary move collisions without changing the final unique-key contract. On
rollback, the collection rebuilds its editor index from restored graph pointers.
Capture replaces a candidate only for a strictly smaller distance.

New regressions failed against the original code: six collection identity/work
tests, two real editor deletion/move rollback tests and four capture cases. The
move test injects a failure after the first point has changed, then retries and
checks undo/redo. Capture tests retain note selection priority and region offsets.

B01 validation: `npm ci --ignore-scripts`, `npm run build`, `npm run lint`\
(existing warnings only) and `npm test` passed with Node 26.13.1/npm 11.20.0.\
`npm run test:browser` was attempted but Chromium cannot launch in the macOS\
sandbox: `bootstrap_check_in … MachPortRendezvousServer: Permission denied\
(1100)`. The clerk must rerun that gate outside the sandbox. Receipts are in the\
worker's external coordination log directory.

## B02 — tempo curve fidelity

Cuts interpolate stored values and recompute both slopes in that domain. Rendering
maps sampled stored values with a visible-pixel work bound; known affine axes
retain their linear chord. Midpoint paint/capture and inverse-axis slope gestures
use stored values too. The existing browser gesture double now supplies both
axis directions.

New regressions fail with the prior implementation: linear/curved tempo cuts
change dense BPM samples and elapsed time; logarithmic full/clipped paths,
handles, capture and slope gestures disagree with the raw-value oracle. Hold
segments, identity-mapped parameters, undo/redo, affine fast-path and bounded
visible draw work remain covered. Float32 storage precision is allowed.

B02 validation: targeted adapter (11), renderer (5) and value-editor (19) tests\
passed; `npm run build`, `npm run lint` and `npm test` passed. The browser gate\
remains pending outside the sandbox for the Chromium launch refusal documented\
above; the changed R114 fixture supplies the inverse axis used by real gestures.
