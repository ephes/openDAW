# Podcast Recording — Product-Integration Implementation Plan

Source spec: `docs/podcast-recording/product-integration-spec.md`. Foundation: phases 0–3 under
`docs/podcast-recording/`.

**Goal:** ship the smallest mono/stereo podcast-recording MVP in the normal openDAW workflow.

**Architecture:** per-track `CaptureAudioBox.longRecording` boolean branches `CaptureAudio.prepareRecording /
startRecording` into a new `RecordAudioLong` lifecycle that wraps `LongRecordingService.startFromSource`. A new
`LongRecordingSampleLoader` (peaks from overview bins, lazy `AudioData`) plugs the chunked artifact into the
existing `SampleLoader`/`SampleLoaderManager` contract so renderer, engine, and export work unmodified.

**Tech stack:** TypeScript, Vitest, openDAW lib-std/lib-fusion/lib-dsp/lib-box, studio-boxes (forge-generated),
Playwright Core (browser harness already wired).

---

## Task Layout

Tasks are ordered for sequential execution. Each task lists exact files, the unit-test files added with it, the
TDD discipline to apply, and the verification command(s).

### Task 1 — Add `longRecording` field to `CaptureAudioBox`

**Why:** the schema lives in `forge-boxes/src/schema/std/CaptureBox.ts` and is auto-generated into
`packages/studio/boxes/src/CaptureAudioBox.ts`. We need this field before any code can read or write the
toggle.

**Files:**
- Modify: `packages/studio/forge-boxes/src/schema/std/CaptureBox.ts` — add `12: {type: "boolean", name:
  "long-recording", value: false}` to `CaptureAudioBox.fields`.
- Regenerate: `packages/studio/boxes/src/CaptureAudioBox.ts` (via the forge build step).
- Optional sanity test: `packages/studio/boxes/src/CaptureAudioBox.test.ts` — assert `box.longRecording.getValue()
  === false` for a fresh instance.

**Verify:**
- Run the forge regeneration step (typically `npm run -w @opendaw/studio-boxes build` or the project's
  equivalent forge command — to be confirmed by inspecting `packages/studio/forge-boxes/package.json`).
- Run `npx tsc --noEmit` (or the workspace equivalent) in `packages/studio/core` and `packages/studio/adapters`.
- Run `npx vitest run packages/studio/boxes` if forge-boxes ships its own test target.

**Commit:** `feat(podcast-recording): add longRecording flag to CaptureAudioBox schema`

---

### Task 2 — `LongRecordingPeaksAdapter`: overview bins → `Peaks`

**Why:** the `Peaks` interface from `lib-fusion` is what the upstream renderer paints. The existing overview
file stores per-chunk min/max in Float16; we need a `Peaks`-shaped wrapper around it. Pure module, TDD-first.

**Files:**
- Create: `packages/studio/core/src/recording/LongRecordingPeaksAdapter.ts` — exports a single
  `LongRecordingPeaksAdapter.fromBins(bins, channels, samplesPerBin): Peaks` factory.
- Create: `packages/studio/core/src/recording/LongRecordingPeaksAdapter.test.ts` — Vitest cases:
  1. Empty bin array → `Peaks` with `numFrames === 0` and zero stages.
  2. Single-channel, 4 bins of [min, max] → `Peaks` returns those bins back through its single stage.
  3. Stereo → channel ordering preserved.
  4. The number of stages and shifts is consistent with what `SamplePeaks.findBestFit` produces for the same
     frame count (lock the upstream stage layout — see `lib-fusion/src/peaks/SamplePeaks.ts`).

**TDD:**
1. Write the four tests first; run them; confirm failure ("not exported").
2. Implement the adapter.
3. Run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/recording/LongRecordingPeaksAdapter.test.ts`

**Commit:** `feat(podcast-recording): peaks adapter for long-recording overview bins`

---

### Task 3 — `LongRecordingArtifact.probeAll`

**Why:** the Dashboard panel needs to enumerate every non-clean recording on boot. Pure I/O wrapper over the
existing `LongRecordingArtifact.collect` + `LongRecordingRecovery.classify`.

**Files:**
- Modify: `packages/studio/core/src/recording/LongRecordingArtifact.ts` — add
  `LongRecordingArtifact.probeAll(opfs): Promise<ReadonlyArray<{recordingId, manifest, recovery}>>`.
- Create or extend: `packages/studio/core/src/recording/LongRecordingArtifact.test.ts` (already exists for
  collect/restore; add a `probeAll` test block).

**TDD:**
1. Test: in-memory OPFS pre-seeded with three recordings (one clean, one truncated, one missing manifest).
   `probeAll` returns the two non-clean entries with the expected classifications and omits the clean one.
2. Implement.
3. Run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/recording/LongRecordingArtifact.test.ts`

