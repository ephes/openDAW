# Podcast Recording — Phase 0 Baseline

Source plan: `plans/podcast-recording.md` (issue 245).

This note records the measurements and decisions that gate Phase 1. It is descriptive of code on the
`issue-245-podcast-recording-plan` branch; numbers are derived from that snapshot.

## 1. Current Recording Path (Trace)

Following the audio sample buffer from microphone to OPFS:

1. **`CaptureAudio` (`packages/studio/core/src/capture/CaptureAudio.ts`)** opens `getUserMedia` with
   `echoCancellation/noiseSuppression/autoGainControl` disabled and the requested `channelCount` ideal-clamped.
   `#rebuildAudioChain` clamps the effective channel count to `Math.min(streamChannelCount, 2)`, so even when the
   browser exposes >2 channels, the chain is forced to mono or stereo.
2. **`RecordingWorklet` (`packages/studio/core/src/RecordingWorklet.ts`)** is created with a `RingBuffer.Config` whose
   `numChunks` equals the same parameter passed by `AudioWorklets.createRecording` (currently `RenderQuantum`, i.e. 128
   chunks of 128 frames each — see step 5).
3. **`RecordingProcessor` (`packages/studio/core-processors/src/RecordingProcessor.ts`)** writes the incoming
   `inputs[0]` directly into the ring buffer every render quantum (`128` frames at the engine sample rate).
4. **Main-thread reader** (`RingBuffer.reader` in `packages/studio/adapters/src/RingBuffer.ts`) wakes on
   `Atomics.notify`, copies each chunk into a new `Float32Array` per channel, and calls the append callback.
5. **`RecordingWorklet.#output`** accumulates every chunk as a separate `Array<ReadonlyArray<Float32Array>>`. The
   ring buffer is a window; `#output` is unbounded for the lifetime of the recording.
6. **Stop / finalize** is triggered by `RecordingWorklet.#finalize()`, called either when `limit()` reports enough
   frames or when the take ends. It calls `mergeChunkPlanes(this.#output, ...)`, slices each merged plane to the exact
   target length, copies them into a brand-new `AudioData` and hands that to `SampleService.importRecording`.
7. **`SampleService.importRecording`** WAV-encodes the merged audio (`WavFile.encodeFloats`), generates peaks from the
   merged frames, then calls **`SampleStorage.save`** which encodes the WAV **again** before writing to OPFS as
   `samples/v2/<uuid>/audio.wav`.

OPFS itself is already in use: `SampleStorage` writes through `Workers.Opfs` (`packages/lib/fusion/src/opfs/OpfsWorker.ts`),
which uses `FileSystemSyncAccessHandle` via a worker. There is no chunked write API today; OPFS is only used for full
WAV files keyed by sample uuid.

## 2. Memory & Finalization Failure Surface

Float32 PCM cost: `sampleRate × channelCount × 4 B`. At 48 kHz:

| Length | Mono | Stereo |
| --- | --- | --- |
| 1 min | 11.5 MB | 23 MB |
| 30 min | 345 MB | 690 MB |
| 1 h | 691 MB | 1.38 GB |
| 3 h | 2.07 GB | 4.15 GB |

The numbers above measure the **logical PCM size**. The current path holds several near-full copies live at the
moment `#finalize` runs:

- `#output` — the array of per-quantum planes. Same logical size as the recording.
- `mergeChunkPlanes(...)` allocates a fresh contiguous `Float32Array` **per channel** — second full copy.
- `.map(frame => frame.slice(-totalSamples))` allocates **another** contiguous buffer per channel — third full copy.
- `AudioData.create(...)` allocates one more `Float32Array` per channel and copies the slice in via `.set(frame)` —
  fourth full copy. `mergedFrames` is held until `audioData` is fully populated.
- `SampleService.importRecording` calls `WavFile.encodeFloats({frames: audioData.frames.slice(), ...})` — one
  WAV-sized `ArrayBuffer` (channels × frames × 4 + 44 B header).
- `SampleStorage.save({uuid, audio, peaks, meta})` calls `WavFile.encodeFloats(...)` **again** with another full
  buffer copy. The previous WAV ArrayBuffer is still reachable until the Promise resolves.

In effect, a clean stop on a 3-hour stereo recording asks the page for roughly **16–20 GB** of transient peak
allocation, of which a few full copies (~8 GB) remain reachable until the imported sample finishes saving. This is the
exact moment users expect "stop = safe", and it is the most likely point of failure.

