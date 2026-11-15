# Scout round 99 implementation

Base: main at 6fc3388dd18cce6949f0c6264acf12950baa688b. All twelve scout findings
were present. Bundles were implemented in B01–B05 order in one Codex work context;
no delegated review, Claude command, model download, deployment or merge was run.
The branch is parked for the external review/merge clerk.

Regression evidence before fixes (synthetic data only):

| Bundle | Oracle and pre-fix result |
| --- | --- |
| B01 | Real BoxGraph/BoxEditing and filtered projections: four failing regressions for index ordering, both catchup projections and reentrant release; replay-throw cleanup cases already pass. |
| B02 | Shared extracted transient routines preserve the old algorithm before repair; direct clipped RMS, backward valley reference and counted reads, plus rate admission: 19 failures before correction. |
| B03 | Mock session tensors, finite PCM/duration, timer cancellation inside real FFT preprocessing and counted allocations: 16 failures, valid octave case passes. |
| B04 | Real ZIP/XML export/decode/reimport: three failures for duplicate sample labels/unsafe path components and reordered effect chains. |
| B05 | Real sample service/storage with in-memory OPFS and mocked peak generation: four failures for compressed input, concurrent pipelines, orphan cleanup and primary-error preservation. Extra receipt tests fence adoption and replacement generations. |

New browser fixtures cover selection catchup and the real file/ZIP/import service
with mocked sample publication; they require only local Chromium. Package READMEs,
the root README and affected Unreleased notes describe the resulting contracts.
Logs live outside this repository in coordination/codex/logs/cx-r99-opendaw.

Additional nested select/deselect tests exposed graph finalization still in progress
at pointer callbacks. Selection command notifications now wait for Editing.modify
to return; external edits defer notifications to a microtask. Index state updates
remain synchronous, and generation/current-state fences skip stale queued events.

Local npm ci, npm run build, npm run lint and npm test pass. Additional adapter and
inference test typechecks use tsc --noEmit. Chromium installed successfully, but
the sandbox blocks its launch with bootstrap_check_in Permission denied (1100).
The exact blocked command is:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r99-opendaw/.cache/ms-playwright npm run test:browser
```

All six browser cases (four existing, two added) remain unexecuted because of that
launch restriction. No Actions fallback is authorized. The clerk must run this gate
outside the sandbox and perform the independent review before merging.
