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

Region *position* on the timeline is encoded in PPQN per the existing project model. The Phase 2 contract is
about *duration* and *content addressing* being tempo-independent — both verified in
`LongRecordingTempoIndependence.test.ts`. Any later need for a seconds-anchored position would be a separate
project-model change and is not implied by Phase 2.

## Project Save/Load

Phase 2 ships an end-to-end project save/load story for long recordings using the existing `AudioFileBox` as the
project-graph reference and `recordings/v1/<uuid>/` in OPFS as the data store:

- `LongRecordingArtifact.collect(opfs, recordingId)` returns the manifest + chunk + overview byte streams for a
  recording rooted at the same UUID as the project's `AudioFileBox`.
- `LongRecordingArtifact.restore(opfs, recordingId, files)` writes those bytes back into a fresh OPFS, ready for
  `LongRecordingStorage.create(...).readManifest()`.
- `ProjectBundle.encode` classifies every `AudioFileBox` in the box graph: if a long-recording manifest exists for
  that UUID, it is bundled into `recordings/<uuid>/` of the project ZIP instead of being treated as a sample;
  otherwise the existing `samples/<uuid>/` flow runs untouched.
- `ProjectBundle.decode` mirrors that: any `recordings/...` content is written to OPFS at
  `recordings/v1/<uuid>/...` before the box graph is rehydrated. The `AudioFileBox` survives the box-graph
  serialization with its `endInSeconds` field carrying the recording's wall-clock duration.

This means a project bundle (`*.odbundle` ZIP) round-trips a long recording with no in-memory PCM transfer and no
schema change to the auto-generated `studio-boxes` package. The chunked media stays on disk; only the project
metadata and the recording artifact bytes move.

`LongRecordingMediaReference.load(recordingId, opfs)` reconstructs a typed reference (sample rate, channel count,
duration, overview spec, state) from the restored manifest. `LongRecordingMediaAccess.create(reference, storage)`
gives consumers chunk-indexed random access without loading raw audio.

The save/load behaviour is covered by:

- `LongRecordingArtifact.test.ts` — collect/restore + recovery classification of partial artifacts.
- `LongRecordingBundleAdapter.test.ts` — classify / writeIntoFolder / restoreFromFolder on the adapter level.
- `LongRecordingProjectRoundTrip.test.ts` — full box-graph + OPFS round trip with an `AudioFileBox` plus an
  edge-satisfying `MetaDataBox`, restoring into a fresh `BoxGraph` + fresh `InMemoryOpfs`, then verifying
  duration, sample rate, channel count, channel order, overview spec, and state survive.
- `ProjectBundleLongRecording.test.ts` — end-to-end exercise of `ProjectBundle.encode` and
  `ProjectBundle.decode`: `encode` writes a real ZIP whose `recordings/<uuid>/manifest.json`,
  `chunks/*.pcm`, and `chunks/*.overview` were sourced from the OPFS-backed recording, and `decode`
  restores those bytes back into a fresh OPFS at `recordings/v1/<uuid>/...` before the box graph
  rehydrates. This is the test that actually exercises the `ProjectBundle.encode/decode` integration code
  (the box-graph round-trip test alone does not).

## Browser Verification

The `/podcast-recording-test.html` harness (Phase 1) and its automated companion
`scripts/podcast-recording-browser-check.mjs` both exercise the Phase 2 path end-to-end:

1. After `session.stop()`, `LongRecordingMediaReference.fromManifest(reloaded)` produces the typed reference.
2. `LongRecordingMediaAccess.readOverviewBins()` reads the persisted overview without re-decoding chunks.
3. The harness UI renders a `data-test=metadata` table with the requested/actual sample rate + channels so a
   later run can assert against it.

PASS criteria from Phase 1 still apply; the automated check additionally writes a JSON summary on stdout that
includes the `overviewBins` count and the requested-vs-actual capture metadata.

## Acceptance Check (Phase 2)

| Acceptance criterion (from plan §"Phase 2") | Where it is satisfied |
| --- | --- |
| OPFS-backed recording artifact referenced by project state | `ProjectBundle.encode/decode` bundles `recordings/<uuid>/...` alongside `samples/<uuid>/...`; the `AudioFileBox` is the project-graph reference. `LongRecordingMediaReference.fromManifest` produces the typed view consumers use. The integration is exercised end-to-end by `ProjectBundleLongRecording.test.ts`. |
| Sample rate, channel count, duration, channel order, source metadata preserved | `LongRecordingProjectRoundTrip.test.ts` asserts each of these survives the artifact + box-graph layer (`LongRecordingArtifact.collect → restore` plus `BoxGraph.toArrayBuffer → fromArrayBuffer`). `ProjectBundleLongRecording.test.ts` additionally asserts the bytes survive a real `ProjectBundle.encode → decode` cycle. |
| Waveform overview cached separately from raw media | Per-chunk `*.overview` files alongside `*.pcm`; manifest carries `overview.samplesPerBin / bytesPerBin`; `LongRecordingArtifact` bundles them; the project round-trip test reads them back without touching raw audio. |
| Trims/splits/fades/ripple edits refer back to chunked media | `LongRecordingMediaAccess.locateFrame / locateSeconds` returns `{chunkIndex, chunkFrameOffset}` for any seconds offset, sample-rate-bound. Chunk files are random-access; the Phase-2 contract covers addressing. |
| Tempo changes do not stretch/move podcast media | `LongRecordingTempoIndependence.test.ts` exercises BPM 60/120/240 with `TimeBase.Seconds` (invariant) and `TimeBase.Musical` (stretches — negative control); `locateSeconds` is sample-rate-bound. |
| Project save/load preserves references and metadata | `LongRecordingProjectRoundTrip.test.ts` round-trips a real `BoxGraph` (`AudioFileBox` + `MetaDataBox`) through `toArrayBuffer/fromArrayBuffer` and an OPFS bundle/unbundle. The restored AudioFileBox uuid, endInSeconds, and the restored manifest's sample rate / channels / overview / state / channel order all match the originals. |
