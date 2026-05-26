# Podcast Recording — Phase 2: Tempo-Independent Project Media

Builds on Phase 1 (`docs/podcast-recording-phase-1.md`). Phase 2 adds the on-disk and in-memory shape needed for a
project to point at a long recording without loading its audio, and verifies that tempo changes do not stretch or
move the resulting media.

## New And Updated Modules

| File | Status | Purpose |
| --- | --- | --- |
| `LongRecordingOverview.ts` | new | Pure encode/decode for per-chunk waveform overview bins (Float16-packed min/max per channel). |
| `LongRecordingMedia.ts` | new | `LongRecordingMediaReference` (project-state-friendly) + `LongRecordingMediaAccess` (frame ↔ chunk mapping, deinterleaved chunk reads, overview reads). |
| `LongRecordingManifest.ts` | updated | Carries `overview: {samplesPerBin, bytesPerBin}` so the strategy is preserved across save/load. |
| `LongRecordingStorage.ts` | updated | `writeChunkOverview` / `readChunkOverview`; `listChunkProbes` ignores `.overview` siblings so recovery still works. |
| `LongRecordingSession.ts` | updated | Computes a per-chunk overview as each chunk is flushed and writes it next to the chunk; manifest carries the overview spec. |
| `index.ts` | updated | Re-exports `LongRecordingOverview` and `LongRecordingMedia`. |
| `LongRecordingTempoIndependence.test.ts` | new | Regression tests for tempo behavior using the existing `TempoMap` + `TimeBaseConverter`. |
| `podcast-recording-test/main.ts` | updated | Browser harness exercises `LongRecordingMediaReference.fromManifest` and `LongRecordingMediaAccess.readOverviewBins`. |

## On-Disk Shape (v1)

```
recordings/v1/<recordingId>/
├── manifest.json                 # now also contains "overview": {samplesPerBin, bytesPerBin}
└── chunks/
    ├── 000000.pcm                # interleaved Float32 PCM
    ├── 000000.overview           # per-bin Float16 min/max (numberOfChannels × 4 bytes per bin)
    ├── 000001.pcm
    ├── 000001.overview
    └── ...
```

The overview file lives next to the chunk it summarizes. This keeps the live write story simple (OPFS truncates on
every write; a single growing `overview.bin` would force O(N²) rewrites). A future Phase 2.5 step can consolidate
into one file once a recording is finalized.

### Overview Format

`LongRecordingOverview.encodeChunkOverview(channels, samplesPerBin)` emits a tightly packed byte array:

```
for each bin (samplesPerBin frames, last bin may be shorter):
    for each channel:
        int16 little-endian Float16 bits  (min value in [-1, 1])
        int16 little-endian Float16 bits  (max value in [-1, 1])
```

- 4 bytes per channel per bin, matching the upstream `Peaks.Stage` packing convention. Total cost: roughly
  `numberOfChannels × ceil(totalFrames / samplesPerBin) × 4 B` — for stereo @ 256 samples/bin and 1 hour @ 48 kHz
  this is ~5.4 MB.
- Default `samplesPerBin = 256`. Override at session construction with `overviewSamplesPerBin`.
- The trailing bin is encoded honestly (no zero padding) so a partial chunk yields a partial bin.
- Min/max are computed with channel order preserved.

### Media Reference

`LongRecordingMediaReference` is a plain JSON-friendly type:

```ts
interface LongRecordingMediaReference {
  kind: "long-recording"
  recordingId: UUID.String
  sampleRate: int
  numberOfChannels: int
  durationSeconds: number
  totalFrames: int
  framesPerChunk: int
  overviewSamplesPerBin: int
  state: "active" | "stopped" | "abandoned" | "failed"
}
```

It is derived by `LongRecordingMediaReference.fromManifest(manifest)` and can be reloaded by
`LongRecordingMediaReference.load(recordingId, opfs)`. It carries everything project-state needs to display the
recording on the timeline (duration, sample rate, channel count, overview strategy, current state) without ever
reading the chunked audio.

`LongRecordingMediaAccess` is the read-side adapter for chunks/overview when something does need samples (e.g.
playback, export):

- `locateFrame(frameIndex)` / `locateSeconds(seconds)` → `{chunkIndex, chunkFrameOffset}`. Mapping is
  sample-rate-bound, never BPM-bound.
- `readChunkSamples(chunkIndex)` deinterleaves on demand to `Float32Array` per channel.
- `readOverviewBins()` returns a flat array of `{channel, min, max}` bins across all chunks, suitable for waveform
  rendering at the project's overview decimation.

## Tempo Independence

