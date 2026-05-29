# Podcast Recording — Product-Integration Spec (MVP)

> ⚠️ **SUPERSEDED — historical design doc.** This spec describes an earlier design and is kept for
> context only. It does **not** match what shipped. Notably it specifies a *swap*-based loader that
> `#loaders.replace(...)` and `setError`s the previous loader; the implementation instead keeps the
> original `DefaultSampleLoader` and uses a **no-swap, lazy** `setPeaksReady` fallback (overview peaks
> immediately, `AudioData` materialized on demand). It also describes UI (channel mapping, mismatch
> warnings, "Resume into project", timeline badge) that was descoped. **For the shipped design and the
> authoritative verification commands, read `product-integration.md`.**

Source plan: `plans/podcast-recording.md` (issue 245). Foundation: `docs/podcast-recording/baseline.md`,
`phase-1-opfs.md`, `phase-2-media.md`, `phase-3-capture-source.md`.

This spec resolves the open questions in `plans/podcast-recording.md` and locks the smallest usable mono/stereo
podcast-recording MVP in the normal openDAW workflow. Browser `getUserMedia` is the only capture backend.
Phase 4 (native/multichannel) stays deferred.

## 1. Goal

A user can:

1. Open or create a project, pick an input device on an audio track, and enable a per-track **"Long Recording"**
   toggle (default off).
2. Arm the track and hit record. Audio is captured incrementally to OPFS through the existing
   `LongRecordingService.startFromSource`; an `AudioRegionBox` + `AudioFileBox` are created at record-start so the
   timeline shows a live region with progressive waveform overview.
3. Stop. The session finalizes the manifest. **No full-take audio is assembled in RAM during stop/finalize.**
4. See the region with a waveform rendered from the persisted per-chunk overview, play it back, and save the
   project. Reopen the project and the recording is still attached, plays, renders, and exports.
5. After a tab reload or crash, find any interrupted recordings on the **Studio Dashboard "Recoverable Recordings"
   panel** (with explicit `recoverable / corrupt / failed / abandoned` classification) and act on them.
6. Export the project to WAV. Long recordings are materialized once per export through the standard offline
   render path (documented memory cost, called out in release notes).

Tempo independence holds: a recorded long region has `timeBase = TimeBase.Seconds`, so BPM changes do not move,
stretch, or reinterpret the recording.

## 2. Non-Goals For This MVP

These are out of scope and explicitly deferred:

- Streamed/chunked engine playback (engine still gets a full `AudioData` for play/export — chunked playback is a
  separate later slice).
- Multichannel (>2 ch) capture; the `CaptureAudio` clamp to mono/stereo stays in the legacy capture and the
  long-recording path also caps `requestedChannels` at 2 for the MVP.
- Strict-podcast-mode 48 kHz enforcement (we surface a warning via existing `CaptureSourceMetadata.mismatches`,
  but accept any rate the AudioContext reports).
- Native/multichannel host bridge (Phase 4 — still deferred per `phase-4-evaluation.md`).
- Live Rooms / WebRTC / progressive upload / podcast templates / soundboard / chapter markers / Auphonic / LUFS
  presets (all listed under `plans/podcast-recording.md` §"Later Podcast Workflow Ideas").
- Re-using long-recording artifacts as ordinary samples through the `SampleBrowser`. The dashboard panel offers
  "Import as sample" only as a recovery action, not as a general workflow.
- Mid-take rollover from the classic musical path to the long path (the flag is read at arm time only).

## 3. Resolution Of Open Questions From `plans/podcast-recording.md`

Reproduced verbatim, with the MVP resolution:

