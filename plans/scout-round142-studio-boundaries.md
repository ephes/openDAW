# Round 142: studio recovery, piano timing and note ownership

## Error diagnostics and recovery (B01)

First-party stack/source URLs keep errors fatal even with injected script tags,
extension words in the message or mixed external frames. Script counts and
source-less events alone do not establish extension provenance. Known ignored
browser/editor failures, positively identified external/extension failures and
non-empty URL-less stacks (Safari isolated-world content scripts) without
first-party evidence remain nonfatal. A fatal handler stops animation and offers recovery once.

Diagnostic extraction reads only bounded primitive name/message/stack/code/reason
fields through guarded access. It does not enumerate, serialize, inspect a
constructor or coerce arbitrary objects. Cross-realm errors retain their fields;
throwing getters, revoked proxies, circular objects and inaccessible event reasons
produce a bounded fallback instead of another error. Ignore-rule inspection is
also guarded so a hostile rejection still reaches the terminal decision.

## Piano display (B02)

The piano finds the cycle containing the current point, using an integer-cycle
start subtraction to avoid fractional-modulo rounding at exact onsets. Onsets
are inclusive, completions exclusive, including repeat boundaries and loop
offsets. The shared sequencing range iterator remains half-open. Invalid stored
keyboard indices display the existing default layout; rendering and live rebuilds
do not rewrite the saved index. Rebuilds repaint the current playing notes.

## Note gestures and raw MIDI (B03)

Duration and velocity/chance/cent node gestures own their initial notes, collection
identities and starting geometry/property values. Preview membership and approval
use that same surviving set, independent of subsequent selection replacement or
clearing. Detached/reparented notes and conflicting geometry/property values are
excluded. Alignment retains the original reference geometry even if the reference
is removed. Cancellation resets preview; approval writes one undo transaction.
Property mappings and clamping are unchanged (stored floats may round to float32).

Each raw note-off consumes the oldest still-held press of the same pitch, whether
pending or already running. Closed gates are skipped. A pending press released
before rendering produces no voice; repeated releases in one block stop distinct
running voices. Other pitches and unmatched releases are unaffected.

## Regression and qualification

- `npm test --workspace=@opendaw/app-studio -- ErrorHandler.test.ts`:
  initial implementation failed 22/24 tests; bounded extraction and provenance fix
  passed all 24. Coverage includes native and cross-realm event/rejection paths.
- `npm test --workspace=@opendaw/app-studio -- PianoRoll.test.tsx`:
  the actual component failed all five regressions before repair (timing and
  invalid layout creation); all five pass after repair.
- `npm test --workspace=@opendaw/app-studio -- OwnedNoteGestures.test.ts`:
  the initial twelve real graph/adapter tests failed before repair. Further cases
  cover reference removal, alignment cancellation and lower-bound clamping.
- `npm test --workspace=@opendaw/studio-core-processors -- NoteSequencer.test.ts`:
  all three new pending/running press regressions failed before repair and pass
  after it, alongside the existing pitch-isolation and clip-boundary cases.
- `tests/browser/r142.spec.ts` uses synthetic projects, real piano DOM and real
  pointer/Escape gesture handling through `Dragging`/`ObservableModifyContext`.
  Chromium is blocked in the worker sandbox by macOS Mach bootstrap permission
  denial before fixture execution. The merge clerk must run `npm run test:browser`
  outside that sandbox; no browser result is claimed here.

Full local qualification: `npm ci --ignore-scripts`, then `npm run build` before
`npm run lint` and `npm test`, plus `npm run test:browser`. No external service,
real MIDI device, account or personal project is required by these fixtures.

Final local result on the fresh `origin/main` base
`c637705c25853b360872cf01f86bd30360622694`: all seven slices still applied.
A final temporary restore of the original six implementation files made 44/47
focused app checks and the three added sequencer checks fail; the fixes were
restored before qualification. The final app suite passes 546 tests (including
all 47 focused checks), and core-processors passes 328 tests. `npm ci
--ignore-scripts`, `npm run build` (24 tasks), `npm run lint` (including browser
fixture lint) and full `npm test` (44 tasks) succeed. Existing lint warnings
remain nonfatal. `npm run test:browser` attempted all 64 cases but every Chromium
launch was refused by the sandbox (`bootstrap_check_in … Permission denied
(1100)`), before test execution. No slice requires an owner decision.
