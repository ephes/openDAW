# Round 84: MIDI learning lifetime

Scope: `opendaw-midi-learning-permission-retirement-fence` and
`opendaw-midi-learning-follow-subscription-teardown`.

Rechecked current main at `57f6b668`: both findings remain. Permission completion
did not validate the owner/target lifetime, and termination left the followed
pointer-hub subscription live.

Implementation uses a followed-owner generation, attachment checks before listener
installation and mapping creation, and explicit idempotent subscription teardown.
Termination also aborts the owned learning dialog. The separate single-active-
attempt and live-routing slices remain out of scope for this bundle.

Codex authored the implementation and synthetic regressions using real graph,
editing and pointer-hub objects, with permission, notifications and MIDI input
stubbed. The regressions fail on the previous implementation: stale completions
install a listener, deleted targets receive mappings, and post-termination pointer
removal reaches a cleared connection set. The current-owner success case preserves
existing MIDI value normalization.

Validation: `npm ci --ignore-scripts`, `npm run build` (including typechecking),
`npm run lint`, and `npm test` pass. Lint has warnings and no errors. All eight
focused tests pass; restoring the previous implementation gives seven failing
regressions and one passing current-owner case.

Review BLOCKED: claude-review-loop with `--model claude-opus-5-5 --effort high`
exited 2, state PROVIDER_ERROR. Provider reported authentication_failed: OAuth
session expired and could not be refreshed. No review verdict or findings were
produced; nothing is merged. Artifacts remain in the workspace sibling directory
`review-midi-lifetime-1/` (including result.json).
Use `[skip ci]` in commits to avoid paid workflow runs. No deployment or release
is included.


## Resume

Parked branch: `fix/r84-midi-learning-lifetime`, based on main `57f6b668`.
Restore Claude OAuth authentication outside this worker, fetch origin, and rebase
this branch onto current origin/main. Recheck the two findings against any new
trunk changes and rerun build, lint and tests after a rebase. To review committed
parked work, expose the branch delta relative to origin/main in a disposable local
review checkout (the harness normally reviews only uncommitted changes). Run the
same required Opus model/effort and record a fresh review. Fix/re-review while
converging, at most four rounds, stopping if a required finding recurs. Only a
passing review permits local --no-ff merge. Fetch immediately before merging,
rebase and rerun checks if origin moved, then run the full local checks after
merge before pushing main with `[skip ci]`; verify via git ls-remote. Never run or
wait on GitHub Actions.

The software MIDI bundle is already merged on main and was skipped. No later
bundle was started or verified in this continuation, because the owner explicitly
requires stopping on unavailable OAuth review. Continue in report order:

1. `opendaw-midi-learning-single-active-attempt` and
   `opendaw-midi-controller-live-routing-retarget`.
2. `opendaw-capture-device-inner-subscription-retirement` and
   `opendaw-capture-detach-notifies-observers`.
3. `opendaw-automation-nonquantized-loop-boundary` and
   `opendaw-automation-seek-versus-loop-transition`.
4. `opendaw-automation-deleted-active-state-retirement` and
   `opendaw-automation-simplification-error-envelope`.

Reverify each against current trunk before implementation. No subagents, work-app
writes, deployment, releases, tags, PRs or Actions were used.