| Open question | MVP resolution |
| --- | --- |
| Smallest normal openDAW workflow that counts as podcast recording | §1 above (open → toggle → arm → record → stop → region → save → reopen → play → recover → export). |
| Dedicated podcast mode vs per-track vs duration threshold | **Per-track `CaptureAudioBox.longRecording` boolean flag.** Default false. Confirmed with user. |
| How `CaptureAudio` / `RecordAudio` integrate with `CaptureSource` / `LongRecordingService` without breaking ordinary musical takes | New `RecordAudioLong` namespace mirroring `RecordAudio.start`; `CaptureAudio.prepareRecording / startRecording` branch on the flag at arm time. Musical-take code path is left **byte-for-byte unchanged**. |
| Renderer/engine consume `LongRecordingMediaReference` directly or via adapter | **Adapter.** A new `LongRecordingSampleLoader` (implements `SampleLoader` from `@opendaw/studio-adapters`) is `record()`ed into `GlobalSampleLoaderManager`. It produces `Peaks` from per-chunk overview bins on first access (no full audio) and lazily materializes `AudioData` only when the engine actually needs to play or export. Confirmed with user. |
| How interrupted recordings surface after reload | **Studio Dashboard "Recoverable Recordings" panel** plus a region-level "non-clean" badge on the timeline. No blocking modal. Confirmed with user. |
| Export path acceptable for MVP | Existing `OfflineEngineRenderer` is reused. The first export call on a long region triggers the adapter's `materializeAudioData()`. Memory cost is documented; future chunked-streaming export is out of scope. |
| Strict podcast mode 48 kHz | Not enforced. `CaptureSourceMetadata.mismatches` is surfaced in the toggle UI as a warning; the user can still record at any rate the browser exposes. |
| Multichannel browser support | Out of scope for MVP. `requestedChannels` capped at 2. Phase 4 trigger conditions unchanged. |
| Live Rooms relationship | None. Out of scope. |

## 4. User Flows

### 4.1 Happy Path — Mono/Stereo Podcast Recording

```
Open project → Pick mic on track (existing CaptureAudio dropdown)
            → Tick "Long Recording" on the track header
            → Arm
            → Hit record button
              · LongRecordingService.startFromSource(...) arms a session
              · An AudioFileBox + AudioRegionBox with timeBase=Seconds are created
              · The session writes Float32 chunks + per-chunk overview to OPFS
              · The region's duration extends live as the manifest grows
              · Waveform draws from the per-chunk overview as chunks finalize
            → Hit stop
              · session.stop() flushes the residual chunk, writes manifest state="stopped"
              · No full AudioData is built
              · The LongRecordingSampleLoader stays registered with the
                sample manager; .peaks resolves immediately from the overview
            → Save project (.odbundle)
              · ProjectBundle.encode bundles recordings/<uuid>/ alongside AudioFileBox
            → Close + reopen project
              · ProjectBundle.decode restores chunks + manifest to OPFS at recordings/v1/<uuid>/
              · The AudioFileBox is rehydrated
              · GlobalSampleLoaderManager.getOrCreate detects the long-recording artifact and
                returns a fresh LongRecordingSampleLoader
              · The waveform paints from the overview
            → Play
              · Engine fetchAudio(uuid) → loader.subscribe waits for "loaded"
              · The loader materializes AudioData on demand (one read of all chunks),
                caches it, and notifies "loaded"
              · Playback proceeds with the standard region playback path
            → Export to WAV
              · OfflineEngineRenderer.create → engine reads samples via the same loader
              · First read triggers the same lazy materialization; subsequent regions
                that share the same uuid hit the cache
```

### 4.2 Recovery Flow After Reload

```
Reload tab mid-recording (or crash, or tab close)
            → manifest.json on OPFS still has state="active" with the last
              chunk index that completed
            → On next app boot, the Dashboard scans recordings/v1/* via
              LongRecordingArtifact.collect + LongRecordingRecovery.classify
            → Each non-clean entry appears in the "Recoverable Recordings"
              panel with: recordingId, createdAt, sampleRate, numberOfChannels,
              totalFrames, recovery overall ("recoverable"|"corrupt"|"failed"),
              recoverableFrames count, and per-chunk status summary.
            → Per-row actions:
                - "Resume into current project" (only if a project is open):
                    inserts a new AudioFileBox + AudioRegionBox referencing
                    the recording, with the manifest state surfaced as a
                    region badge.
                - "Discard":
                    LongRecordingStorage.delete + manifest gone.
                - "Inspect": opens a read-only details modal listing per-chunk
                    status (`clean | missing | truncated | corrupt | extra`).
            → If the recording is referenced by an already-opened project but
              is non-clean, the timeline region renders a yellow badge over
              the waveform with the same classification text. Clicking the
              badge surfaces the same per-chunk details modal.
```

If a project references a recording whose OPFS data is gone entirely (manifest missing), the region renders a
striped "Missing" placeholder; the dashboard panel shows nothing for that recording (there is nothing to recover).
The region is not deleted automatically.