`AudioRegionBox.timeBase` already supports a per-region time-base (set to `TimeBase.Seconds` for recorded regions
by `RecordAudio.start` today). `TimeBaseConverter.aware(tempoMap, timeBase, property)` is the existing entry point
for converting between musical and absolute time. Phase 2 locks the contract for podcast recordings:

| Property | Behavior |
| --- | --- |
| `LongRecordingMediaReference.durationSeconds` | Derived from `totalFrames / sampleRate`. BPM has no input. |
| `LongRecordingMediaAccess.locateSeconds(s)` | Multiplies by `sampleRate`; result is identical across BPM changes. |
| `AudioRegionBox` with `timeBase = TimeBase.Seconds` | `toSeconds(position)` returns the stored seconds value verbatim — verified across BPM 60/120/240. |
| `AudioRegionBox` with `timeBase = TimeBase.Musical` | Stretches with BPM (negative-control regression test). |

These properties are exercised in `LongRecordingTempoIndependence.test.ts`.

### What This Buys Podcast Users

- A 30-minute podcast region recorded at BPM 120 still reports 30 minutes at BPM 80.
- The waveform overview bins map to the same audio frames before and after a BPM change.
- Splits / trims expressed in seconds resolve to the same `{chunkIndex, chunkFrameOffset}` regardless of BPM.
- Region *position* on the timeline is still encoded in PPQN (this is the existing project model). If a podcast user
  rejects this entirely, the follow-up is to add a seconds-anchored position field to a new region box variant —
  out of scope for this slice; tracked under §"Outstanding For Phase 3+".

## Project Save/Load Story

Phase 2 keeps the upstream box graph untouched. `LongRecordingMediaReference` is the canonical serializable shape
for "this project knows about a long recording with id X." The next step is wiring this into the project graph as
a new artifact type — that touches the auto-generated `studio-boxes` package and is intentionally deferred:

- Add `LongRecordingArtifactBox` and a corresponding region kind in a future PR.
- Until then, the recording sits in OPFS and is discoverable via `LongRecordingSession.enumerateExisting(opfs)`.
- The browser harness demonstrates that a reloaded recording can produce a media reference and read overview bins
  without re-decoding chunks.

## Browser Verification

The Phase 1 harness (`/podcast-recording-test`) now also:

1. Loads `LongRecordingMediaReference.fromManifest(reloaded)` after stop.
2. Builds a `LongRecordingMediaAccess` and calls `readOverviewBins()`.
3. Logs the bin count to prove the overview path produced data without touching raw chunks beyond their per-write
   computation step.

PASS criteria from Phase 1 still apply; the additional output lines look like:

```
media reference: {"durationSeconds":5.000,"framesPerChunk":24000,"overviewSamplesPerBin":256}
overview bins read without loading raw audio: 1920
```

## Outstanding For Phase 3+

- `LongRecordingArtifactBox` for full project save/load round-trip through the box graph.
- Trim/split/fade/ripple edit primitives that produce sub-region views of a long recording. Today these are
  expressed in seconds on the region box; the chunk-index calculator is in place via
  `LongRecordingMediaAccess.locateSeconds`. The edit pipeline still needs to be hooked up.
- Position-in-seconds for regions on tempo-changing timelines, if the no-stretch guarantee in Phase 2 turns out to
  be insufficient for podcast workflows.

## Acceptance Check (Phase 2)

| Acceptance criterion (from plan §"Phase 2") | Where it is satisfied |
| --- | --- |
| OPFS-backed recording artifact referenced by project state | `LongRecordingMediaReference` (serializable; project-state-friendly). Box-graph integration deferred and documented. |
| Sample rate, channel count, duration, channel order, source metadata preserved | Manifest preserved all of these from Phase 1; `LongRecordingMediaReference.fromManifest` exposes them. `LongRecordingChunkBuffer.deinterleave` round-trip tests cover channel order. |
| Waveform overview cached separately from raw media | Per-chunk `*.overview` files; `LongRecordingOverview` encode/decode; manifest carries `overview.samplesPerBin / bytesPerBin`. |
| Trims/splits/fades/ripple edits refer back to chunked media | `LongRecordingMediaAccess.locateFrame / locateSeconds` maps to chunk index + offset; chunks are random-access. Edit-pipeline wiring tracked under §Outstanding. |
| Tempo changes do not stretch/move podcast media | `LongRecordingTempoIndependence.test.ts` exercises BPM 60/120/240 with both `TimeBase.Seconds` (invariant) and `TimeBase.Musical` (stretches — negative control). Media reference durations and chunk locations are sample-rate-bound. |
| Project save/load preserves references and metadata | `LongRecordingMediaReference.load(recordingId, opfs)` reconstructs the reference from the persisted manifest, independent of in-process state. |
