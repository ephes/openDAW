# Round 111 ownership repairs

Implementation by Codex on fresh `origin/main` at
`06f2a220` (origin `git@github.com:ephes/openDAW.git`), with synthetic
production-handler regression tests. No repository AGENTS.md exists; the
worker brief supplies the applicable instructions. All twelve scopes still
reproduce; none required an owner decision or freshness skip.
No subagents or review CLI were used; external cross-family review belongs to the
merge clerk.

B01 tests exercise mixed copyable/protected device cut, instrument availability,
undo/redo and output installation failure after deletion notifications, including
preservation of a prior redo step. The regressions failed on the fresh main
snapshot before their fixes. Binary graph comparison excludes creation indexes:
restored boxes receive fresh local creation indexes, while UUIDs, fields and edges
are preserved.

B02 retains the existing naive grid-reference comparisons and adds counted exterior
tail operations and controlled invalid-input/nonprogress regression cases. The
new tests fail against the original cursor; the runaway guard in the test prevents
a broken implementation from hanging the test process.

B03 production-adapter tests cover occupied-bar refusal in both directions,
noncolliding moves across/between events, untouched bar preservation and undo/redo.
Worklet tests keep the original catchup event across a reentrant sequencing update
and check listener retirement after an initial observer failure. Both reported
regressions were reproduced before their fixes.

B04 uses a fake worklet RPC and browser event target to exercise ready/fault/retire
orders, multiple waiters, listener cleanup and retirement without a consumer.
Facade tests defer resume across Stop, release, replacement and another Play;
resume refusal is observed and a later Play succeeds.

B05 covers early and late successful preparations alongside rejection, failed
registration and capture startup, second-capture, automation and transport faults,
and throwing teardown. Resources and global state must retire once before retry.
B06 invokes real Project Stop/terminate during deferred preparation, then verifies
no late capture or transport start and a different project can record. Monitor
tests settle overlapping sink/play promises in either order, with old failure and
retirement. These regressions fail against the original implementations.

Chromium fixtures add production clipboard handlers, real Project cancellation
and real WebAudio/MediaStream routing with synthetic input and deferred media
methods. They require no microphone, account or personal data.

The shared worklet Stop/stopRecording commands cancel project preparation too,
covering the separate StudioService facade used by the toolbar/shortcuts. Its
regression failed before this final routing repair.

Validation: `npm ci --ignore-scripts`, `npm run build`, `npm run lint` and
`npm test` pass locally (Node 26.13.1 / npm 11.20.0). Lint retains existing
warnings; no errors. `npm run test:browser` is sandbox-blocked at Chromium
launch: macOS `bootstrap_check_in ... Permission denied (1100)` before any
fixture executes. The merge clerk must run that exact browser gate outside the
sandbox. Browser fixture types pass
`npx tsc --noEmit --skipLibCheck --target esnext --module esnext --moduleResolution bundler --lib esnext,dom tests/browser/r111-ownership.ts`. No version bump,
review CLI, remote branch, push or merge.
