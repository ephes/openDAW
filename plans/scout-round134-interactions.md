# Round 134 interaction contracts

Implementation process: Codex checked a fresh `main` clone against the scout,
added regressions against production components with synthetic boundaries, ran
those regressions before changing each affected implementation, then applied
small local repairs. No external service or personal data is involved. The
outside merge clerk owns cross-family review and integration.

## Menus (B01)

Menus use `performance.now()` for the existing 250 ms release guard. Each child
menu starts its own guard. Only a primary-button release may prevent the event,
close the menu and invoke a command; secondary/middle releases leave it open.
Context-menu opening remains available. `Menu.test.ts` independently controls
wall and elapsed clocks and invokes the installed handlers.

## Validation

From the repository root: `npm ci --ignore-scripts`, `npm run build`,
`npm run lint`, `npm test`, `npm run test:browser` (Chromium installed).
Targeted red/green receipts and full-gate logs live in the worker log directory,
not in this repository. Browser fixtures use synthetic projects and MIDI ports.

## Menu population and canvas frames (B02)

Failed menu collection discards only children appended by that attempt and
restores the previous collection state in `finally`. Permanent children and
later successful openings remain usable. `MenuItems.test.ts` covers both
collector and runtime-procedure failures.

Canvas rendering consumes the current dirty bit before calling the painter.
Invalidations raised during drawing survive for the next frame. Each existing
frame callback checks DPR before returning idle: a density-only change resizes
and draws once. Hidden canvases retain work and retirement stops frames.
`painter.test.ts` uses recording frame/resize/context seams, including resize,
reentrant requests, hidden canvases and teardown.

## Device view ownership and deletion (B03)

The panel owns the project-selection subscription separately from its replaceable
chain. It releases that subscription before switching profiles and at teardown.
MIDI CC row views are retired on individual removal or parent teardown; cleaning
up a view does not delete the persisted parameters.

The panel's raw Delete/Backspace handler respects `defaultPrevented`, composition
and the same composed-origin `Events.isTextInput` policy used by shortcuts.
Deliberate effect-header deletion remains a single undoable graph edit with
contiguous surviving effect indexes. Component tests use actual graph boxes,
BoxEditing and NumberInput, with counted mounts/row subscriptions at the view
boundary. jsdom's missing contenteditable inheritance is covered by Chromium.

## Sample range and waveform loading (B04)

Sample endpoint hit testing compares absolute distances while retaining the
signed pointer-to-marker offset. Stationary grabs on either side of either
marker preserve normal and reversed ranges; updates use the current canvas
width, clamp to [0, 1], and retain the existing approve/cancel edit boundary.

SlotEditor owns one replaceable file-loader subscription. Selecting a new file
invalidates immediately, releases the previous loader and observes loaded peaks
for another draw. Teardown releases the loader without changing sample data.
The component regressions cover both handle sides, reverse ranges, near markers,
resize, cancel/approve and out-of-order A/B completion with counted observers.

## Pad navigation and MIDI presentation (B05)

Octave hover owns a single timeout and generation. A new enter retires the old
attempt; leave, drop, completion and component teardown clear its timer and
visual state. Only the current uninterrupted one-second hover changes octave.

The MIDI selector observes granted access and the current access's port state
changes. Availability requires the saved ID to identify a connected output.
Refreshing presentation never rewrites the ID or adds an undo operation. Access
replacement and selector teardown remove the statechange listener. Regressions
use fake timers, nested SVG events and synthetic MIDIAccess with no hardware.

## Worker validation receipt (2026-11-17)

Fresh SSH origin: `git@github.com:ephes/openDAW.git`, default branch `main`, base
`273affd77d4bc5c0d0ff49c41f08d6444e85c1f7`. All twelve slices remained applicable;
none required an owner decision. Each slice's targeted regression failed before
its production fix. The 28 targeted tests pass after the fixes.

Passed on Node 26.13.1 / npm 11.20.0:

- `npm ci --ignore-scripts`
- `npm run build` (24 tasks, including production and test TypeScript checks)
- `npm run lint` (existing warnings, no errors)
- `npm test` (44 successful tasks)

`tests/browser/r134.spec.ts` adds real-button context menu/child activation,
browser density emulation with an idle canvas, and actual panel DOM/NumberInput
keyboard dispatch against synthetic graph boxes and undo. The panel fixture
isolates the raw key boundary from deferred studio-chain rendering; the unit
component tests separately cover mounting/profile/row lifetimes. Browser fixture
and spec also pass a separate TypeScript check with the studio's ambient types.

The implementation sandbox could not launch Chromium (macOS
`bootstrap_check_in … Permission denied (1100)`), so browser acceptance ran at
merge time instead.

## Merge validation (2026-11-17)

Outside the sandbox, `npx turbo build --force`, `npm run lint` and
`npx turbo run test --force` passed. The full `npm run test:browser` passed
42 of 43 tests, including all three round-134 journeys. The one failure,
`tests/browser/scripts.spec.ts` (`'script-contracts' is not defined in
AudioWorkletGlobalScope`), already fails on the unchanged integration branch and
is unrelated to this round.
