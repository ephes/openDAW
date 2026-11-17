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
