# Podcast Recording — Phase 1: OPFS-Backed Long Recording

Builds on `docs/podcast-recording-baseline.md` (Phase 0). Phase 1 introduces a long-recording artifact that lives
under `recordings/v1/<recordingId>/` in OPFS and is decoupled from the existing `SampleStorage` musical-take path.

## Module Layout

All code lives under `packages/studio/core/src/recording/` and is re-exported via the core package index.

| File | Purpose |
| --- | --- |
| `LongRecordingManifest.ts` | Pure types + serializer/validator for the per-recording manifest. |
| `LongRecordingRecovery.ts` | Pure classifier that walks a manifest against on-disk chunk probes. |
| `LongRecordingStorage.ts` | `OpfsProtocol`-backed read/write/list for a single recording. |
| `LongRecordingChunkBuffer.ts` | Accumulates render quanta into channel-interleaved Float32 chunks of `framesPerChunk`. |
| `LongRecordingSession.ts` | Coordinator: arm → recording → stopping → stopped/failed, with progress/state/error notifiers. |
| `LongRecordingWorklet.ts` | Reuses `recording-processor` and the existing `RingBuffer` to feed `LongRecordingSession.appendQuantum`. |

All five `*.test.ts` siblings are pure Vitest units that exercise the manifest, recovery, storage, chunk buffer, and
session in isolation against an in-memory `OpfsProtocol`. No real `AudioContext` or `AudioWorklet` is required to run
them. Counts: 44 tests in the recording module, 180 across `@opendaw/studio-core`.

## Storage Layout

```
recordings/v1/<recordingId>/
├── manifest.json
└── chunks/
    ├── 000000.pcm
    ├── 000001.pcm
    └── ...
```

Chunks are raw Float32 PCM, channel-interleaved. `manifest.json` is JSON encoded with `TextEncoder` and round-trips
through `LongRecordingManifest.encode/decode`. The schema is versioned (`schema: 1`).

Manifest content:

- `recordingId` — UUID string, also used as the directory name.
- `createdAt` / `updatedAt` — millisecond epoch timestamps (`now()` is injectable for tests).
- `state` — `"active" | "stopped" | "abandoned" | "failed"`.
- `sampleRate`, `numberOfChannels`, `framesPerChunk`, `bytesPerSample` — frozen at arm time.
- `chunks` — append-only `[ {index, frames, bytes}, ... ]`. The manifest is rewritten after each chunk write.
- `totalFrames` — running sum.
- `source` — `{kind: "getUserMedia" | "synthetic" | "test", label, requestedSampleRate/Channels,
  actualSampleRate/Channels}`. Phase 1 implements `synthetic`; `getUserMedia` is the contract for Phase 3.

## Lifecycle Contract

1. **`assertOpfsSupported()`** — hard error if `navigator.storage.getDirectory` is missing. Called by the harness
   before any session work.
2. **`requestPersistence()`** — calls `navigator.storage.persist()` once and reports the outcome to the caller.
3. **`session.arm()`** — writes the initial `manifest.json` with state `"active"` and zero chunks. Required before
   `appendQuantum` does anything.
4. **`session.appendQuantum(channels)`** — invoked from the main-thread reader of `RecordingProcessor`. Buffers
   render quanta into the in-flight chunk; when full, enqueues a write. Writes are serialized through a single
   `Promise` chain so OPFS sees one operation at a time per session.
5. **`session.stop()`** — flushes the partial residual chunk, awaits the write queue, then writes the manifest with
   `state: "stopped"`.
6. **`session.fail(error)`** — sets `state: "failed"`, notifies subscribers, and tries one last manifest write so the
   recording can later be classified as `failed` rather than `recoverable`.
7. **`session.abandon()`** — sets `state: "abandoned"` when the user explicitly discards a recording without
   completing it.

The session never copies the in-flight buffer back into JS heap after writing it to OPFS, so memory does not grow
with recording length. Peak memory during recording is bounded by `numberOfChannels × framesPerChunk × 4 B` + the
ring-buffer SAB, regardless of session duration.

## Recovery Classification

`LongRecordingRecovery.classify(manifest, probes)` produces a `LongRecordingRecoveryReport` with:

- `chunks` — one `LongRecordingChunkStatus` per declared chunk plus `extra` entries for files on disk that the
  manifest does not mention.
- `overall` — `"clean" | "recoverable" | "corrupt" | "failed"`.
- `recoverableFrames` / `recoverableBytes` — frames/bytes counted up to (but not including) the first gap.

