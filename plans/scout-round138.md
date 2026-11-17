# Round 138: numeric, meter, conversion and panel contracts

Implemented with Codex from main c9c38565473267d88e0984f26bb6cde2629697b8.
All twelve scoped defects were still applicable. A read-only queue snapshot
contained 2,003 items, was complete and contained no matching scoped slugs. No owner decision, external
review, version change or publication was required. The implementation uses
existing box fields, adapter collections, Terminator ownership and local paste
checks. The merge clerk owns the external review and integration.

## Regression evidence

- B01: exhaustive independent arithmetic oracle for all 65,536 binary16 decodes;
  every adjacent finite midpoint with both signs, ordinary round trips, signed
  zero, canonical NaN and the retained overflow saturation policy. Decoder and
  midpoint tests failed before the fix. Peak unpack tests cover exact 0.5/1/2.
- B02: real ProjectSkeleton/BoxGraph and adapters compare enabled/disabled meter
  edits through undo/redo and reopen. Occupied insertion tests compare serialized
  bytes at/before/after a boundary; a free insertion supports history. Both defect
  groups failed before the fix. Structural snapshots read storage; playback
  iteration still honors enabled state.
- B03: real regions, clips and adapters cover musical/seconds time bases, native,
  pitch and time-stretch playback, constant/changing tempo, history and reopen.
  Native seconds duration and musical source-offset cases failed before the fix.
  Existing note/value conversion paths are unchanged.
- B04: actual BoxGraph dispatch, adapter collections and checkbox controls cover
  repeated exclusions/close/reopen, current field subscription counts, and track
  add/remove/reorder for both tracks and units. Both groups failed before the fix.
  Unit membership listeners persist while roster controls/field listeners retire;
  this avoids adding a listener during the collection's live dispatch.
- B05: actual PanelContent/DOM with a synthetic window boundary covers owned
  resource cleanup, retry, failed popout and embedded reconstruction, failed return
  from popout, and retired handles around rebind. All four initial groups failed
  before the fix. A failed return leaves the current binding minimized for retry.
- B06: real paste handlers reject malformed/null/primitive/array/wrong-marker,
  wrong-value-type, nonfinite and overlong payloads, retaining native fallback.
  Numeric guards still apply. Text paste/external edits update the view and
  unchanged typing preserves its node; disposal retires updates. Both defect
  groups failed before the fix.

## Local gates and clerk follow-up

Run from the clone root with Node >=23:

```sh
npm ci
npm run build
npm run lint
npm test
npx tsc --noEmit -p packages/lib/std/tsconfig.json
npx tsc --noEmit -p packages/studio/adapters/tsconfig.json
npx tsc --noEmit -p packages/app/studio/tsconfig.json
npm run test:browser
```

Install, build, lint, tests and affected-project type checks passed locally.
Lint retains existing repository warnings. The full browser gate and targeted
`npm run test:browser -- tests/browser/r138.spec.ts` were attempted but Chromium
could not launch in the macOS sandbox: MachPortRendezvousServer bootstrap_check_in
returned Permission denied (1100), then SIGTRAP. These are blocked gates, not
passing browser acceptance. The clerk must run the full browser gate outside the
sandbox before integration.

`tests/browser/r138-contracts.ts` adds live DOM clipboard/selection and real field
history, the full piano component with actual project membership, native audio
conversion and synthetic OfflineAudioContext sample selection, exact waveform
peak unpacking, and embedded panel factory/binding ownership fixtures. The new
browser fixture also passed a no-emit type check with the app's ambient declarations.
All fixture data is synthetic; no accounts, devices, clipboard reads or services
are used. Logs are outside the clone in the worker's designated coordination log
directory. No Claude command or push was run.
