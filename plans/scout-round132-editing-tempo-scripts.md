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

B01 validation: `npm ci --ignore-scripts`, `npm run build`, `npm run lint`
(existing warnings only) and `npm test` passed with Node 26.13.1/npm 11.20.0.
`npm run test:browser` was attempted but Chromium cannot launch in the macOS
sandbox: `bootstrap_check_in … MachPortRendezvousServer: Permission denied
(1100)`. The clerk must rerun that gate outside the sandbox. Receipts are in the
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

B02 validation: targeted adapter (11), renderer (5) and value-editor (19) tests
passed; `npm run build`, `npm run lint` and `npm test` passed. The browser gate
remains pending outside the sandbox for the Chromium launch refusal documented
above; the changed R114 fixture supplies the inverse axis used by real gestures.

## B03 — script lifetime and failures

The device editor owns settlement for initialization and reloads; explicit compile
still rejects to its caller. A local request ticket and lifetime flag fence UI
publication. A pending installation owner is shared by device object, registry
and audio context; passive loads/default initialization join it, while explicit
compiles and genuine code changes preserve the existing request fences. Owners
are released after settlement rather than cached for the lifetime of a context.

The mounted real editor uses deterministic compiler/addModule and surrounding UI
doubles. Original initialization paths fail the visible-error assertions and
produce unhandled rejections. The real-compiler remount regression also fails
without the coalescing fix: old `gain 0.5` remains saved instead of `gain 0.25`.
Compiler regressions cover single publication, empty-device remount, external
changes, newer explicit compilation, deletion, shared failure and retry. Existing
reverse-installation, rollback, edit/undo and history-append tests remain in place.

## Final local gates and handoff

Fresh SSH origin: `git@github.com:ephes/openDAW.git`. Base: default `main`
(`3155b6f0`); all seven scout mechanisms remained applicable. No repository-local
AGENTS.md was present. All changes stay on local `codex-q/r132-openDAW`.

Final gates use Node 26.13.1 (declared >=23) and declared npm 11.4.2 from the
workspace-local npm cache, selected via PATH. No dependency/version change:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Passed |
| `npm run build` | Passed, all 24 tasks |
| `npm run lint` | Passed, existing warnings only |
| `npm test` | Passed, all 44 tasks; includes 28 compiler tests and 8 mounted editor tests |
| `npx eslint src/ui/devices/ScriptDeviceEditor.tsx src/ui/devices/ScriptDeviceEditor.test.tsx` (app/studio) | Passed, JSX-factory import warnings only |
| `npm run test:browser` | Blocked again on final code: Chromium launch fails with `bootstrap_check_in … MachPortRendezvousServer: Permission denied (1100)` before scenarios execute |

The clerk must run `npm run test:browser` outside the macOS sandbox, then perform
the external review and integration. No push, merge, tag or publication was run.
No owner decisions or skipped slices. Logs and red/green receipts are outside the
clone at `/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r132-opendaw/`.
