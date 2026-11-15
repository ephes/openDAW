# Round 98: room admission and recovery log ownership

Scope: openDAW B01–B06, based on fresh `origin/main`
`6fc3388dd18cce6949f0c6264acf12950baa688b`. All twelve source findings remained
applicable. No version, deployment, workflow or recovery-log format change.

- B01: preserve factory conflict providers; restore graph plus Y.Doc on rejection.
  Yjs UndoManager is the public inverse primitive and preserves deleted shared
  types. Policy checks follow pointer finalization; inverse graph updates run
  with outbound synchronization suppressed.
- B02: own join hydration through abort/cleanup and suppress bootstrap publication.
- B03: admit same-type root replacements and canonical signed i16 field paths.
- B04: prepare all population maps before attachment; unwind failed room setup.
- B05: give successful projects transport/document ownership; the latest connection
  intent owns installation. Project replacement/retirement invalidates pending work.
  A cancelled or failed newer attempt leaves the active project unchanged and
  prevents an older attempt from subsequently taking over.
- B06: retire active capture on termination and expose terminal writer failure.
  Await observer acknowledgement, including actual studio file closure, before
  continuing the commit chain or advancing the displayed commit count.

## Implementation process and regression evidence

Codex implemented the changes sequentially in one fresh isolated checkout, with
no delegated agents or Claude calls. Tests were added and run against each prior
implementation before its corresponding fix. Red runs are retained outside the
repository in the worker's coordinator log directory:

| Bundle | Red regression evidence | Coverage |
|---|---|---|
| B01 | `B01-before.log`: 5 failures | Factory spies; conflicting primitive/add/delete across two Y.Docs |
| B02 | `B02-before.log`: 3 failures | Malformed UUID/type unwind; bootstrap identity and extension preservation |
| B03 | `B03-before.log`: 12 failures | Primitive/pointer root replacement; incompatible type; canonical path keys |
| B04 | `B04-before.log`: 8 failures | Second-map serialization failure; timeout, decline and setup-stage cleanup |
| B05 | `B05-provider-before.log`: 1; `B05-intent-before.log`: 4; `B05-service-before.log`: 1 failure | Leave/reconnect; reversed completions; newer failure; project replacement/retirement |
| B06 | `B06-before.log`; `B06-file-before.log` | Active listener retirement; hash/sync/async observer failure; file-close acknowledgement |

Additional regressions exercise live two-document inverse exchange with finalized
pointer hubs and a bounded update count, and the real room dialog in Chromium with
a synthetic surface and deferred room provider. No live room server, account or
personal data is used. Test substitutions cover external resources, while the
production admission/lifetime functions run unchanged.

Acceptance: `npm ci --ignore-scripts`, `npm run build`, `npm run lint`, `npm test`,
then `PLAYWRIGHT_BROWSERS_PATH=<workspace>/.cache/playwright npm run test:browser`
(after `npx playwright install chromium` with the same browser cache variable).
Build generates dependent box/adapter sources and typechecks production code.
Full local results are recorded in the worker closeout; no GitHub Actions are
requested. Per the round brief, this branch is parked for external Claude review
and merge, with no local cross-family review or trunk push.

## Local outcome

Node 26.13.1 / npm 11.20.0: locked install, full build (24 tasks), lint
(24 tasks plus browser lint) and full tests (44 tasks; 2730 passed, one existing
box-forge skip) passed. The 44 added unit regressions pass. The browser fixture
also bundles with `npx vite build --config tests/browser/vite.config.ts --outDir ../../.cache/browser-build`.

Browser execution is **blocked before test startup** by the macOS sandbox:
`bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)` /
SIGTRAP. All five browser cases are unexecuted, including the new room dialog
case; this is not a passing browser gate. Repeat outside the sandbox:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r98-opendaw/.cache/playwright npm run test:browser
```

No owner decision was needed. External cross-family review and the browser run
remain for the clerk; no merge, default-branch push or Actions invocation occurred.
