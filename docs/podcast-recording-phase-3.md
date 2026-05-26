# Podcast Recording — Phase 3: Capture-Source Abstraction

Builds on Phase 2 (`docs/podcast-recording-phase-2.md`). Phase 3 separates "where audio comes from" from "how
it is stored" so a single recording pipeline can sit behind multiple capture backends without changing storage,
manifest, or recovery code.

## Module Layout (new)

All new code lives under `packages/studio/core/src/capture-source/` and is re-exported via the package index.

| File | Purpose |
| --- | --- |
| `CaptureSourceTypes.ts` | `CaptureSource` interface, `CaptureSourceMetadata`, mismatch reports, helper for projecting metadata into `LongRecordingSource`. |
| `CaptureChannelMap.ts` | Pure channel-mapping logic (`identity`, `swap`, `monoFromChannel`, `apply`, `applyInPlace`, `validate`). |
| `SyntheticCaptureSource.ts` | Oscillator-driven `CaptureSource` for tests and the browser harness; supports an optional channel map. |
| `GetUserMediaCaptureSource.ts` | Default browser source that wraps `navigator.mediaDevices.getUserMedia` with explicit constraints. |

Tests:

| File | Coverage |
| --- | --- |
| `CaptureChannelMap.test.ts` | Identity / swap / mono-from-channel / `apply` / `applyInPlace` / validation. 9 cases. |
| `CaptureSourceTypes.test.ts` | `mismatches()` reports sample-rate / channel-count / auto-processing drift; `toLongRecordingSource()` projects metadata correctly. 6 cases. |

15 capture-source tests, all hardware-independent.

## The `CaptureSource` Contract

```ts
interface CaptureSource extends Terminable {
  readonly metadata: CaptureSourceMetadata
  readonly outputNode: AudioNode
  subscribeContinuity(observer): Subscription
  subscribeErrors(observer): Subscription
}
```

A capture source is "the thing that produces audio." It exposes:

- An `AudioNode` to wire into the recording graph. Callers connect it to the `LongRecordingWorklet` directly.
- A frozen `CaptureSourceMetadata` snapshot with both **requested** and **actual** values for sample rate and
  channel count, plus echo-cancellation / noise-suppression / AGC flags, device label, and (where applicable)
  device id. Mismatches are surfaced through `CaptureSourceMetadata.mismatches()` so callers can warn the user
  about implicit resampling, channel clamping, or browser audio processing.
- Continuity and error notifiers (`subscribeContinuity` / `subscribeErrors`) reserved for future drop / underrun
  / native-error reporting. They are wired but never fire for `SyntheticCaptureSource` /
  `GetUserMediaCaptureSource` today, because browser sources don't surface drop counters; Phase 4 (or a later
  optional native path) would populate them.

`CaptureSourceMetadata.toLongRecordingSource(metadata)` returns the exact shape `LongRecordingSession` needs for
its `source` field, so wiring the two is one line.

## Channel Mapping

`CaptureChannelMap` is a `ReadonlyArray<int>` where the array index is the **output** channel and the value at
that index is the **source** channel to copy from. Examples:

```ts
CaptureChannelMap.identity(2)              // [0, 1]   — stereo unchanged
CaptureChannelMap.swap(0, 1)               // [1, 0]   — flip left/right
CaptureChannelMap.monoFromChannel(7)       // [7]      — pick channel 7 as mono
[2, 5]                                     // ch2→L, ch5→R for a multichannel interface
```

Two consumption styles are provided:

- Pure functional `apply(sourceChannels, map)` returns reordered `Float32Array[]` aliases (no copy).
- `applyInPlace(source, map, output)` writes into caller-owned destination buffers (no allocation per quantum).

Both capture sources can take an optional `channelMap` constructor argument. When the map is non-identity, the
implementation routes the source through `ChannelSplitterNode → ChannelMergerNode` so the downstream graph sees
exactly the output layout the caller asked for.

## `SyntheticCaptureSource`

`new SyntheticCaptureSource({context, numberOfChannels, label?, baseFrequencyHz?, amplitude?, channelMap?})` creates
`numberOfChannels` `OscillatorNode`s, each at `baseFrequencyHz × (channelIndex + 1)`, wired through gain stages
into a `ChannelMergerNode`. Used by the browser harness so we can verify the recording pipeline without microphone
permission.

Metadata always reports `kind: "synthetic"`, with `requested === actual` for sample rate and channel count
(synthetic content can never desync from the requested layout).

## `GetUserMediaCaptureSource`

`GetUserMediaCaptureSource.open({context, requestedChannels, deviceId?, echoCancellation?, noiseSuppression?,
autoGainControl?, channelMap?})` opens a `MediaStream` with the requested constraints (defaulting all browser
audio processing to `false`), inspects `track.getSettings()` and `track.label`, and exposes:

- `actualSampleRate` = `track.getSettings().sampleRate ?? context.sampleRate` (which is what
  `MediaStreamAudioSourceNode` actually feeds into the graph).
