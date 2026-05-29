# Podcast Recording — Product Integration (Closure)

Closure note for the spec at `docs/podcast-recording/product-integration-spec.md` and the implementation plan
at `docs/podcast-recording/product-integration-plan.md`. Builds on Phases 0–3 under the same folder.

## What Shipped

The smallest mono/stereo podcast-recording MVP is wired into the normal openDAW workflow without regressing
the musical-take path:

1. **Per-track `longRecording` flag** on `CaptureAudioBox` (field 12, default `false`). Toggleable from the
   audio-track header menu (next to "Force Mono"). The musical-take path is byte-for-byte unchanged when the
   flag is `false`.
2. **`CaptureAudio.prepareRecording / startRecording` branch** on the flag. When `true`, the existing
   getUserMedia audioChain is wrapped via `WrappingCaptureSource` and handed to
   `LongRecordingService.startFromSource`; the handle is then driven by `RecordAudioLong.start` instead of
   the classic `RecordAudio.start`. Monitoring still works through the existing audioChain.
3. **`RecordAudioLong`** mirrors `RecordAudio.start` but creates the `AudioFileBox` with the recording's UUID,
   sets `timeBase = TimeBase.Seconds` on the region (tempo-independence), and updates region duration /
   `endInSeconds` from the live `session.totalFrames`. No take/loop splitting on long-recording tracks (linear
   takes only — documented in the spec).
4. **OPFS guards in `CaptureAudio.prepareRecording`.** Before arming a long recording the long branch
   asserts `LongRecordingSession.assertOpfsSupported()` (hard reject + user-facing notifier if OPFS is missing)
   and requests `LongRecordingSession.requestPersistence()` (non-blocking confirmation if persistence is
   denied). The musical-take path is unaffected.
5. **`LongRecordingSampleLoader`** (under `packages/studio/core/src/samples/`) implements `SampleLoader`
   from `@opendaw/studio-adapters`. `peaks` resolves immediately from per-chunk overview bins via
   `LongRecordingPeaksAdapter` — **no chunk PCM read at construction**, no PCM allocation. PCM
   materialization is lazy: triggered only when a consumer calls `SampleLoader.requestData()` or the
   explicit `materializeAudioData()`. Subscribing alone does not materialize. Inspection-only callers
   (dashboard probe, the harness peak-only diagnostic) that just read `loader.peaks` never trigger
   materialization. Once materialization completes, state transitions to
   `"loaded"` only if `data` is populated; the contract every other openDAW consumer relies on
   (`state === "loaded"` implies `data.nonEmpty()`) holds. For non-clean recordings the loader
   transitions to `"error"` with the recovery classification as the reason instead of producing partial
   PCM — same guard as the manager fallback.
6. **`GlobalSampleLoaderManager` long-recording fallback (no-swap, recovery-guarded).** When
   `SampleStorage.load(uuid)` rejects and an optional `opfsProvider` is configured, the manager calls
   `classifyLongRecording(storage)` (which reads the manifest + chunk probes and runs
   `LongRecordingRecovery.classify`). Behaviour by classification:
   - `recovery.overall === "clean" && manifest.state === "stopped"`: build `Peaks` from overview bins and
     call `loader.setPeaksReady(peaks, meta, () => materializeLongRecording(reference, access, recovery))`
     on the **original** `DefaultSampleLoader`. Peaks are available immediately so the timeline waveform
     paints without reading PCM; the full `AudioData` is **materialized lazily** — only when a consumer
     calls `SampleLoader.requestData()` (the playback/export path), never on mere `peaks`/`data` access or
     a repaint `subscribe(...)`. This matches the `LongRecordingSampleLoader` contract. The materialized
     take is **not** added to the manager's shared cross-loader `#cache` (so a fresh `getOrCreate` re-reads
     the cheap overview rather than handing out a retained multi-hour take); the loader itself retains its
     `AudioData` for the `SampleLoader` "loaded implies data" contract until it is invalidated/dropped via
     ref-counting. No swap, no `"error: superseded by long-recording"`, no second `getOrCreate` required.
   - non-clean (recoverable / corrupt / failed / active / abandoned): `loader.setError(...)` with the
     recovery classification as the reason. No `AudioData` is produced; the renderer/engine cannot
     silently play zero-padded audio. The dashboard "Recoverable Recordings" panel surfaces the same
     recordings for explicit Inspect / Discard.

   `materializeLongRecording(reference, access, recovery)` itself enforces the same guard
   (`recovery.overall === "clean"`) and writes each chunk at the manifest's **declared** frame offset
   (`recovery.manifest.chunks[i].frames`), so a chunk that decodes to fewer frames than declared cannot
   silently shift later chunks earlier or zero-pad the tail; it panics instead. Materialization is the
   documented one-time memory cost the MVP accepts; it never runs during record, stop, or finalize —
   only on the first play/export of a finalized clean recording. Configured in `boot.ts` via
   `opfsProvider: () => Workers.Opfs`.
