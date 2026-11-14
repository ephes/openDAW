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
