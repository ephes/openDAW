# Box transaction failure settlement

Failures inside graph and history operations must leave the graph usable.

- `stageBox`: a throwing constructor left `constructingBox` set, so every later
  box construction failed, and its deferred pointer updates stayed queued. A
  rollback then tried to invert them on the never-staged box and threw again,
  leaving the graph in a transaction. The constructor's deferred updates are now
  discarded, their edges unwound and the box's vertices unwatched before the
  error is rethrown.
- `beginModification`: if `beginTransaction` threw (already in a transaction or a
  throwing transaction listener), the update subscription and the
  modifying/in-process flags leaked and editing stayed locked. They are released;
  a transaction this call entered is aborted; another owner's is left alone.
- `#finalizeTransaction`: one throwing end-transaction observer dropped the rest
  of its batch and skipped `onEndTransaction` and the rollback flag reset. Every
  observer now runs in isolation. Because the transaction is already committed,
  failures are reported as unhandled promise rejections (visible to the app's
  error handler, and safe in the audio worklet) instead of being thrown from
  `endTransaction`. Otherwise `BoxEditing` would treat a committed edit as failed
  and leave it out of the undo history.
- `undo`/`redo`: when a step failed and compensation of applied steps also threw,
  the error escaped with the graph still in a transaction and the history index
  moved. Compensation now aborts open transactions per step, continues best
  effort, restores the index, notifies and returns false.

Regressions: `packages/lib/box/src/editing.test.ts`, "graph and history failure
settlement".
