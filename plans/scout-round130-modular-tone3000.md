# Modular wiring and Tone3000 ownership

Implementation proceeds in five ordered bundles with synthetic graph, frame,
popup and OPFS fixtures. Tests exercise production entry points; no account or
real capture is needed. Regression runs are recorded outside the repository.
Codex implements and checks the changes; the external merge clerk performs the
cross-family review and any unavailable local gates before integration.

## Modular wiring

Only one wiring preview belongs to an environment. Zero compatible destinations
never enter wiring mode. A new gesture, pointer cancellation, window blur or
closing the environment retires the preview and listeners. Failed setup/commit
also releases the gesture. A closed environment cannot start another gesture.
Rewiring keeps the original route throughout preview. A valid drop checks current
module, connector and original connection ownership, then deletes/replaces the
route in one undoable transaction. Cancellation leaves the original identities
untouched; a removed or changed endpoint cannot receive a late connection.

Validation: `npm test --workspace=@opendaw/app-studio -- --run src/ui/modular/ModularEnvironment.test.ts`
(fails on the original implementation, passes after the repair).

Each wire view owns its module x/y/collapsed subscriptions and deferred redraws.
Removed connections retire their pending first draw; queued callbacks verify the
same view instance and current endpoints. Closing a view clears its queues and
subscriptions even when the graph survives. Preview registration is an owned
handle: closing an older view does not clear a newer view's registration.

Validation: the modular test directory additionally covers controlled frame
queues, add/remove/undo, removed endpoints and repeated live graph views.

## Tone3000 selection

The redirect carries a random per-selection `selection` query parameter. Both
storage publication and acknowledgement use keys suffixed with that identity;
no global keys are cleared. The callback listens before publishing and removes
its listener/timer on acknowledgement, page exit, refusal or five-minute expiry.
The caller owns a finite cancellable exchange and its popup, with editor/device
retirement and supersession releasing the wait.

S05 limitation requiring an owner decision: Studio's COOP `same-origin` severs
WindowProxy handles on cross-origin navigation. `popup.closed` therefore cannot
reliably distinguish an open external selector from user closure. Do not poll it:
that would abort valid selections. A local relay with an extra user click could
own a reliably observable same-origin popup, but changes the user flow. S05's
close-detection scope is deferred pending that choice. Scoped callback ownership
(S06) and finite cancellation do not depend on that decision.

## Current device and pack revisions

A browse captures the staged device and original model target before the dialog.
Every asynchronous boundary and the graph transaction check that owner; changing
the model, deleting the device, closing its editor or a newer browse intent
retires the attempt. Late hashing cannot create an unattached model box.

Pack metadata carries an opaque persisted `cacheRevision`. Model paths include
that revision; reads check the manifest again after asynchronous reads/downloads.
An updated `updated_at` gets a new revision even if model IDs are unchanged.
An unchanged revision retains cache hits. Legacy unversioned model files are
never trusted as current: reselect the pack online to establish its revision.
Existing project-embedded models continue to work offline. Legacy metadata may
still supply download URLs, but legacy bytes are not promoted into the new cache.

## Complete pack publication and recovery

Pack writers share an origin-wide Web Lock per tone ID. A new revision stages
its validated default model first, then atomically replaces `pack.json` last.
`OpfsProtocol.writeAtomic` uses the browser's `createWritable` swap-on-close API,
inside the existing worker FIFO; failed writes abort the temporary writer.
Optional model downloads also publish atomically and recheck the current revision
under that lock. The normal `write` API retains its previous semantics.

Prepublication failure leaves the previous complete manifest and bytes usable.
A close failure with an uncertain outcome retains potentially current bytes;
reopening sees either the old complete pack or the new complete pack. An
interruption can leave one unreferenced staging revision. The next selection
removes all noncurrent revision directories before staging another. Cleanup
failure stops that attempt; it does not allocate further staging. The previous
revision may remain until the next selection, so storage holds current plus one
staging/previous revision between attempts. Legacy unversioned files are left
untouched and never used as revision evidence.

## Transfer admission

Metadata allows 1 MiB and 15 seconds total; each NAM model allows 16 MiB and
60 seconds total. Deadlines include response headers and all body reads and never
reset on trickling chunks. Caller cancellation composes with both. Actual streamed
bytes are counted even with missing or dishonest Content-Length. Overflow,
non-success HTTP, invalid UTF-8, malformed JSON or unsupported shape is refused
before persistence. Readers/timers/listeners are released; a late response from a
noncooperative transport has its body cancelled.

Packs require positive safe integer IDs, nonempty titles/names (at most 512
characters), a nonempty revision string (at most 128 characters), and 1–256 unique
model IDs. Known sizes are standard/lite/feather/nano/custom. Transfer URLs must be
HTTPS, without credentials, at most 8192 characters; signed CDN URLs are allowed.
NAM JSON requires version/architecture strings, an object config and a nonempty
finite numeric weights array. This admits the transfer structure; the existing
NAM engine remains responsible for architecture/config compatibility.

## Qualification and clerk follow-up

- Locked setup: `npm ci --ignore-scripts`.
- Full local contract: `npm run build`, then `npm run lint` and `npm test`.
- Browser contract: `npm run test:browser` (synthetic modular views, isolated
  parallel callbacks and real worker OPFS; no account or real captures).
- Chromium cannot launch in the worker sandbox: macOS denies bootstrap registration
  of `org.chromium.Chromium.MachPortRendezvousServer` (Permission denied 1100).
  The clerk must run the browser contract outside the sandbox. The fixtures are
  committed for that run; no browser pass is claimed.
- Baseline regression runs failed for B01/B02, S06, B04 and both B05 slices;
  targeted corrected tests pass. S05's reliable external-popup-close detection
  remains an owner decision as described above.

Full qualification completed: locked install, root build (24 tasks), lint (24
package tasks plus browser lint), and unit suites (44 tasks, including 414 Studio
tests) succeeded. The browser command was attempted and failed before executing
any test because Chromium cannot launch in the sandbox. The new browser fixtures
also pass a static TypeScript check with the app's ambient browser declarations.
No push, merge, release, deployment or external review was run in this worker.

Browser API references: [COOP and severed window handles](https://developer.mozilla.org/en-US/docs/Web/API/Window/open#return_value)
and [staged createWritable publication](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable).