- `actualChannels` = `track.getSettings().channelCount ?? requestedChannels`. The implementation respects whatever
  the browser hands back, even if it exceeds 2 — the historic `CaptureAudio` clamp to mono/stereo is **not**
  applied here.
- `echoCancellation`, `noiseSuppression`, `autoGainControl` from the resolved settings, so the harness or future
  UI can detect that the browser overrode the explicit `false` we passed in.

Callers can supply an `channelMap` to route specific source channels into a custom output layout. This is the
recommended way to expose multichannel interfaces: ask for as many channels as the device claims, then map the
ones you actually want into your recording layout.

## Browser Verification

`/podcast-recording-test` (the Phase 1 harness) is the integration test. It now:

1. Constructs a `SyntheticCaptureSource` instead of building oscillators inline.
2. Logs `CaptureSourceMetadata` and runs `CaptureSourceMetadata.mismatches(metadata)` to surface drift.
3. Feeds `LongRecordingSession.source` directly from `CaptureSourceMetadata.toLongRecordingSource(metadata)`,
   so the manifest's `source.requestedSampleRate / actualSampleRate / requestedChannels / actualChannels` are
   derived from the same place the audio graph sees them.

The end-to-end loop is now: `CaptureSource` → `outputNode.connect(LongRecordingWorklet)` →
`RecordingProcessor` → `RingBuffer` → main thread → `LongRecordingSession.appendQuantum` → OPFS chunk +
overview + manifest. Switching from synthetic to `getUserMedia` is a one-line change (`new SyntheticCaptureSource`
→ `await GetUserMediaCaptureSource.open`); the rest of the pipeline is identical.

## Multichannel Browser Capability — Evaluation

Phase 3 deliberately does **not** clamp to mono/stereo at the capture-source layer. The classification from
Phase 0 stands and is now actionable:

| Capability | Status | Notes |
| --- | --- | --- |
| Mono / stereo via `getUserMedia` | **usable** | Default path. Browser-agnostic. |
| 3+ channels exposed by browser (e.g. ZOOM L-12 over native USB-class audio) | **partial / browser-dependent** | Recent Chromium gates this behind explicit `channelCount` constraints and "isolated devices"; Firefox passes through for some devices; Safari historically clamps. The capture-source layer no longer fights this — if the browser exposes N channels, the source reports N. |
| Channel-to-track mapping | **implemented** | `CaptureChannelMap` plus the splitter/merger wiring in both source impls. |
| Channel order stability | **device-dependent, observable** | `track.getSettings().channelCount` and label are captured in metadata; `track.label` lets the harness/UI surface the underlying device. |

Concrete recommendation:

- **Default path stays browser `getUserMedia`** with `channelCount: {ideal: requestedChannels}`. Mono and stereo
  podcast workflows go through this with zero ceremony.
- **Multichannel host-hardware path** is opt-in: request `requestedChannels: <N>` and supply a `channelMap` if
  the order doesn't match the project's track layout. This is enough to drive a ZOOM L-12 or a virtual loopback
  in browsers that expose ≥3 channels.
- **Hardware verification** (ZOOM L-12, virtual multichannel routes) remains a manual check per the plan; the
  browser harness can be repointed at `GetUserMediaCaptureSource.open(...)` with a known `deviceId` for ad-hoc
  validation. No new dependencies are needed for that step.

## Why No `try/catch`

`GetUserMediaCaptureSource.open` follows the project rule (no inline `try/catch`) by using `Promises.tryCatch`
and re-throwing on failure so callers see a real rejection. Errors from a live stream are surfaced through the
`subscribeErrors` channel.

## Open Items

- A future PR can plumb a real `CaptureSource` continuity reporter for `getUserMedia` (e.g. observing
  `MediaStreamTrack.onmute` / `onended` / `applyConstraints` to detect re-config). The notifier is wired today;
  populating it is data-driven.
- Bridging the existing `CaptureAudio` to `CaptureSource` so all recording paths go through the same abstraction
  is left for a follow-up. The existing musical-take path keeps working unchanged; only the long-recording path
  uses `CaptureSource` so far.

## Acceptance Check (Phase 3)

| Acceptance criterion (from plan §"Phase 3") | Where it is satisfied |
| --- | --- |
| Capture-source interface around stream metadata, audio blocks, channel mapping, errors, continuity | `CaptureSource`, `CaptureSourceMetadata`, `CaptureChannelMap`, `subscribeContinuity`, `subscribeErrors`. |
| `getUserMedia` kept as the first implementation | `GetUserMediaCaptureSource.open` is the default. The harness's synthetic source is for tests; production code uses `GetUserMediaCaptureSource`. |
| Reports requested vs actual sample rate / channel count | `CaptureSourceMetadata` carries both; `mismatches()` surfaces drift; harness logs them and forwards to the manifest's `source` block. |
| Channel-to-track mapping for >2-channel devices | `CaptureChannelMap` + splitter/merger routing in both capture-source impls. |
| Evaluation of multichannel browser capture | This document, §"Multichannel Browser Capability — Evaluation". Default stays mono/stereo; multichannel is opt-in via `requestedChannels` + `channelMap`. |
