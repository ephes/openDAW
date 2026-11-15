# Round 100: preset, compaction, demux and NAM ownership

Fresh SSH clone of `ephes/openDAW`, default branch `main`, baseline
`0d936819dffe4f15887f5df2197b82d3165e11e6`. No scoped slice was already fixed.
The implementation is parked for external review; it does not authorize a merge,
deployment, release, workflow change or version bump.

## Scope and regression evidence

All fixtures use synthetic graphs, samples, model metadata and deferred promises.
Preset application uses the shipped decoder and real `BoxEditing` rollback/undo.
Compaction uses real audio region adapters and pointer membership. Demux tests
publish through the real instrument/region factories and editing transactions.
NAM tests drive editor observables/menus and the actual model-install boundary.

| Bundle / slice | Regression |
| --- | --- |
| B01 `opendaw-effect-pager-preserves-device-on-refusal` | Corrupt/wrong-kind refusal preserves graph fields, parameters, history and cursor; partial installation rolls back. |
| B01 `opendaw-preset-pager-latest-selection-wins` | Finish B before A for one slot; B alone installs, sets the cursor and contributes one undo step. Independent slots both complete. |
| B01 `opendaw-preset-apply-project-lifetime-fence` | Switch/close the project or delete the effect during deferred loading; no graph or script-load mutation. |
| B02 `opendaw-preset-save-dialog-source-generation` | Edit/delete/switch source during save or replacement; edit rack membership during instrument/rack save; no storage overwrite and a fresh-save notice. |
| B02 `opendaw-track-compaction-audio-timebase` | Mixed musical/seconds regions at 60/120/240 BPM and across a tempo change; touching endpoints, overlap and undo. |
| B02 `opendaw-track-compaction-interval-work-envelope` | Same greedy placement as an independent small brute-force oracle, including initial overlaps; bounded region reads at 1k/2k/4k. |
| B03 `opendaw-demux-decoder-context-finally` | Repeated decode rejection, failing close, then successful decode; each context closes once and original decode error survives. |
| B03 `opendaw-demux-audio-suspension-ownership` | Already suspended context stays suspended; two overlapping owners suspend once and restore only after the last exit. |
| B03 `opendaw-demux-result-project-generation` | Switch during inference, import or audio admission, and close during inference; original and replacement graphs stay unchanged. |
| B04 `opendaw-demux-partial-stem-outcome` | Fail import and audio admission; name both missing stems, retain imported samples, publish no partial group, retry to four tracks, undo together. |
| B04 `opendaw-nam-pack-metadata-generation` | Finish old metadata/cache scans after the new pack or disposal; ignore old success/failure and retain current badges/menu. |
| B04 `opendaw-nam-switch-editor-retirement` | Dispose during a deferred switch, ignore late failures, abort at OPFS-read/hash boundaries, and refuse deleted targets before installation. |

With the final regression files present, temporarily restored the five production
files from the baseline and ran the focused app/core suites. The app suite failed
28 tests; compaction failed 5 tests. These failures cover all twelve slices. The
fixed versions pass all 37 focused tests. Full-graph undo assertions compare box
identities, types and serialized fields; internal creation counters legitimately
change when deleted boxes are restored.

The old compaction implementation read 1,497,502 positions for the 1k case. The
regression requires fewer than 12 reads per region and at most 4.5x growth from
1k to 4k. Occupancy uses operation-local sparse Fenwick prefix maxima, standard
binary search and one tempo-aware interval resolution per region.

## Behavioral choices

- Effects decode/install before the old effect is deleted. Failed attempts enter
  rollback; neither script loading nor the pager advances on refusal.
- Pending preset intents are local to project and destination slot. The graph
  must still contain the captured target objects before application.
- Save/replace confirmations compare the source dependency closure synchronously
  immediately before encoding, including changed membership. This avoids an
  additional await between source validation and encoding.
- Demux captures the starting profile and sample services. Every asynchronous
  phase is fenced; results never follow a project switch. Imported samples remain
  library-owned even when their arrangement result is discarded.
- Partial stem admission publishes no tracks. This makes retry safe without a
  second arrangement-reconciliation mechanism. The notice lists all per-stem
  outcomes; completely admitted groups publish in one undoable transaction.
- Shared audio suspension is reference-counted, including its restoration
  transition. Only the last owner can restore a context it found running.
- NAM editor disposal aborts its active switch. Model installation independently
  checks cancellation, device attachment and the captured model pointer after
  OPFS reading and hashing. Metadata and cache stages share a pack generation.

## Local validation

Node `v26.13.1`; declared toolchain npm `11.4.2`. Commands were invoked with
`npm exec --yes --package=npm@11.4.2 -- npm ...` to select that exact npm version.

- `npm ci --ignore-scripts`: passed.
- `npm run build`: passed (24 tasks; production and authored-test typechecks).
- `npm run lint`: passed (24 tasks plus browser lint; existing warnings remain).
- `npm test`: passed (44 tasks, including dependency builds; core 772 tests and
  studio app 166 tests passed).
- Additional TypeScript check of the new browser scenario: passed using the
  studio compiler options and its ambient declarations.
- `git diff --check`: passed.

Installed the matching Chromium in the writable workspace cache. The exact
blocked browser command, run from the clone, was:

```sh
PLAYWRIGHT_BROWSERS_PATH=../.cache/ms-playwright npm exec --yes --package=npm@11.4.2 -- npm run test:browser
```

Chromium exits before any test executes: macOS sandbox denies
`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer...`
with `Permission denied (1100)` / SIGTRAP. All seven Playwright cases therefore
remain unvalidated in Chromium, including the new preset ownership and real
project-adapter compaction scenarios. Run this gate outside the sandbox before
merging. No Actions run was requested or used as a substitute.

Logs are outside the clone in
`~/workspaces/ws-work-planning/coordination/codex/logs/cx-r100-opendaw/`:
`regressions-app-before.log`, `regressions-core-before.log`, `npm-ci-final.log`,
`build-final.log`, `lint-final.log`, `test-final.log`, `browser.log` and
`check-push-remote.log`.

No Claude command or cross-agent review ran: the worker brief explicitly reserves
review and merge for a Claude clerk outside this sandbox. No owner decision was
needed. The only remaining gates are external review and Chromium execution.