7. **`RecordAudioLong.start` calls `project.trackUserCreatedSample(uuid)` and `editing.mark()`** on the
   `handle.stop()` `.then(...)` continuation, mirroring `RecordAudio.onSaved`. The project is therefore
   flagged as modified after a successful long recording and the user-created-sample tracking is
   consistent across the two paths.
8. **Project bundle decode invalidate** — after `LongRecordingBundleAdapter.restoreFromFolder` restores
   recordings to OPFS, `env.sampleManager.invalidate(...)` is called for each restored recording id, so the
   reopened project picks up fresh long-recording loaders that resolve through the fallback materialization
   above.
9. **Studio Dashboard "Recoverable Recordings" panel** — lists non-clean recordings via
   `LongRecordingArtifact.probeAll(...)` with per-row Inspect (per-chunk detail modal) and Discard
   (`LongRecordingStorage.delete`). "Resume into project" is a documented follow-up (see §"Deferred follow-ups").
10. **Browser harness extensions.** Two modes ship behind
    `npm run test:podcast-recording-browser`:
    - `record` (default): drives `LongRecordingService.startFromSource` end-to-end with a synthetic source,
      then asserts the loader contract: `LongRecordingSampleLoader.peaks` immediate,
      `materializeAudioData` produces `AudioData`, and `GlobalSampleLoaderManager.getOrCreate(uuid)`
      transitions the **same** loader instance to `"loaded"` with `data.nonEmpty()` and `peaks.nonEmpty()`.
      It also restores the artifact under a fresh recording id and re-verifies the loader contract there.
    - `--mode=product`: drives the **actual openDAW workflow** end-to-end. Constructs a real `Project`
      with a full `ProjectEnv` (real `SampleService`, `GlobalSampleLoaderManager` configured with
      `opfsProvider`, real `OfflineEngineRenderer` registration), creates an audio capture unit with
      `longRecording=true` on its `CaptureAudioBox`, attaches a Tape instrument, arms the capture (real
      `getUserMedia` against Chrome's fake media stream), boots a real `EngineWorklet` via
      `project.startAudioWorklet()`, awaits `worklet.isReady()`, then runs `Recording.start(project,
      false)` — which calls the production `CaptureAudio.prepareRecording` long branch and
      `RecordAudioLong.start`. It waits for `engine.isRecording=true` to actually fire, records, calls
      `project.engine.stopRecording()`, and then asserts:
      - the recording artifact is on disk with `recovery.overall === "clean"`,
      - `project.trackUserCreatedSample` was called with the recording's UUID,
      - an `AudioFileBox` and `AudioRegionBox` for the recording were created by `RecordAudioLong`,
      - `project.sampleManager.getOrCreate(uuid)` resolves to `"loaded"` with `data` and `peaks` populated
        (the same loader instance the engine and renderer use),
      - **playback:** `project.engine.play()` advances `engine.position`,
      - **export:** `OfflineEngineRenderer.create(project.copy(), Option.None, 48000).step(48000)` returns
        a non-silent buffer (`exportNonZeroSamples > 0`),
      - **real save/reopen:** `ProjectBundle.encode(profile, ...)` → `ProjectBundle.decode(env, bytes)`
        into a fresh `ProjectEnv` produces a project whose `AudioFileBox` for the recording survives
        **and whose `AudioRegionBox.file` pointer actually targets that file box** (not just "some
        region exists"), and whose `sampleManager.getOrCreate(uuid)` resolves to `"loaded"` with
        `data` and `peaks` populated.

      The check fails if any of those don't hold. The harness ALSO fails on any uncaught page-level
      exception observed during the run (via Playwright's `page.on("pageerror", ...)`), so a runtime
      bug masked behind an otherwise-passing summary cannot slip through.

## Files Changed Or Added

```
packages/studio/forge-boxes/src/schema/std/CaptureBox.ts        modify   (new field 12 long-recording)
packages/studio/core/src/recording/LongRecordingPeaksAdapter.ts new      (overview bins → Peaks)
packages/studio/core/src/recording/LongRecordingPeaksAdapter.test.ts new
packages/studio/core/src/recording/LongRecordingArtifact.ts     modify   (probeAll + ProbeEntry export)
packages/studio/core/src/recording/LongRecordingArtifact.test.ts modify  (probeAll cases)
packages/studio/core/src/recording/index.ts                     modify   (re-export PeaksAdapter)
packages/studio/core/src/samples/LongRecordingSampleLoader.ts   new      (SampleLoader adapter; loaded => data)
packages/studio/core/src/samples/LongRecordingSampleLoader.test.ts new
packages/studio/core/src/samples/GlobalSampleLoaderManager.ts   modify   (opfsProvider + no-swap fallback +
                                                                          shared materializeLongRecording)
packages/studio/core/src/samples/GlobalSampleLoaderManager.longRecordingFallback.test.ts new
packages/studio/core/src/samples/index.ts                       modify   (re-export LongRecordingSampleLoader)
packages/studio/core/src/capture-source/WrappingCaptureSource.ts new
packages/studio/core/src/capture-source/index.ts                modify   (re-export WrappingCaptureSource)
packages/studio/core/src/capture/RecordAudioLong.ts             new      (+ trackUserCreatedSample, editing.mark)
packages/studio/core/src/capture/CaptureAudio.ts                modify   (branch on longRecording, OPFS guards)
packages/studio/core/src/project/ProjectBundle.ts               modify   (invalidate restored loaders)
packages/studio/core/src/project/ProjectBundleLongRecording.test.ts modify (assert invalidate call)

packages/app/studio/src/boot.ts                                 modify   (opfsProvider wired)
packages/app/studio/src/ui/timeline/tracks/audio-unit/headers/TrackHeaderMenu.ts modify
                                                                          ("Long Recording" toggle item)
packages/app/studio/src/ui/dashboard/RecoverableRecordingsPanel.tsx new
packages/app/studio/src/ui/dashboard/RecoverableRecordingsPanel.sass new
packages/app/studio/src/ui/dashboard/Dashboard.tsx              modify   (mount panel)
packages/app/studio/src/podcast-recording-test/runner.ts        modify   (loader contract assertions +
                                                                          artifact-restore reopen check)
packages/app/studio/src/podcast-recording-test/productPathRunner.ts new  (real Project + Recording.start +
                                                                          full consumer chain assertions)
packages/app/studio/src/podcast-recording-test/main.ts          modify   (--mode=product wiring)
packages/app/studio/scripts/podcast-recording-browser-check.mjs modify   (--mode=product CLI flag)
```

The auto-generated `packages/studio/boxes/src/CaptureAudioBox.ts` is regenerated from the schema change but
is gitignored per repo convention.

## Acceptance Matrix (Goal "Done When")

| Criterion | Status / Where verified |
| --- | --- |
| Long-recording loaders satisfy the SampleLoader contract for existing consumers (EngineWorklet, OfflineEngineRenderer, AudioFileBoxAdapter.audioData, GlobalSampleLoaderManager.getAudioData expect `loaded => data.nonEmpty()`) | `LongRecordingSampleLoader.create()` reads only overview bins and leaves `data` empty until a subscriber or explicit `materializeAudioData()` request triggers materialization; it transitions to `"loaded"` only once `data` is `Some`. The manager fallback populates the original `DefaultSampleLoader` via `setPeaksReady(peaks, meta, provideAudio)` — peaks immediate, the full `AudioData` materialized lazily only when a consumer calls `requestData()` (subscribing for repaint does not). Locked by `LongRecordingSampleLoader.test.ts` ("construction reads only the overview (no chunk PCM)", "uuid matches…progress -> loaded once chunks materialize"; "subscribe replays the current state…once loaded") and `GlobalSampleLoaderManager.longRecordingFallback.test.ts` ("populates the original SampleLoader with materialized audio + overview peaks"). Browser-verified: product-path test asserts `consumerLoaderState=loaded`, `consumerLoaderHasData=true`. |
| Fallback resolves without a second `getOrCreate` after error | `tryAttachLongRecording` no longer swaps loaders; the original loader receives `setPeaksReady` (lazy) and stays the same instance. `GlobalSampleLoaderManager.longRecordingFallback.test.ts` asserts `events.some(state.type === "error") === false` and `manager.getOrCreate(uuid)` returns the original loader. Browser-verified: `loaderFallbackSameInstance=true`. |
| Normal playback of a recorded long-recording region works in the openDAW engine | Real `EngineWorklet` driven via `Recording.start(project, false)` + `project.engine.play()` in the product-path browser test; `engine.isRecording=true` and `engine.position` advancing are both observed (worklet → facade), `RecordAudioLong` creates the box graph, `project.sampleManager.getOrCreate(recordingUuid)` reaches `loaded` with non-empty `data` that the engine's `fetchAudio` consumes. Browser-verified: `playbackPositionAdvanced=true`. |
| Export/mixdown works for the MVP via a documented one-time materialization | `materializeLongRecording(reference, access, recovery)` is shared between the manager fallback and `LongRecordingSampleLoader`; it runs only on first load (not during record or stop/finalize) and refuses non-clean recordings. The product-path browser test actually invokes `OfflineEngineRenderer.create(project.copy(), Option.None, 48000)` and asserts the rendered buffer contains non-zero samples (`exportNonZeroSamples > 0`). |
| `CaptureAudio`'s long branch checks OPFS availability and requests persistent storage before arming | `LongRecordingSession.assertOpfsSupported()` + `RuntimeNotifier.info` on failure; `LongRecordingSession.requestPersistence()` + `RuntimeNotifier.approve` confirmation on non-persistent storage. Browser-verified: `opfsCheckPassed=true`. |
| Successful stop/finalize marks the project changed and tracks the recording as user-created | `RecordAudioLong` calls `project.trackUserCreatedSample(recordingUuid)` and `editing.mark()` on the `handle.stop().then(...)` callback. Browser-verified: `trackUserCreatedSampleObserved=true` with matching UUID. |
| Project save/reopen restores the long-recording artifact and the reopened region loads, shows waveform, plays | `ProjectBundle.encode/decode` (Phase 2) + `sampleManager.invalidate(...)` per restored recording id (using `removeByKeyIfExist` to avoid panicking on stale pending-load entries — see Phase 2 review fix); verified by `ProjectBundleLongRecording.test.ts`. Browser-verified end-to-end: the product-path test runs **real** `ProjectBundle.encode` → `ProjectBundle.decode` into a fresh `ProjectEnv` and asserts `bundleRoundTripRegionAttached=true` (which now means **the reopened `AudioRegionBox.file` pointer actually targets the recording's `AudioFileBox`**, not just "some region exists in the box graph"), plus `bundleRoundTripLoaderState=loaded`, `bundleRoundTripLoaderHasData=true`, `bundleRoundTripLoaderHasPeaks=true`. The browser harness also fails on any uncaught page-level exception observed during the run. |
| Interrupted/abandoned/corrupt/truncated/missing-chunk recordings surfaced explicitly; not silently zero-padded or misrepresented | Dashboard "Recoverable Recordings" panel uses `LongRecordingArtifact.probeAll` + `LongRecordingRecovery.classify`. The manager fallback and `LongRecordingSampleLoader` both classify recovery before materializing and transition the loader to `state="error"` with the recovery classification as the reason when overall is not `"clean"` and manifest state is not `"stopped"`. `materializeLongRecording` itself panics on non-clean inputs and writes using manifest-declared per-chunk frames so a truncated chunk cannot silently shift later chunks earlier or zero-pad the tail. Verified by `LongRecordingSampleLoader.test.ts` ("refuses to materialize a non-clean recording (truncated chunk)", "refuses to materialize an active (not yet stopped) recording") and `GlobalSampleLoaderManager.longRecordingFallback.test.ts` ("transitions to error (not loaded) for a non-clean recording", "transitions to error for an active (not stopped) recording"). |
| Ordinary musical recording remains unchanged | `RecordAudio.start`, `RecordingWorklet`, `SampleService.importRecording`, `SampleStorage` are all unchanged. The full vitest suite stays green, including all existing musical-path coverage. The record-mode browser check still reports `overall=clean`. |
| Tempo independence | `RecordAudioLong` sets `timeBase = TimeBase.Seconds`; Phase 2's `LongRecordingTempoIndependence.test.ts` continues to lock this. |
| Browser capture remains the default; Phase 4 deferred | `WrappingCaptureSource` wraps the existing `getUserMedia` audioChain with `getUserMedia` metadata; no native bridge work. |

## Verification — Exact Commands Run

| Command | Result |
| --- | --- |
| `cd packages/studio/forge-boxes && npm run build` | Schema regenerated; `CaptureAudioBox.longRecording` (BooleanField) appears in `packages/studio/boxes/src/CaptureAudioBox.ts` |
| `cd packages/studio/boxes && npm run build` | dist/ regenerated |
| `cd packages/studio/core && npx tsc --noEmit` | Clean |
| `cd packages/studio/core && npx vitest run` | 24 test files, 263 tests, all pass (includes `LongRecordingPeaksAdapter.test.ts`, `LongRecordingArtifact.probeAll` additions, `LongRecordingSampleLoader.test.ts`, `GlobalSampleLoaderManager.longRecordingFallback.test.ts` incl. the lazy-materialization case, `LongRecordingSession.test.ts` incl. the backpressure-cap case, `ProjectBundleLongRecording.test.ts` extension) |
| `cd packages/studio/core && npm run build` | dist/ regenerated for downstream consumers |
| `cd packages/app/studio && npx tsc --noEmit` | Clean |
| `cd packages/app/studio && npm run test:podcast-recording-browser -- --skip-build` | `pass` with `pageErrors=[]` — `overall=clean`, loader contract verified: `loaderFallbackTerminal=loaded`, `loaderFallbackData=true`, `loaderFallbackPeaks=true`, `loaderFallbackSameInstance=true`, `loaderFallbackFrames>0`, `reloadedLoaderData=true`, `reloadedLoaderPeaks=true` |
| `cd packages/app/studio && npm run test:podcast-recording-browser -- --rebuild --mode=product` | `pass` with `pageErrors=[]` — full product path verified: real `Project` + `Recording.start` + `CaptureAudio.prepareRecording` long branch + `RecordAudioLong.start` + real `EngineWorklet` with `engine.isRecording=true` actually firing. Asserts `artifactClassification=clean`, `trackUserCreatedSampleObserved=true`, `consumerLoaderState=loaded`, `consumerLoaderHasData=true`, `consumerLoaderHasPeaks=true`, `consumerLoaderFrames>0`, `playbackPositionAdvanced=true` (real `engine.play()` drives the timeline), `exportNonZeroSamples>0` (`OfflineEngineRenderer.step(...)` against a `project.copy()` produces non-silent mixdown), `regionsTargetingRecording=1`, and `bundleRoundTripRegionAttached=true` with `bundleRoundTripLoaderState=loaded` + data + peaks after **real** `ProjectBundle.encode` + `ProjectBundle.decode` into a fresh `ProjectEnv`. |

## Test Strategy Notes

- **Hardware-independent vitest** covers the product-critical units: peaks-from-overview, loader peaks/data
  semantics (incl. the `loaded => data` contract), sample-manager fallback semantics, manifest probeAll,
  project-decode invalidate.
- **Browser-level record-mode check** verifies `LongRecordingSampleLoader` and the
  `GlobalSampleLoaderManager` long-recording fallback against a real `AudioContext` + OPFS environment
  using a synthetic capture source.
- **Browser-level product-path check** drives the actual openDAW workflow against the same harness binary:
  real `Project` + `ProjectEnv`, real `CaptureAudio` + `Recording.start` + `EngineWorklet`. It is the
  authoritative product-path proof that record → stop → region → load → save/reopen works for a
  long-recording sample. The check fails if the artifact isn't `clean`, if `RecordAudioLong` doesn't track
  the user-created sample, if no `AudioFileBox` is created, or if the production sample manager doesn't
  resolve to `loaded` with `data.nonEmpty()` (the exact contract `EngineWorklet.fetchAudio` and
  `OfflineEngineRenderer` depend on).
- **Manual smoke checks** (per `product-integration-spec.md` §10) cover the user-visible Studio UI
  surfaces (per-track toggle, dashboard panel). Optional/manual; no physical microphones, ZOOM L-12, or
  virtual loopback devices required.

## Post-Review Hardening

Changes made after the multi-agent + codex design review (this is the current shipped behaviour; it
overrides any earlier description in this file or the superseded spec/plan):

- **Lazy production loader (no eager materialization).** The manager fallback now uses
  `DefaultSampleLoader.setPeaksReady(...)` instead of eagerly calling `materializeLongRecording` +
  `setLoaded`. Overview peaks are attached immediately (waveform paints) and the full `AudioData` is
  materialized only when a consumer calls the new `SampleLoader.requestData()` (the playback/export
  demand path: `EngineWorklet.fetchAudio`, `OfflineEngineRenderer.fetchAudio`,
  `AudioFileBoxAdapter.audioData`, `GlobalSampleLoaderManager.getAudioData`). **Crucially, subscribing
  does not materialize** — timeline adapters (`AudioRegionBoxAdapter`/`AudioClipBoxAdapter`) subscribe
  to the loader purely to dispatch repaints, so opening a project with a long-recording region no longer
  pulls the whole take into memory. The materialized take is not added to the manager's shared cache
  (the loader retains it for the "loaded implies data" contract until invalidated). Locked by
  `GlobalSampleLoaderManager.longRecordingFallback.test.ts` ("exposes overview peaks immediately but
  defers audio materialization until requestData()").
- **Bounded write backlog (backpressure).** `LongRecordingSession` tracks pending (queued-but-unwritten)
  chunk bytes and exposes `pendingBytes`/`pendingChunks` on `LongRecordingProgress`. If the backlog
  exceeds `maxPendingBytes` (default `LongRecordingSession.DEFAULT_MAX_PENDING_BYTES`, 128 MiB) — i.e.
  OPFS cannot keep up with capture — the session fails **deterministically**, leaving everything written
  so far recoverable, instead of growing without bound and risking a tab OOM. Overview-write failure is
  documented as intentionally non-fatal (waveform-fidelity only; the PCM chunk is persisted and recovery
  probes the `.pcm` files). Locked by `LongRecordingSession.test.ts` ("fails deterministically when the
  write backlog exceeds maxPendingBytes").
- **Region/file duration alignment.** `RecordAudioLong` now derives the region `duration` from the
  captured `waveformOffset` (`duration = fullDuration − waveformOffset`), maintaining the same
  `waveformOffset + duration === file.endInSeconds` invariant as the classic `RecordAudio` path. The
  previous code subtracted only the head frames and not `outputLatency`, so on browsers with non-zero
  `outputLatency` the region could extend past the file end.
- **Capture-source channel mapping descoped + dead code removed.** Production recording captures
  mono/stereo through `WrappingCaptureSource` over the existing `recordGainNode`; the `CaptureChannelMap`
  routing in `GetUserMediaCaptureSource`/`SyntheticCaptureSource` is a **library/harness capability only**
  and is not wired into the production recorder (multichannel stays Phase 4). The unused continuity/error
  `Notifier` infrastructure (`subscribeContinuity`/`subscribeErrors`/`CaptureContinuityReport`) that was
  never emitted has been removed from `CaptureSource` and all implementations; the duplicated
  `routeThroughMap` helper was consolidated into `CaptureChannelMap.route`; the per-track metadata
  derivation shared between `CaptureAudio` and `GetUserMediaCaptureSource` now lives in
  `CaptureSourceMetadata.fromMediaStreamTrack`; and `CaptureAudio` surfaces `CaptureSourceMetadata.mismatches`
  (AGC / resample / channel-count drift) via `console.warn` on the production path.
- **lib-std type conventions.** `classifyLongRecording` returns `Option<LongRecordingClassification>` (was
  `… | undefined`); `GlobalSampleLoaderManager.#opfsProvider` is `Optional<…>`;
  `LongRecordingPeaksAdapter.nearest` returns `Nullable<Peaks.Stage>`.

## Deferred Follow-Ups

The spec called these out and they remain follow-ups for the next slice:

- **Timeline region badge** for non-clean long-recording regions. The dashboard panel handles the orphan
  case; an in-project region that references a non-clean recording currently resolves its loader to
  `state="error"` (the fallback refuses to attach peaks for non-clean artifacts), so it renders as a
  broken/empty region rather than a waveform, and no explanatory badge is rendered yet.
- **"Resume into project" action in the Dashboard panel.** Inspect + Discard ship in this slice. A "Resume"
  action that inserts a fresh `AudioFileBox` + `AudioRegionBox` against the open project is a small follow-up
  and is mentioned in the panel section of `product-integration-spec.md`.
- **Streaming export** (no AudioData materialization). MVP documents the one-time materialization cost on
  first play/export. A chunked-streaming export pipe is a future slice.
- **Multichannel (>2 ch) capture**. The toggle UI keeps the existing `requestChannels` cap at mono/stereo.
  Phase 4 trigger conditions are unchanged.
- **Per-loader detection helper**. Consumers that want to distinguish a long-recording-backed
  `DefaultSampleLoader` from an ordinary sample loader can read the manifest via
  `LongRecordingArtifact.isLongRecording(opfs, recordingId)`; surfacing this on the loader itself is a
  follow-up.

## Plan + Spec References

- Spec: `docs/podcast-recording/product-integration-spec.md`
- Plan: `docs/podcast-recording/product-integration-plan.md`
- Issue: <https://github.com/andremichelle/openDAW/issues/245>