**Commit:** `feat(podcast-recording): probeAll surface for dashboard recovery panel`

---

### Task 4 — `LongRecordingSampleLoader`

**Why:** the SampleLoader adapter is the seam between the long-recording artifact and the renderer/engine. It
must produce peaks immediately and materialize audio lazily.

**Files:**
- Create: `packages/studio/core/src/samples/LongRecordingSampleLoader.ts` — implements `SampleLoader` from
  `@opendaw/studio-adapters`. Holds `LongRecordingMediaReference` + `LongRecordingMediaAccess` +
  `LongRecordingPeaksAdapter` output. `state` advances `"progress" → "loaded"`. `materializeAudioData()` reads
  every chunk in order, concatenates into one `AudioData`, caches it, and notifies subscribers.
- Create: `packages/studio/core/src/samples/LongRecordingSampleLoader.test.ts`.

**TDD:**
1. Tests:
   - `peaks` is `Some` immediately after construction; bin count matches the manifest.
   - `data` is `None` before `materializeAudioData()` and `Some` after.
   - `state` transitions: subscribers added before construction observe a `"progress"` snapshot, then
     `"loaded"` once peaks are ready. (Peaks build is synchronous from in-memory overview, so this is one tick.)
   - `invalidate()` drops cached `AudioData` and emits a `"progress"` notification.
   - `uuid` equals the `UUID.parse(reference.recordingId)` bytes.
2. Implement; run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/samples/LongRecordingSampleLoader.test.ts`

**Commit:** `feat(podcast-recording): sample loader adapter for long recordings`

---

### Task 5 — `GlobalSampleLoaderManager` long-recording fallback

**Why:** when the sample manager is asked for a uuid that has no `SampleStorage` entry but does have a
long-recording manifest, it must produce a `LongRecordingSampleLoader` instead of falling through to the API.

**Files:**
- Modify: `packages/studio/core/src/samples/GlobalSampleLoaderManager.ts` — extend `#load()` to:
  1. After `SampleStorage.load` rejects, call `LongRecordingMediaReference.load(uuidString, Workers.Opfs)`.
  2. If a reference is returned, construct a `LongRecordingSampleLoader`, **replace** the entry in `#loaders`
     for that uuid, set the **previous** `DefaultSampleLoader` to `error("superseded by long-recording")`, and
     emit no API fetch.
- Create: `packages/studio/core/src/samples/GlobalSampleLoaderManager.longRecordingFallback.test.ts`.

**TDD:**
1. Tests:
   - In-memory OPFS pre-seeded with a long-recording manifest under `recordings/v1/<uuid>/` but no
     `samples/v2/<uuid>/audio.wav`. `getOrCreate(uuid)` eventually exposes a loader whose `peaks.nonEmpty()` is
     true and whose `uuid` matches.
   - The original `DefaultSampleLoader` transitions to `"error"` once before the swap is observable from outside
     (covered by a deterministic subscribe-before-load test).
   - When **both** sources exist, `SampleStorage` wins (regression: musical takes are unaffected).
2. Implement; run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/samples`

**Commit:** `feat(podcast-recording): fall back to long-recording loader in sample manager`

---

### Task 6 — `RecordAudioLong` lifecycle

**Why:** the per-track long path needs the same region-/file-box lifecycle that `RecordAudio.start` provides
for musical takes, but with `timeBase = TimeBase.Seconds`, no take/loop handling, and a `LongRecordingHandle`
in place of a `RecordingWorklet`.

**Files:**
- Create: `packages/studio/core/src/capture/RecordAudioLong.ts`.
- Create: `packages/studio/core/src/capture/RecordAudioLong.test.ts`.
- (No change to `RecordAudio.ts`.)

**TDD:**
1. Tests use a stub `LongRecordingHandle` whose `session.totalFrames` is driven by the test; a stub `Project`
   wrapping a real `BoxGraph` so editing transactions still apply; assertions:
   - On the first `engine.isRecording=true` tick, an `AudioFileBox` and `AudioRegionBox` are created with the
     expected `timeBase`, `waveformOffset`, and `fileName` pattern.
   - Subsequent ticks update `regionBox.duration` and `fileBox.endInSeconds` from the running `totalFrames`.
   - On `Terminable.terminate`, `handle.stop()` is awaited and the region's `duration` reflects the manifest's
     final `totalFrames / sampleRate`.
   - When `totalFrames === 0` at termination, no `AudioFileBox` / `AudioRegionBox` survives and
     `handle.session.abandon()` (or equivalent — to be added if missing) is called.
   - Loop areas have no effect: the recording runs through a loop without splitting takes.
2. Implement; run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/capture/RecordAudioLong.test.ts`

