# Software MIDI ownership

Round 84 bundle B01 rechecked main b7bab7a8. Codex implemented and checked
SoftwareMIDIInput directly; regression tests use real EventTarget dispatch and
synthetic MIDI messages without browser hardware or platform assumptions. All
seven regressions failed against the original implementation.

The fix uses number counts with a safe-integer guard and ignores unmatched offs.
Listener registrations follow callback/type/capture identity, with explicit once
and abort cleanup around the native dispatcher. No external dependencies.

## Resume after authentication repair

Status: unfinished, unreviewed B01; do not merge until a valid review passes.
Branch: `fix/r84-software-midi`, based on `main` b7bab7a8be1014d5b7806eb6f828e80ba7688968.
Remote confirmed: `git@github.com:ephes/openDAW.git`. No AGENTS.md exists in the clone.

Implemented slices:
- `opendaw-software-midi-note-count-domain`
- `opendaw-software-midi-listener-accounting`

Validation: `npm ci --ignore-scripts`, `npm run build` and `npm run lint`
passed locally (lint has existing warnings). All seven new tests failed before
and passed after the fix. Full `npm test` passed: 44 tasks successful, including
574 studio-core tests and all seven new regressions.

The required claude-review-loop invocation used `--model claude-opus-5-5
--effort high`. It returned PROVIDER_ERROR, not a review verdict:
"Failed to authenticate: OAuth session expired and could not be refreshed".
No findings were evaluated, no valid baseline snapshot was recorded, and no merge
was performed. Review artifacts are local at
`../.cache/review/b01-r1/{result.json,events.jsonl,review-bundle.md}`.

After refreshing Claude authentication outside this task, fetch origin and rebase
this branch on current origin/main. Rerun local build/lint/tests if trunk changed,
then review the complete B01 delta against origin/main (the parking commit means
an ordinary worktree-only review would see no implementation diff; pass the
original base as `--baseline-ref`, or arrange the full delta in a throwaway
checkout). Use a fresh run directory and Opus 5.5 high; retain progress-driven
repair rounds with a maximum of four and stop on a recurring required finding.
A clean or suggestion-only completed review is required before merging.
Fetch/rebase immediately before the local --no-ff merge, run all local checks
again after merging and before pushing main, then verify with git ls-remote.
Use `[skip ci]` in commits to avoid paid workflow runs; never trigger Actions.

Then continue scout-round84.md bundles B02–B06 in order, rechecking every slice
against current trunk. Those ten slices have not been implemented or validated.
No deployment, release, tags, PRs, host access or work-app writes are included.
The feature branch is pushed only to park unfinished work under the explicit
OAuth-failure instruction. Never delete remote branches.