### 4.3 Error / Edge Surfaces (Explicit, Not Silent)

| Situation | Behavior |
| --- | --- |
| OPFS unavailable in the browser | `LongRecordingService.startFromSource` fails before recording begins; the track flag UI shows the failure and offers to disable the toggle for that track. The classic musical-take path remains available. |
| `navigator.storage.persist()` returns false | Recording proceeds; a non-blocking warning is logged and shown in the track header (data may be evicted under storage pressure). |
| `getUserMedia` denied or device gone | Same surface as the existing musical path — recording aborts before the session arms. No long-recording artifact is created. |
| Sample-rate / channel-count mismatch reported by `CaptureSourceMetadata.mismatches` | Surfaced as inline warning text in the track header before record; recording still proceeds. |
| Engine playback requested before lazy materialization completes | The loader's `state` stays `"progress"`; the region renders the overview-derived peaks but the engine waits for `"loaded"` like any other sample. |
| Lazy materialization fails (e.g. chunk truncated mid-export) | Loader transitions to `"error"`; engine treats the sample as unplayable and skips that region in the offline render, exactly like an `error` state on a `DefaultSampleLoader`. |
| Two-tab race writing the same recording id | Out of scope. The MVP assumes a single tab per project. A duplicate UUID would be a manifest collision and would surface as `recovery="corrupt"`. |

## 5. Architecture

### 5.1 Where The Code Lives

```
packages/studio/forge-boxes/src/schema/std/CaptureBox.ts
  └─ extend CaptureAudioBox: add field 12 "long-recording" boolean, value: false
  (regenerates packages/studio/boxes/src/CaptureAudioBox.ts)

packages/studio/core/src/capture/
  ├─ CaptureAudio.ts                — branches at prepareRecording/startRecording
  └─ RecordAudioLong.ts (new)       — long-recording counterpart to RecordAudio
                                       creates AudioFileBox + AudioRegionBox with
                                       timeBase=Seconds, owns the LongRecordingHandle,
                                       and updates region.duration / fileBox.endInSeconds
                                       from session progress.

packages/studio/core/src/samples/
  ├─ GlobalSampleLoaderManager.ts   — fallback path: if SampleStorage.load rejects
  │                                    AND a long-recording manifest exists for the
  │                                    uuid, attach a LongRecordingSampleLoader
  │                                    instead of failing with "error".
  └─ LongRecordingSampleLoader.ts (new)
       Implements SampleLoader. Exposes `peaks` derived from overview bins, lazy
       `data` materialized from chunks on first read, `state` advancing through
       `"progress" → "loaded" | "error"`.

packages/studio/core/src/recording/
  ├─ LongRecordingPeaksAdapter.ts (new)
  │     LongRecordingOverviewBin[] → Peaks (a Peaks implementation backed by
  │     the existing per-chunk overview shape). Hardware-independent.
  └─ LongRecordingArtifact.ts       — add probeAll(opfs) used by the dashboard
                                       to enumerate non-clean recordings on boot.

packages/app/studio/src/ui/
  ├─ track/CaptureAudioControls.tsx (or equivalent)
  │     The "Long Recording" toggle + warning chip wired to
  │     captureAudioBox.longRecording.
  ├─ dashboard/RecoverableRecordingsPanel.tsx (new)
  │     Dashboard panel listing non-clean recordings with actions.
  ├─ dashboard/RecoverableRecordingDetails.tsx (new)
  │     Per-recording details modal (per-chunk status).
  └─ timeline/AudioRegionBadge.tsx (or equivalent)
        Renders the non-clean badge over a long-recording region whose
        loader state is not "loaded".

packages/studio/core/src/project/ProjectBundle.ts
  — unchanged. Phase 2 bundle adapter already covers encode/decode.
```

The musical-take recording path (`RecordAudio`, `RecordingWorklet`, `SampleService.importRecording`,
`SampleStorage.save`) is **untouched**. The branching point is in `CaptureAudio.prepareRecording /
startRecording`. The downstream renderer, engine, and export paths are also untouched — the only adapter is
`LongRecordingSampleLoader`, which conforms to the existing `SampleLoader` interface.

### 5.2 Per-Track Toggle Contract

`CaptureAudioBox.longRecording` is a boolean field defaulting to `false`.