**Commit:** `feat(podcast-recording): long-recording counterpart to RecordAudio lifecycle`

---

### Task 7 — Branch `CaptureAudio` on `longRecording`

**Why:** this is the only edit to existing recording-orchestration code. It must preserve the existing musical
path untouched and add a sibling long-recording arm path.

**Files:**
- Modify: `packages/studio/core/src/capture/CaptureAudio.ts` — at the top of `prepareRecording()`, branch on
  `this.captureBox.longRecording.getValue()`. The classic branch is the existing body unchanged. The long
  branch opens a `GetUserMediaCaptureSource` with the same constraint set, arms a
  `LongRecordingService.startFromSource`, and stores the handle on `#preparedHandle`. `startRecording` mirrors:
  classic branch returns `RecordAudio.start(...)` as today; long branch returns `RecordAudioLong.start(...)`.
- Create: `packages/studio/core/src/capture/CaptureAudio.longRecordingBranch.test.ts`.

**TDD:**
1. Tests (use stubs for `audioWorklets`, `LongRecordingService`, and the capture source):
   - With `longRecording=false`: `audioWorklets.createRecording` is called and `LongRecordingService.startFromSource`
     is **not** called. The returned `Terminable` is the one produced by `RecordAudio.start`.
   - With `longRecording=true`: `audioWorklets.createRecording` is **not** called; `LongRecordingService.startFromSource`
     is called once with the expected `framesPerChunk`. The returned `Terminable` is the one produced by
     `RecordAudioLong.start`.
2. Implement; run tests; commit.

**Verify:** `npx vitest run packages/studio/core/src/capture`

**Commit:** `feat(podcast-recording): branch CaptureAudio on per-track longRecording flag`

---

### Task 8 — Invalidate restored long-recording loaders on project decode

**Why:** when a project bundle is decoded, the restored OPFS recordings need to push fresh loaders through the
sample manager. Otherwise stale `DefaultSampleLoader`s from previous sessions linger.

**Files:**
- Modify: `packages/studio/core/src/project/ProjectBundle.ts` (or wherever the decode-side bundle adapter
  invokes `LongRecordingArtifact.restore`). After restore, for each recordingId, call
  `sampleManager.invalidate(UUID.parse(recordingId))`.
- Locate: existing `ProjectBundleLongRecording.test.ts` already covers the round-trip; **extend** with a case
  that asserts a previously-cached `DefaultSampleLoader` is replaced by a `LongRecordingSampleLoader` after
  decode.

**TDD:**
1. Add the extra assertion to `ProjectBundleLongRecording.test.ts`.
2. Run; observe failure.
3. Implement `invalidate` call in `ProjectBundle.ts`.
4. Run; commit.

**Verify:** `npx vitest run packages/studio/core/src/project`

**Commit:** `feat(podcast-recording): invalidate sample loaders for restored long recordings`

---

### Task 9 — UI: per-track "Long Recording" toggle

**Why:** the user must be able to flip the flag from the track header (or capture-control panel) before arming.
Implementation is a JSX toggle bound to `captureAudioBox.longRecording` plus a warning chip driven by
`CaptureSourceMetadata.mismatches`.

**Files:**
- Locate (Explore agent first call): the existing per-track capture-control panel under
  `packages/app/studio/src/ui/` (likely under `mixer/`, `inspector/`, or `tracks/`).
- Modify: that file to add a labelled checkbox (or toggle button) bound to
  `captureAudioBox.longRecording.catchupAndSubscribe` / `.setValue`.
- Add: a small `LongRecordingWarningChip.tsx` (or inline JSX) that renders when the capture source's last
  observed `mismatches()` array is non-empty.

**TDD:** UI tests are out of scope; rely on manual + automated browser check (Task 13) for verification.

**Verify:** `npx tsc --noEmit` on `packages/app/studio`; manual: load Studio, open a project, confirm the toggle
appears on an audio track and flipping it updates the box.

**Commit:** `feat(podcast-recording): per-track Long Recording toggle in track UI`

---

### Task 10 — UI: Dashboard "Recoverable Recordings" panel

**Why:** the recovery surface from the spec.

**Files:**
- Locate: the existing Dashboard page (likely `packages/app/studio/src/ui/dashboard/...` or
  `packages/app/studio/src/ui/stats/...`).
- Create: `packages/app/studio/src/ui/dashboard/RecoverableRecordingsPanel.tsx`.
- Create: `packages/app/studio/src/ui/dashboard/RecoverableRecordingDetails.tsx` — per-chunk details modal.
- Modify: the dashboard page to include the panel.