Status types:

- `clean` — chunk on disk has the byte length the manifest declared.
- `missing` — manifest declares the chunk but no file exists.
- `truncated` — file is shorter than the declared chunk size; classified as corrupt overall but yields no
  recoverable frames past that point.
- `corrupt` — file is longer than expected; conservative reading refuses to interpret it.
- `extra` — file on disk has no matching manifest entry; reported but does not affect overall classification.

Calling code can use `recoverableFrames` to decide how much of a partially failed recording to import.

## Browser Verification Harness

Phase 0 promised an automation strategy; Phase 1 implements the manual half of it. New build entry:

- `packages/app/studio/podcast-recording-test.html` — standalone page at route `/podcast-recording-test`.
- `packages/app/studio/src/podcast-recording-test/main.ts` — bootstraps `Workers.install` + `AudioWorklets.install`,
  generates a UUID, builds an oscillator → channel-merger → `LongRecordingWorklet`, runs for the configured number
  of seconds, stops, then reloads the manifest from OPFS and runs `LongRecordingRecovery.classify` on it.
- Vite config adds the page to `rollupOptions.input` and to the SPA middleware so `/podcast-recording-test`
  serves the HTML in dev mode.

The page renders a PASS/FAIL status and a structured log. Because `AudioContext.resume()` requires a user gesture,
the page exposes a "Start test" button rather than auto-starting; the `data-test="start"` attribute makes it
addressable by a future Playwright runner without further changes.

How to run manually (no microphone or specific hardware required):

```
npm run dev:studio
# then visit https://localhost:8080/podcast-recording-test
# click "Start test"
```

Expected output for a successful clean stop:

- `manifest.state = stopped`
- `overall = clean`
- `manifest.totalFrames` within half a second of `duration × sampleRate` (allowing for one render-quantum drift on
  start/stop).
- No `STORAGE ERROR` entries in the log.

The harness also exposes a "Clear OPFS state" button that calls `LongRecordingStorage.listAll` and deletes every
known recording directory. Use it between runs to keep OPFS tidy.

## Tests vs. Browser Verification

Test discipline matches the plan's "Implementation Discipline" section:

- **TDD-first units** for every pure piece (manifest serialization, recovery classification, chunk buffer
  interleaving, session orchestration, storage layout). 44 tests.
- **Browser verification harness** for the end-to-end path that needs real `AudioContext` + OPFS. Manual click to
  start; reports structured pass/fail.
- **No hardware dependency.** The harness uses a synthetic oscillator. ZOOM L-12 / virtual-device routes remain
  manual checks for Phase 3.

## Why a Separate Artifact

`SampleStorage` is keyed by sample UUID and writes a single WAV per asset. Long recordings need:

- A manifest that exists before finalization so an interrupted tab can be recovered.
- Multiple chunk files, not one monolithic WAV.
- A live `state` field that distinguishes `active`, `stopped`, `abandoned`, `failed`.

`SampleService.importRecording` continues to work unchanged for ordinary musical takes. Phase 2 will design how a
long recording is *referenced* by project state without copying it into the sample store.

## Outstanding Items For Phase 2

- Project-graph reference type for long recordings.
- Waveform overview cached separately from raw chunks.
- How tempo changes interact with recorded podcast media (must not move/stretch).
- Edit operations (trim/split/fade/ripple) on chunk-backed media.

## Acceptance Check (Phase 1)

| Acceptance criterion (from plan §"Phase 1") | Where it is satisfied |
| --- | --- |
| Long mono/stereo recording stops without assembling full recording in RAM | `LongRecordingSession` writes chunks incrementally and discards in-flight buffers after each write. |
| Stopped recording has enough metadata to be referenced or exported later | Manifest preserves sample rate, channel count, channel order, duration, chunk index, source kind, requested vs actual configuration. |
| Interrupted recording appears recoverable or failed, not silently lost | `LongRecordingRecovery.classify` emits `"recoverable" \| "corrupt" \| "failed"`; manifest is durable from arm time onward. |
| Corrupt/missing chunks reported explicitly | `LongRecordingChunkStatus` covers `missing`, `truncated`, `corrupt`, `extra`; reported without zero-padding. |
| Isolated tests for recoverable logic + browser verification for the recording path | 44 Vitest units (hardware-independent) + `podcast-recording-test.html` harness driving a real `AudioContext`. |