- When `false` (default): `CaptureAudio.prepareRecording` calls `audioWorklets.createRecording(...)` and
  `RecordAudio.start(...)` exactly as today. **No behavior change for musical takes.**
- When `true`: `prepareRecording` opens a `GetUserMediaCaptureSource` (mirroring the existing constraint set —
  `echoCancellation/noiseSuppression/autoGainControl` all `false`, `channelCount: {ideal: requestChannels}`).
  `startRecording` calls `LongRecordingService.startFromSource(...)` and hands the handle to `RecordAudioLong.start`.

The flag is read at arm time. Toggling it mid-take has no effect on the in-flight recording.

### 5.3 `RecordAudioLong` Lifecycle

```ts
namespace RecordAudioLong {
  type Context = {
    handle: LongRecordingHandle
    sampleManager: SampleLoaderManager
    project: Project
    capture: CaptureAudio
    outputLatency: number
  }
  export const start = (context: Context): Terminable
}
```

Responsibilities, mirroring `RecordAudio.start`:

- Generate a `UUID` for the new `AudioFileBox` whose uuid **equals** `handle.session.recordingId`. This is the
  key that ties the project graph to the OPFS artifact and to `LongRecordingArtifact.isLongRecording`.
- Create the `AudioFileBox` at the moment `engine.isRecording` first goes true (same trigger condition as
  `RecordAudio`), using the same `Recording-<isoDate>` naming convention.
- Create the `AudioRegionBox` with `timeBase: TimeBase.Seconds`, hue `ColorCodes.forTrackType(TrackType.Audio)`,
  and the same `waveformOffset` computation used in `RecordAudio.start` (count-in + output latency + worklet
  head-start). The `LongRecordingService` is started before `prepareRecording` returns; its
  `captureSource.outputNode` is already connected, so the head-start formula uses
  `handle.session.totalFrames / handle.session.sampleRate` as the elapsed wall-clock.
- Subscribe to `handle.session.onProgress` (or equivalent — to be added to `LongRecordingSession` if not
  already exposed) and update `regionBox.duration`, `regionBox.loopDuration`, and `fileBox.endInSeconds` from
  the running `totalFrames` value. Updates go through `project.editing.modify(..., false)` to coalesce.
- On stop: `await handle.stop()`; the session writes the final manifest. No new `AudioFileBox` is created
  (unlike `RecordAudio.onSaved`, which swaps the file box). Set `regionBox.duration` /
  `fileBox.endInSeconds` to the final `totalFrames / sampleRate`, then `sampleManager.invalidate(uuid)` so
  the cached loader picks up the final manifest.
- Do **not** implement loop/take handling in the MVP. If the user hits record into a loop area on a
  long-recording track, the recording runs through the loop without splitting — explicitly documented as
  "long-recording tracks are linear takes; loop areas do not split takes." Takes settings on the recording
  preferences are ignored on long-recording tracks.
- On abort (no frames recorded): clean up the in-flight `AudioFileBox` / `AudioRegionBox` and call
  `LongRecordingStorage.delete(recordingId)` so an empty manifest does not leak into the dashboard.

### 5.4 `LongRecordingSampleLoader` Contract

```ts
class LongRecordingSampleLoader implements SampleLoader {
  // construction
  constructor(uuid: UUID.Bytes, reference: LongRecordingMediaReference, storage: LongRecordingStorage)

  // SampleLoader fields
  get data(): Option<AudioData>      // None until materialize()
  get peaks(): Option<Peaks>         // Some immediately after constructor (built from overview)
  get uuid(): UUID.Bytes
  get state(): SampleLoaderState     // "progress" until peaks built; "loaded" once peaks available
                                     // a separate "materializing" sub-state is NOT introduced; we keep
                                     // SampleLoaderState shape unchanged. AudioData materialization is
                                     // an internal Promise; engine subscribers see "progress" → "loaded"
                                     // exactly like a DefaultSampleLoader.
  invalidate(): void                 // drops cached AudioData; forces re-read from chunks
  subscribe(observer): Subscription

  // Internal
  materializeAudioData(): Promise<AudioData>  // called by audioData accessor + engine fetchAudio
}
```

Two important guarantees:

1. `peaks` resolves from `LongRecordingOverview` bins (already on disk) **without touching the chunk PCM
   files.** The Peaks instance is backed by `LongRecordingPeaksAdapter`, a hardware-independent module
   tested under Vitest. The shape (stages, bins per stage, channel layout) matches the upstream `Peaks`
   interface so the existing `PeaksPainter` paints it without modification.