**Behavior:**
- On mount, calls `LongRecordingArtifact.probeAll(Workers.Opfs)`.
- Filters to non-clean entries. Renders each as a row with the metadata listed in spec §6.2.
- `Resume into project` action: inserts a fresh `AudioFileBox` + `AudioRegionBox` referencing the recording at
  the current project's playback head (or beat 1 if no project is open: action is disabled).
- `Discard` action: confirmation dialog → `LongRecordingStorage.delete(...)` → reload the panel.
- `Inspect` opens the per-chunk details modal.

**Verify:** `npx tsc --noEmit` on `packages/app/studio`; manual smoke test from the spec §10.

**Commit:** `feat(podcast-recording): dashboard recoverable-recordings panel`

---

### Task 11 — UI: timeline region badge for non-clean long recordings

**Why:** the user needs to see at-a-glance which timeline regions are derived from a non-clean recording.

**Files:**
- Locate: the audio-region renderer in the arranger (per the Explore map: `packages/studio/core/src/ui/renderer/audio.ts`
  plus its caller in `packages/app/studio/src/ui/timeline/editors/audio/AudioEditorCanvas.tsx`).
- Modify: render an overlay chevron + tooltip when `AudioFileBoxAdapter.getOrCreateLoader() instanceof
  LongRecordingSampleLoader` AND the loader's manifest state is not "stopped" with `clean` recovery.

**Verify:** `npx tsc --noEmit`; manual: confirm the badge appears for a deliberately corrupted recording.

**Commit:** `feat(podcast-recording): badge timeline regions for non-clean long recordings`

---

### Task 12 — Browser harness extension

**Why:** the spec mandates browser-level verification with synthetic audio for the product flow + recovery.

**Files:**
- Modify: `packages/app/studio/src/podcast-recording-test/runner.ts` to accept `mode=product` / `recovery=1`
  query params and drive the real `Project` + `CaptureAudio` path (or fork a new
  `podcast-recording-product-runner.ts` if cleaner).
- Modify: `packages/app/studio/scripts/podcast-recording-browser-check.mjs` to add `--mode=product` and
  `--mode=recovery` switches.

**Verify:** `cd packages/app/studio && npm run test:podcast-recording-browser -- --mode=product` (or the
configured form).

**Commit:** `test(podcast-recording): product flow + recovery browser checks`

---

### Task 13 — Docs & release notes

**Files:**
- Create: `docs/podcast-recording/product-integration.md` — closure note mirroring the phase-N docs (what
  shipped, where, acceptance check against the spec, exact verification commands used).
- Update: `docs/podcast-recording/README.md` to reference the new closure note.
- Update: `plans/podcast-recording.md` — under "Immediate Next Step", flip from "spec is the active target" to
  "spec is implemented; future work tracked under … (e.g. chunked-streaming export, multichannel re-evaluation)".
- Update: project-level release notes (locate `CHANGELOG.md` / `RELEASES.md` / equivalent and add an entry).

**Verify:** human review.

**Commit:** `docs(podcast-recording): close product-integration slice`

---

## Verification Matrix

After all tasks complete, the following commands must pass (exact paths to be confirmed against the workspace's
package scripts; placeholders shown):

| Command | Coverage |
| --- | --- |
| `npx tsc --noEmit -p packages/studio/core` | Type check core. |
| `npx tsc --noEmit -p packages/studio/adapters` | Type check adapters. |
| `npx tsc --noEmit -p packages/app/studio` | Type check studio app. |
| `npx vitest run packages/studio/core/src/recording` | Recording-module units (existing + new). |
| `npx vitest run packages/studio/core/src/samples` | SampleLoader units + new fallback. |
| `npx vitest run packages/studio/core/src/capture` | Capture/RecordAudioLong units + branch. |
| `npx vitest run packages/studio/core/src/project` | ProjectBundle decode invalidates. |
| `cd packages/app/studio && npm run test:podcast-recording-browser` | Foundation Phase 1–3 browser check. |
| `cd packages/app/studio && npm run test:podcast-recording-browser -- --mode=product` | Product flow browser check. |
| `cd packages/app/studio && npm run test:podcast-recording-browser -- --mode=recovery` | Recovery browser check. |

Per AGENTS.md, all type checks use `--noEmit`.

## Out-Of-Scope Reminders

- Streaming export. Documented memory cost stays.
- Multichannel (>2 ch). Capped at 2 in the toggle UI.
- Strict-48 kHz enforcement. Warning only.
- Native bridge / Phase 4. Stays deferred.

End of plan.
