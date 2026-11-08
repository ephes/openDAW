# Round 83 openDAW resume

## Parked bundle B01

Branch: `fix/r83-clipboard-admission`.
Base: `origin/main` at `932b4ee42b4b7b17814811234c2d43ec62bfe5f6`.
Origin verified: `git@github.com:ephes/openDAW.git`.

Implemented and reverified against that default branch (none already fixed):

- `opendaw-clipboard-text-admission-budget`
- `opendaw-clipboard-binary-length-preflight`
- `opendaw-clipboard-payload-kind-allowlist`

Shared 8 MiB binary admission limit; encoded and decoded size preflight before
atob; metadata, graph and nested record lengths before allocation; full temporary
graph decode and a notes/owned-repeat-feature allowlist before target creation.
Invalid native envelopes do not replay the in-memory fallback. README, package
Unreleased changelog and `plans/clipboard-admission.md` describe the behavior.

## Validation

Node 26.13.0, npm 11.20.0; synthetic fixtures only, no platform-dependent tests.

- `npm ci --ignore-scripts`: passed (existing dependency audit findings unchanged).
- `npm run build`: passed, all 24 tasks (includes TypeScript checks).
- `npm run lint`: passed, all 24 tasks; existing warnings, no errors.
- `npm test`: passed, all 44 tasks; studio-core 43 files / 567 tests passed.
- Focused clipboard suite: 14 passed. Replacing the three production files with
  their origin/main versions: 12 regressions failed, two valid/boundary controls
  passed. Restoring the repairs: 14 passed again.
- `git diff --check`: passed.

## Review blocker and finishing steps

Required review attempted with the installed `claude-review-loop` harness,
`--model claude-opus-5-5 --effort high --record-baseline`.
It exited 2 with `PROVIDER_ERROR`, `api_error`, and the authentication message:
“Failed to authenticate: OAuth session expired and could not be refreshed”.
No completed review or verdict exists. No merge or default-branch push occurred.
This feature branch is pushed only under the owner's explicit unfinished-work
parking exception. Do not treat passing local checks as review approval.

Local artifacts (outside the repository, in the workspace):
`reviews/b01-round1/result.json`, `reviews/b01-round1/events.jsonl`,
`b01-build.log`, `b01-lint.log`, `b01-test.log`,
`b01-regression-baseline.log`, and `b01-green.log`.
The failed review copy was removed; no files were skipped, truncated or redacted.

After authentication is restored, the Claude finisher should review the complete
B01 diff against main, including this note. The harness normally reviews the
uncommitted delta; on this parked committed branch, prepare the complete diff
against main in its review copy or use a supported baseline reference. Keep
repair re-reviews scoped to accepted findings plus repair deltas, stop at four
rounds or a recurring required finding. Do not merge without a completed clean
or suggestion-only review. Before merging fetch origin; if main moved, rebase
and rerun local checks. Merge locally with `--no-ff`, rerun the full local checks
before pushing main, then verify its SHA with `git ls-remote`. Do not query,
wait for or rerun Actions; do not open PRs, deploy, release/tag or delete remote
branches. No work-app writes.

## Remaining authorized bundles, in report order

Not started or reverified: the owner explicitly required stopping after the
OAuth failure. Continue each against the then-current default branch; skip any
already-fixed slice. Source report:
`~/workspaces/ws-work-planning/reviews/scout-round83.md` (full descriptions,
bundle order, cautions and validation notes).

B02:
- `opendaw-failed-paste-restores-selection`
- `opendaw-clipboard-finite-placement-metadata`
- `opendaw-paste-error-does-not-replay-fallback`

B03:
- `opendaw-pending-paste-owner-lifetime`
- `opendaw-midi-queued-stream-disarm-fence`

B04:
- `opendaw-midi-unknown-latency-safe-default`
- `opendaw-midi-retrigger-record-preservation`

B05:
- `opendaw-midi-input-channel-note-ownership`
- `opendaw-retrospective-midi-bounded-history`

These later scopes are intentionally unfinished. In particular B01's notes
allowlist rejects before target box creation but does not yet restore external
selection on a failed paste (B02), and ClipboardManager's existing handler-error
catch can still replay fallback (also B02).

## Finisher outcome (round 84)

B01 reviewed by the Claude finisher (Opus): no Critical/Warning findings.
Suggestions only: the notes allowlist hard-codes the collection `events` field
key `1` (covered by the real copy/paste round trip), and oversized non-openDAW
text now suppresses the in-memory fallback like an invalid envelope. Build,
lint and the full test suite rerun before the `--no-ff` merge to `main`.
B02-B05 remain open as listed above.