2. `data` is **not** populated at construction or by reading the dashboard panel. It is populated on the
   first `materializeAudioData()` call: a one-shot pass that reads every chunk via
   `LongRecordingMediaAccess.readChunkSamples`, concatenates into a single `AudioData`, and caches it
   on the loader. Memory cost is bounded to one full copy at that point — explicitly documented and
   acceptable for the MVP play/export path.

The fallback in `GlobalSampleLoaderManager`:

```ts
#load(loader: DefaultSampleLoader): void {
  ...
  SampleStorage.get().load(uuid)
    .then(([data, peaks, meta]) => loader.setLoaded(data, peaks, meta))
    .catch(async () => {
      // NEW: try long-recording artifact before falling back to the API
      const opfs = Workers.Opfs
      const longRef = await LongRecordingMediaReference.load(toUUIDString(uuid), opfs)
      if (longRef.nonEmpty()) {
        const replacement = new LongRecordingSampleLoader(uuid, longRef.unwrap(), ...)
        this.#loaders.replace(replacement)        // see SortedSet.replace
        return
      }
      return this.#fetchFromApi(loader)
    })
}
```

`#loaders.replace(...)` is a minimal extension (in-place swap by uuid) — if `SortedSet` lacks it, the
implementation removes by uuid then re-adds. The previously-handed-out `loader` reference (a
`DefaultSampleLoader`) is then `setError`-ed and immediately replaced by the long-recording loader for
subscribers who arrive after the swap. Existing subscribers receive an "error" notification once and re-subscribe
via the renderer's standard re-subscribe path (`AudioFileBoxAdapter.audioData` promise memoizes; first error
rejects and a subsequent `getOrCreateLoader()` returns the swapped loader). This re-subscribe behavior is locked
by a Vitest case in `GlobalSampleLoaderManager.test.ts`.

### 5.5 Engine `fetchAudio` Compatibility

The engine's `fetchAudio` path queries `sampleManager.getOrCreate(uuid)` and waits for `loaded`. With the
fallback above, a long-recording uuid resolves to a `LongRecordingSampleLoader` whose `loaded` notification
arrives after `materializeAudioData()` completes. **No change to `EngineWorklet`, `EngineProcessor`,
`SampleManagerWorklet`, or `OfflineEngineRenderer`.**

The single visible side effect: a long-recording region's first play (or first export) incurs a one-time
materialization stall proportional to the recording length. The Dashboard panel exposes a "Prefetch for
playback" action for users who want to pay that cost up front; the spec defers this action's UI to a follow-up
unless it falls out cheaply during implementation.

### 5.6 Save / Reopen

Phase 2's `ProjectBundle.encode/decode` already covers the artifact round-trip and is locked by
`ProjectBundleLongRecording.test.ts`. The only additions:

- On project decode, after `LongRecordingArtifact.restore`, call `sampleManager.invalidate(uuid)` for each
  restored recording id so the next loader query goes through the long-recording fallback.
- On project encode, no change. Recordings whose manifest state is `"active"` (truly impossible after a clean
  save, but possible after a crash mid-save) are bundled as-is; recovery on the reopen side handles
  classification.

## 6. UX Surfaces

### 6.1 Per-Track Toggle

In the track header / capture control panel for an audio track:

```
┌── Track: Host Mic ─────────────────────────────┐
│ Device: [Built-in Microphone        ▾]         │
│ Channels: [Stereo ▾]   Gain: [+0 dB]           │
│ ☐ Long Recording                               │
│   Captures incrementally to OPFS; tempo        │
│   changes do not stretch the recording.        │
│   ⚠ Browser reports 44.1 kHz; engine 48 kHz    │
│     (silent resampling) — surfaced when the    │
│     capture source's mismatches() is non-empty │
└────────────────────────────────────────────────┘
```

Behavior:

- The toggle writes `captureAudioBox.longRecording.setValue(boolean)`.
- The warning chip below the toggle is driven by `CaptureSourceMetadata.mismatches(...)` of a "probe" capture
  source opened transiently on first arm (or by a cached snapshot if arming has already occurred). Implementation
  may simplify to "compute mismatches once at arm time and surface a static message" if a live probe is awkward.