`PeaksWriter` itself (`packages/studio/core/src/PeaksWriter.ts`) is incremental and not in this list. Peak generation
in `Workers.Peak.generateAsync` runs after the merge and reads the merged frames directly, so it does not add another
full copy beyond what the worker already needs.

### Tab reload / crash / storage failure today

- A tab reload or browser crash mid-recording loses everything: `#output` is in RAM, `fileBox`/region only exist on
  the project graph after the editing transaction in `RecordAudio.start`, and the WAV is only written when `#finalize`
  resolves.
- A failed `Workers.Opfs.write` rejects the `SampleStorage.save` promise; `importRecording` propagates the rejection.
  `RecordingWorklet.#finalize` catches the rejection in the call site (`this.#finalize().catch(error => console.warn)`)
  and continues with `terminate()`. The region was already committed to the project but the underlying file is
  missing, leaving a dangling `AudioFileBox`.
- There is no recovery metadata. Nothing in OPFS describes "an in-progress recording started at T, channel layout C,
  expected length unknown" until `SampleStorage.save` succeeds.

## 3. Browser Capture Capability — Known State

Programmatic discovery requires a browser; the items below are known constraints and the matrix that the Phase 0
harness (Section 5) must fill in. The plan explicitly classifies hardware-dependent verification as manual.

Constraints that already exist in code:

- `CaptureAudio` requests `channelCount: {ideal: requestChannels.unwrapOrElse(2)}` and then clamps to 1 or 2 in
  `#rebuildAudioChain` (`Math.min(streamChannelCount, 2)`). Any >2-channel browser stream is silently truncated.
- The engine `AudioContext` is the source of truth for `sampleRate`. `getUserMedia` may resample the device stream
  before the source node sees it.
- `MediaStreamTrack.getSettings()` exposes the actual `deviceId`, `channelCount` and `sampleRate` after the stream
  opens. The repo logs them on `[CaptureAudio] latency report` but does not surface them in the UI.

Known browser limits (from web platform docs, to be confirmed against real hardware in Section 5):

| Topic | Chrome / Chromium | Firefox | Safari |
| --- | --- | --- | --- |
| `channelCount` >2 via `getUserMedia` | Reported but historically clamped; may now pass through with `latencyHint: "interactive"` and explicit `channelCount` constraint when the input is an aggregate device. | Partial; recent versions pass through for some devices. | Typically clamps to mono/stereo. |
| `getSettings().channelCount` accuracy | Reflects browser-effective channel count, not always the device's native count. | Same. | Same. |
| `AudioContext.sampleRate` follows OS device | Yes on macOS / Linux; locked once context opens. | Same. | Locked at context creation. |
| OPFS + `FileSystemSyncAccessHandle` | Supported in worker context. | Supported. | Supported as of 17.x. |
| `navigator.storage.persist()` | Returns true under user-engaged origins. | Same. | Same. |

Outcome for the first slice: **the upstream recording path stays mono/stereo by contract**, even if a particular
browser exposes more channels. Multichannel browser capture is classified as **partial** and is gated on the Phase 3
capture-source abstraction.

## 4. Browser Automation Strategy

The current repo has no Playwright/Puppeteer harness — tests are Vitest (`jsdom`) units. JSDOM has no Web Audio,
`AudioWorklet`, `SharedArrayBuffer` ring buffers, or `FileSystemSyncAccessHandle`. The existing `OpfsWorker.test.ts`
mocks the full file-system surface.

The recording path splits into two distinct kinds of behavior:

1. **Browser-agnostic logic** — manifest writing, chunk indexing, recovery classification, chunk validation.
   This is decidable on top of a plain `OpfsProtocol`-shaped interface, so it can be tested under Vitest with an
   in-memory `OpfsProtocol` mock (the same mock that `OpfsWorker.test.ts` already builds).
2. **Browser-only paths** — the live worklet, real `AudioContext` sample rate, real OPFS file handles, real
   `navigator.storage.persist()` outcome.

Strategy for Phase 1:

- All recovery/manifest/chunk logic is TDD-first under Vitest using the in-memory `OpfsProtocol` mock.
- Browser verification ships in Phase 1 as both an interactive dev page and an automated headless check:
  - `packages/app/studio/podcast-recording-test.html` (`/podcast-recording-test.html`) — a Vite entry with a
    `?autorun=1&duration=N&channels=C&source=getUserMedia|synthetic` URL contract.
  - `packages/app/studio/src/podcast-recording-test/runner.ts` — the reusable `runPodcastRecordingTest(config)`
    driver. Generates a UUID, builds a `CaptureSource` (synthetic oscillator by default, `getUserMedia` opt-in),
    runs the long-recording session via `LongRecordingService.startFromSource`, stops, reloads the manifest from
    OPFS, runs `LongRecordingRecovery.classify`, reads media reference + overview, and returns a typed
    `{status, manifest, recovery, captureMetadata, mismatches, ...}` result. No microphone permission needed for
    the default synthetic source.
  - `packages/app/studio/scripts/podcast-recording-browser-check.mjs` — the automated runner. Runs
    `npx vite build` when `dist/` is missing (`--rebuild` forces, `--skip-build` requires pre-built `dist/`),
    serves `dist/` over plain HTTP with COOP/COEP headers, and uses Playwright Core against the system Chrome
    (autoplay-policy disabled, fake media stream) to drive `?autorun=1`. Exits 0 on pass, 1 on fail, 2 on env
    error. CI-runnable: `npm run test:podcast-recording-browser`.
- Hardware-dependent checks (ZOOM L-12, virtual multichannel routes) stay manual per the plan and live alongside
  the Phase 3 capture-source documentation (`docs/podcast-recording-phase-3.md`).

## 5. Storage Primitive Decision

The plan asks: "Decide whether the first implementation modifies existing sample storage or introduces a separate
long-recording artifact type."

Decision: **introduce a separate artifact**, not a fork of `SampleStorage`.

Reasons:

- `SampleStorage` keys by sample uuid and writes a single `audio.wav` per sample. A long recording must persist
  multiple chunks plus a manifest, which is structurally different.
- Musical takes (count-in, looped takes, short overdubs) keep working through `SampleService.importRecording`
  without behavior change. Moving them onto the chunked path would broaden the diff without a payoff for the issue.
- Recovery requires a manifest that exists *before* finalization. `SampleStorage` only exposes save/load on a
  completed object. A new artifact type lets us write the manifest at arm time and update it during recording.
- Project state can later refer to either kind of artifact (musical sample or long recording). The decision keeps
  both kinds first-class.

Concrete shape introduced in Phase 1 (precise schema lives in `packages/studio/core/src/recording/`):

```
OPFS root
└── recordings/v1/
    └── <recordingId-uuid>/
        ├── manifest.json          # written at arm, updated after every chunk and on stop
        ├── chunks/
        │   ├── 000000.pcm         # raw Float32, channel-interleaved, fixed frames-per-chunk
        │   ├── 000001.pcm
        │   └── ...
        └── peaks.bin              # optional: incremental peak data (Phase 2)
```

`manifest.json` shape (initial; expanded in Phase 2):

```jsonc
{
  "schema": 1,
  "recordingId": "<uuid>",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000123,
  "state": "active" | "stopped" | "abandoned" | "failed",
  "sampleRate": 48000,
  "numberOfChannels": 1,
  "framesPerChunk": 24000,
  "chunks": [
    { "index": 0, "frames": 24000, "bytes": 192000 },
    { "index": 1, "frames": 24000, "bytes": 192000 }
  ],
  "totalFrames": 48000,
  "source": { "kind": "getUserMedia", "label": "...", "requestedChannels": 1 }
}
```

Notes:

- Chunk size is configurable but defaults to ~0.5 s at 48 kHz to keep manifest churn low without making individual
  write failures expensive.
- Raw Float32 is chosen for Phase 1 to remove encode/decode complexity from the recovery story; switching to Int16
  PCM, FLAC, or Opus is left as a Phase 2+ open question (already listed in the plan).
- The OPFS path uses `v1` so a later schema bump can move to `recordings/v2/`.

## 6. Open Items Carried Into Phase 1

These are deliberate non-decisions taken at Phase 0:

- Final waveform overview strategy (Phase 2 owns this; Phase 1 writes raw PCM only).
- Codec choice for long-term storage (Phase 2 / later).
- How the project graph references a long recording (a Phase 2 artifact-reference design).
- Multichannel mapping UI (Phase 3).

## 7. Acceptance Check (Phase 0)

| Acceptance criterion (from plan §"Phase 0") | Where it is satisfied |
| --- | --- |
| Short technical note on current memory and finalization failure surfaces | §1, §2 |
| First implementation target narrowed to a storage primitive | §5 |
| Browser verification planned before Phase 1 implementation | §4 |
| No native backend required | §5 (artifact uses OPFS only) |
