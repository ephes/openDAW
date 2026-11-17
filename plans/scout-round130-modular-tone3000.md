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
