# Scout round 95 repairs

Implemented with Codex from fresh `main` at `39dab9f`. All twelve scoped paths
were still applicable. Synthetic regressions are run against the original code
before each repair, then against the repair; logs stay outside this repository.
No account, personal media or external service data is used.

## B01: OPFS ordering

Alias writes previously opened two handles concurrently. Barrier tests also
showed parent/root deletion removing a directory while a child write owned an
open handle. The worker now canonicalizes paths before reserving a FIFO queue
slot. Serializing all worker operations also prevents read handles conflicting
with recursive deletion; no nested queue acquisition occurs for root deletion.
The new tests failed before the fix (8 cases) and pass afterward.

## B02: read admission and cleanup

An advertised size above budget is refused before any allocation/read, with
boundary-sized input accepted. Invalid budgets refuse before handle acquisition.
Double-fault transfer/flush tests previously reported only close failure; the
repair preserves the primary cause and reports bounded cleanup context. Close-only
errors still reject and a subsequent alias access succeeds. Eight new cases
failed before repair; all 59 OPFS cases pass afterward. Production sender forwarding
and metadata/project/preset/media consumers now pass their public read budgets.

## B03: soundfont transitions

Two import tests failed before repair: declining still imported and browse
returned an imported item. The approved-import control passed. Cancellation now
uses AbortError consistently with picker cancellation, including missing-asset
replacement. Three processor regressions failed before repair: switching to a
pending/empty pointer retained voices/display, and stops were ignored when a
loader lost its font. They now pass with the real processor/note-display path,
synthetic adapter/loader data and a tracked voice implementation. No soundfont
download or personal media is used.

## B04: composite and cascading ownership

Eight regressions failed before repair: both composite forms abandoned resources
after errors, and both cascading forms retained results superseded by reentry or
returned after owner termination. Composites now drain first and report failures
afterward. Cascades reserve a generation before cleanup/callback and dispose stale
results; append uses next so synchronous initial delivery gets the correct nested
owner. An additional cleanup-reentry test protects the generation check before
callback invocation. All terminable regressions pass.

## B05: messenger ownership and listener delivery

Four messenger tests failed before repair: repeated old-owner cleanup erased the
replacement handlers, first cleanup erased foreign replacement handlers, retired
sends still posted and disposed channels still posted. Native handlers now have
identity ownership and terminal fences; channels retire independently. Both class
and object listener regression variants also failed before repair. Unlike the
scout's assumption, safeExecute only checks presence and does not catch failures;
proxy dispatch now uses tryCatch and one warning per failure with correct this
binding. All targeted messenger/listener tests pass.
The full suite exposed three older editing tests injecting transactional failures
through general notifications. Those are now isolated by the requested policy.
Recovery oracles inject at beginTransaction and the existing fail-fast vertex
subscription API instead; additional object/class graph tests verify edits,
later listeners and undo remain intact after notification failures.

## B06: preference sync and atomic updates

Five host-sync regressions failed before repair: queued sends survived sync/host
disposal, RPC subscriptions leaked, retired hosts accepted new syncs and failed
initial sends retained their sender. Syncs now own the sender/source together and
invalidate queued tasks first. Five VirtualObject regressions failed before repair:
null/scalar replacements threw, late read-only/nonextensible failures changed
earlier roots, and getters were invoked during partial mutation. Updates now
preflight plain-record descriptors, stage assignments and publish all values before
one notification per changed root. Nested record identities remain stable and new
records are copied. Arrays keep their existing atomic-value behavior. Targeted
tests pass; unsupported input is refused without state changes.

## Local acceptance and handoff

- Node 26.13.1; `npm ci --ignore-scripts` succeeded.
- `npm run build` succeeded for all 24 packages; this includes production type checks.
- `npm run lint` succeeded, with existing unused-variable warnings.
- `npm test` succeeded across all 17 test workspaces (2552 passing tests).
- Chromium was installed into the workspace cache. The exact blocked command is
  `PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r95-opendaw/.cache/playwright npm run test:browser`.
  All three existing flows fail before execution because macOS sandbox permission
  denies Chromium's `bootstrap_check_in … MachPortRendezvousServer` (1100/SIGTRAP).
  These browser flows still need execution outside the sandbox; they are not
  claimed green. Logs are in the coordinator's `logs/cx-r95-opendaw` directory.
- All bundles are parked together on `codex-q/r95-openDAW` for the external Claude
  clerk. No review CLI, merge, Actions wait/run, release, deployment or work-app
  write was performed. No owner decision was required and no slice was skipped.
