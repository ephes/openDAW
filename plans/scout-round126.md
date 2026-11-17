# Round 126: editing and ownership boundaries

Fresh SSH clone of ephes/openDAW, based on main. Changes are authored in small
local commits; no push, merge or remote review is performed. Regression fixtures
exercise production adapters and graph operations with synthetic data. Tests are
run before and after each repair; full local validation follows all bundles.

## B01

Flatten uses exactly the supplied source list for both copying and deletion and
reduces all complete endpoints for the replacement span. Note copy retains the
ratchet curve. TimelineEdits.test.ts covers source isolation, nested/equal-start/
disjoint/reordered spans, graph replay/inversion and serialized ratchet copies.

Deferred owner decision: `note-flatten-preserves-loop-truncation-playback`.
NoteSequencer computes curved repeat attacks with fractional pulse positions and
clips individual repeats against source loop/region ends. NoteEventBox stores
position/duration as Int32. Shortening a repeated source note changes its attack
spacing; expanding it to persistent single notes rounds attacks and also changes
per-source chance behavior. The current flatten API has no playback-preference
argument. Exact preservation needs a decision on persistent boundary metadata
(or acceptance of quantization/chance changes) and preference plumbing. No partial
clipping repair is included; this slice remains applicable and unfixed.

## B02

Content start translation uses the existing note/value consolidation and play-mode
clone APIs before changing coordinates. The audio path resolves the new adapter
directly because pointer subscription publication waits for transaction end.
TimelineEdits covers single/two-owner trims with a shared clip, graph replay/undo,
serialized content and shared audio warp markers. Preroll tests cover muted-first,
all-muted and enabled holding values. All six new cases failed on the prior code.

## B03

The adapter owns its pointer listeners and current loader subscription. Each
transition retires the old subscription and advances a generation; disposal
retires the whole owner and fences saved callbacks. Synthetic loader tests cover
pending A to cached B, empty and pending B, old loaded/error/idle callbacks, preset
selection and repeated disposal with real pointer listener cleanup. Four tests
failed before the repair. No font downloads or shared-loader disposal is used.

## B04

MIDI registrations count independent idempotent owners and publish aggregate state
before notifying listeners. JSX accepts an explicit connection lifetime; all four
current call sites use their existing view owner. Unit tests with fake frames
verify cancellation, queued callback fencing and first-connection-only dispatch.
The new independent-owner and frame tests failed before the fix.

The r126 browser fixtures construct real NoteEditor/ValueEditor views on synthetic
projects. Their integration run is not qualified locally: Chromium exits before
page creation because macOS sandbox denies MachPortRendezvousServer bootstrap.
Exact attempted command (from repo root):
`PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r126-opendaw/.cache/playwright npm run test:browser -- tests/browser/r126.spec.ts`.
The clerk must run the full `npm run test:browser` outside the sandbox.