### 6.2 Dashboard "Recoverable Recordings" Panel

Lives under the existing `/stats` Dashboard page as a new section. Lists every recording under
`recordings/v1/*` whose `LongRecordingRecovery.classify` overall is **not** `"clean"`. Each row exposes:

- recording id (collapsed UUID), createdAt timestamp, classification (color-coded badge).
- sample rate · channel count · `totalFrames / sampleRate` formatted as `HH:MM:SS`.
- per-chunk summary line: `N clean · M missing · K truncated · L corrupt · X extra`.
- actions: `Resume into project` (disabled if no project is open), `Inspect`, `Discard`.

`Resume into project` does not "continue" the recording; it inserts a new region pointing at the artifact. This
keeps the dashboard's responsibilities surgical: classify, expose, recover or discard. Continuation of an
in-flight recording across reloads is out of scope.

`Discard` calls `LongRecordingStorage.delete(recordingId)`. A confirmation dialog is shown.

### 6.3 Timeline Region Badge

A long-recording region is detectable by `AudioFileBoxAdapter.getOrCreateLoader() instanceof
LongRecordingSampleLoader`. If the loader's `state` is anything other than `"loaded"` or its underlying manifest
state is non-clean, the audio-region renderer overlays a small yellow chevron + tooltip:

```
Recoverable — 7/12 chunks clean, 5 missing
```

Clicking the badge opens the same per-chunk details modal used by the dashboard.

For loaders whose manifest state is `"stopped"` and recovery is `"clean"`, no badge is shown — the region looks
identical to any other audio region.

## 7. Behavior Contracts

| Subject | Guarantee |
| --- | --- |
| Musical takes | Existing `RecordAudio.start` is byte-for-byte unchanged. Existing unit tests + behavior preserved. |
| Long recording during capture | No JS-side allocation grows with recording length beyond `numberOfChannels × framesPerChunk × 4 B` plus the SAB ring buffer. (Already guaranteed by Phase 1.) |
| Stop / finalize | No full `AudioData` is constructed. Manifest writes state=`"stopped"`. (Already guaranteed by Phase 1.) |
| Loader peaks | Resolved from `LongRecordingOverview` only. No chunk PCM read. |
| Loader data | Materialized lazily on first engine subscription; documented one-time memory cost. |
| Tempo independence | `timeBase = TimeBase.Seconds`. Verified by `LongRecordingTempoIndependence.test.ts` (already exists). |
| Save / reopen | Round-trips through `ProjectBundle.encode/decode`. Verified by `ProjectBundleLongRecording.test.ts` (already exists). New: `sampleManager.invalidate(uuid)` is called for each restored recording id. |
| Recovery classification | Driven entirely by `LongRecordingRecovery.classify`. UI is presentation only; no new classification logic is invented. |
| Export | First read materializes; subsequent reads hit the cache. Documented in release notes. |

## 8. Test Strategy

### 8.1 New Hardware-Independent Vitest Cases

Adds vitest tests under `packages/studio/core/src/`:

| File | Focus |
| --- | --- |
| `samples/LongRecordingSampleLoader.test.ts` | `peaks` is `Some` immediately and renders the expected bin count; `data` is `None` until `materializeAudioData()`; `state` advances `"progress" → "loaded"` exactly once; `invalidate()` clears cached `AudioData` without re-reading the overview. |
| `recording/LongRecordingPeaksAdapter.test.ts` | overview bins → Peaks: stage layout, bin packing, multi-channel ordering. |
| `recording/LongRecordingArtifact.probeAll.test.ts` | Enumerates `recordings/v1/*`, returns each non-clean recovery; empty when only `"clean"` recordings exist. |
| `samples/GlobalSampleLoaderManager.longRecordingFallback.test.ts` | When `SampleStorage.load` rejects but `LongRecordingMediaReference.load` resolves, the manager swaps in a `LongRecordingSampleLoader` and notifies subscribers. |
| `capture/RecordAudioLong.test.ts` | Lifecycle: file/region created at record-start, duration/endInSeconds advance with `session.totalFrames`, stop finalizes both, abort cleans up empty manifest. Uses a stub `LongRecordingHandle` + in-memory `Project`. |
| `capture/CaptureAudio.longRecordingBranch.test.ts` | `prepareRecording` branches on `captureAudioBox.longRecording`. With `true`, no `RecordingWorklet` is created and `LongRecordingService.startFromSource` is invoked; with `false`, the existing musical path runs unchanged. |

### 8.2 Browser-Level Verification

The existing automated check `packages/app/studio/scripts/podcast-recording-browser-check.mjs` already covers the
Phase 1–3 happy path through a synthetic source. It is **extended** (not duplicated) to drive the product flow:

- A new `?mode=product` URL parameter on `/podcast-recording-test.html` (or a new sibling entry point
  `/podcast-recording-product-test.html` if cleaner) boots the runner against a real openDAW `Project`, ticks
  `captureAudioBox.longRecording = true` on a fresh audio track, runs the recording for the configured
  duration, stops, asserts the region's `duration` matches the manifest's `totalFrames / sampleRate`, then
  triggers `LongRecordingSampleLoader.materializeAudioData()` and asserts `loader.data.nonEmpty()`.
- A second URL parameter `?recovery=1` skips recording, writes a deliberately truncated manifest to OPFS via
  `LongRecordingArtifact.restore`, then loads the dashboard panel and asserts the row appears with the expected
  classification.

Exit codes: `0` pass, `1` fail, `2` env error. Both modes ship in the same `npm run test:podcast-recording-browser`.

### 8.3 Manual / Hardware-Optional Smoke Test

Documented under `docs/podcast-recording/product-integration-spec.md` §10 "Manual Smoke Test" (this file):

1. Open Studio in Chrome / Safari / Firefox.
2. Create a project. On track 1, enable Long Recording. Record for ~30 s with the system microphone.
3. Stop. Confirm the region renders with a waveform.
4. Save the project as `.odbundle`. Reload Studio. Open the bundle.
5. Confirm the region still renders, plays, and the dashboard shows no recoverable entries.
6. Repeat with a forced mid-take reload: hit record, reload after ~5 s, then check the dashboard panel for a
   `recoverable` row and confirm the per-chunk summary matches expectation.

Hardware-dependent paths (ZOOM L-12, virtual loopback) stay manual per `plans/podcast-recording.md` and are
**not** required for the MVP to land.

## 9. Acceptance Check (Maps To Goal "Done When")

| Goal criterion | Where satisfied |
| --- | --- |
| Create/open project, browser getUserMedia capture, arm a podcast/long path | §4.1 + per-track toggle + `CaptureAudio` branch. |
| Record locally, stop, see timeline region with waveform/overview, play it back | §5.3 + §5.4 + lazy materialization. |
| Save the project, reopen it, recording reference intact | §5.6 (already covered by Phase 2 + `invalidate` on decode). |
| Incremental OPFS chunking; multi-hour recordings do not require retaining the full take during recording or stop/finalize | §7 "Stop / finalize" guarantee (already enforced by Phase 1). |
| Tempo independence | §7 + `timeBase = TimeBase.Seconds`. |
| Interrupted / abandoned / corrupt / truncated / missing-chunk recordings surfaced explicitly | §4.2 + Dashboard panel + per-chunk details modal. |
| Product-facing recovery path after reload | Dashboard panel (§6.2). |
| Export works for MVP | §5.5 lazy materialization, documented memory cost. |
| Browser capture remains the default; Phase 4 deferred | `RecordAudioLong` uses `GetUserMediaCaptureSource` only. |
| Normal musical recording behavior not regressed | `RecordAudio.start` untouched (§5.1); unit + browser check covers regression. |

## 10. Manual Smoke Test

See §8.3.

## 11. Implementation Discipline

- Follow `AGENTS.md` strictly: `Optional<T>` / `Nullable<T>` from `lib-std`, `tryCatch` not `try/catch`,
  `--noEmit` for type checks, no `Set/Map<UUID.Bytes>`, no `as any`, no inline `try/catch`, no `!` definite
  assignment, no rewriting existing files with `Write`.
- TDD where behavior can be isolated (loader, peaks adapter, fallback path, `RecordAudioLong` lifecycle).
- Browser check must pass before claiming the slice complete.
- Update `docs/podcast-recording/` with a product-integration phase note once the implementation ships.
- Update release notes.

---

Status: this spec is the **active integration target** referenced from `plans/podcast-recording.md` §"Immediate
Next Step". The implementation plan that turns this spec into commits is tracked separately under
`docs/podcast-recording/product-integration-plan.md`.
