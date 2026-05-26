# Podcast Recording Plan

Issue: <https://github.com/andremichelle/openDAW/issues/245>

## Summary

The first useful openDAW contribution for podcast recording is not a native capture backend or a full remote-recording
product. It is a storage-safe long-recording path:

- Record long audio without retaining the full take in memory.
- Persist recording data incrementally, preferably in OPFS.
- Make interrupted recordings inspectable and recoverable.
- Represent podcast media as tempo-independent audio.
- Keep browser `getUserMedia` as the default input path.
- Treat native or multichannel capture as an optional later host-workstation path.

This keeps the first slice small enough for upstream review and still addresses the core issue: current openDAW recording
is designed for ordinary musical takes, not multi-hour spoken-word sessions.

## Current openDAW Recording Shape

The current browser recording path is a good baseline for short captures:

- `CaptureAudio` (`packages/studio/core/src/capture/CaptureAudio.ts`) uses `getUserMedia`, disables browser echo
  cancellation/noise suppression/AGC, and builds the live audio chain.
- `RecordAudio` (`packages/studio/core/src/capture/RecordAudio.ts`) creates timeline regions while recording and
  finalizes the captured sample when recording stops.
- The `recording-processor` AudioWorkletProcessor writes 128-frame render quanta into a `SharedArrayBuffer` ring buffer;
  main-thread `RecordingWorklet` (`packages/studio/core/src/RecordingWorklet.ts`) reads them through `RingBuffer.reader`.
- `SampleService.importRecording` (`packages/studio/core/src/samples/SampleService.ts`) turns the final `AudioData` into
  a WAV-backed sample and stores it like other audio assets.

The long-recording risks are in the storage and finalization shape:

- `RecordingWorklet` appends every recorded render quantum to `#output`.
- Finalization merges all chunks into a full `AudioData`.
- `SampleService.importRecording` encodes the whole recording as WAV before importing and storing it.
- Peak generation and sample storage currently assume decoded full-frame audio.
- `CaptureAudio` currently clamps the effective stream channel count to mono/stereo.

For a podcast session, this creates two failure surfaces: memory grows during recording, and stop/finalize can allocate
large full-duration buffers exactly when the user expects the recording to become safe.

## Design Principles

- Browser capture remains the default for normal podcast recording.
- Several hours of Float32 audio must not be kept in RAM.
- Recording metadata must be durable while recording is active, not only after a clean stop.
- Recovery states must be explicit: clean, active, abandoned, recoverable, corrupt, or failed.
- Actual sample rate, channel count, duration, and channel order must be stored.
- Podcast recordings should be tempo-independent by default.
- Implicit resampling must surface a warning. A strict podcast mode should require 48 kHz or report why it cannot.
- Native/multichannel capture should plug into the same storage model later, not replace it.
- Hardware-dependent checks stay manual or opt-in; normal automated tests stay browser/hardware-independent.

## Implementation Discipline

- Use TDD where behavior can be isolated, especially for manifest writing, chunk indexing, recovery classification, chunk
  validation, and project media-reference logic.
- Browser-facing recording changes are not complete until verified in an actual browser.
- Do not rely on manual user recording as the only verification path. The first implementation work should establish a
  browser test harness that can exercise recording with a synthetic or fake audio source.
- If the repo has no established browser automation path for this surface, add the smallest harness needed to verify the
  recording path instead of postponing browser verification.
- Hardware-dependent checks, such as ZOOM L-12 or virtual multichannel devices, must remain optional/manual and must not
  be required for normal automated tests.
- A slice is complete only when relevant unit tests, browser checks, documentation updates, and review findings are clean.

## Evidence From Native Bridge PoC

The native bridge PoC in `../opendaw-native-audio-poc/` is useful supporting evidence, but it should not define the first
upstream implementation.

Observed ZOOM LiveTrak L-12 evidence:

- CoreAudio/cpal enumerated `ZOOM L-12 Driver` as 14-channel `f32` input at 48000 Hz.
- A real browser recording validation ran for 779.400 seconds, about 13 minutes.
- Shape: 14 channels, 48000 Hz, 960 frames/block, `f32-interleaved`.
- Recorded: 37,411,200 frames, 38,970 blocks, 32 chunks, about 2.0 GiB.
- Offline manifest inspection passed.
- Continuity errors were zero: gaps, overlaps, discontinuities, channel mismatches, and invalid blocks.
- Native input drops during recording were zero: dropped blocks, frames, and events.
- Monitor overflow and write-backlog warnings remain observability follow-ups, not proof of lost recorded PCM.

Interpretation:

- A desktop/pro-hardware fallback is technically plausible for hosts with large interfaces.
- It does not remove the need for chunked storage, recovery metadata, waveform caching, or project media references.
- It should remain optional until browser capture limits are measured in openDAW itself.

## Local Capture Baseline To Measure

Before implementation, document what browser capture can actually expose on real devices.

Local hardware currently worth testing:

- Direct ZOOM LiveTrak L-12 input.
- A virtual audio device route that maps physical L-12 channels into browser-visible inputs.
- A normal mono/stereo USB microphone or interface as the control case.

The goal is not to make this hardware part of the upstream requirements. The goal is to answer whether browser
`getUserMedia` can expose stable sample rate, channel count, and channel order for the host-hardware case.

Record for each device:

- Device label from `enumerateDevices()`.
- Requested constraints.
- `MediaStreamTrack.getCapabilities()` where available.
- `MediaStreamTrack.getSettings()` after opening.
- Active `AudioContext.sampleRate`.
- Actual channel count reaching the Web Audio graph.
- Whether channels above 2 are visible, stable, and independently meterable.
- Whether channel order can be verified by speaking into known physical inputs.

Acceptance criteria:

- The plan states whether the first upstream slice can stay mono/stereo.
- Multichannel browser support is classified as usable, partial, or not usable for this phase.
- Any virtual-device route is documented as local evidence only, not a dependency.

## Proposed Phases

### Phase 0: Recording Path Baseline

Goal: document current recording limits and choose the first storage primitive.

Tasks:

- Trace `CaptureAudio`, `RecordAudio`, `RecordingWorklet`, `SampleService`, `SampleStorage`, and peak generation.
- Estimate memory growth for mono/stereo recordings at 48 kHz.
- Identify how many full-size copies are created during stop/finalize/import.
- Confirm what happens on tab reload, browser crash, failed finalization, and storage failure.
- Probe browser capture capabilities for sample rate, channel count, and audio-processing settings.
- Discover the repo's preferred browser automation path for recording checks. If none exists, identify the smallest
  browser harness needed for synthetic or fake-source recording verification.
- Decide whether the first implementation modifies existing sample storage or introduces a separate long-recording
  artifact type.

Acceptance criteria:

- A short technical note explains the current memory and finalization failure surfaces.
- The first implementation target is narrowed to a storage primitive, not a broad podcast workflow.
- Browser verification for the recording path is planned before Phase 1 implementation begins.
- No native backend is required.

### Phase 1: OPFS-Backed Long Recording Prototype

Goal: record long mono/stereo audio without retaining the full recording in memory.

Tasks:

- Add a dev-only or experimental long-recording path.
- Request persistent storage before arming.
- Refuse to arm or show a hard error when OPFS is unavailable.
- Write PCM chunks or codec frames incrementally.
- Keep a manifest with recording id, start/stop timestamps, sample rate, channel count, chunk list, frame counts, and
  integrity observations.
- Update the manifest during recording, not only at clean stop.
- Detect and surface corrupt, truncated, or missing chunks during recovery/export.
- Add browser-level verification that records from a synthetic or fake audio source, stops/finalizes, and validates the
  manifest/recovery behavior without requiring user interaction.
- Surface elapsed time, frames, chunks, bytes written, storage persistence, and storage errors.
- Keep automated tests hardware-independent.

Acceptance criteria:

- A long mono/stereo recording can stop without assembling the full recording in RAM.
- A stopped recording has enough metadata to be referenced or exported later.
- An interrupted recording appears as recoverable or failed, not silently lost.
- Corrupt or missing chunks are reported explicitly and are not zero-padded silently.
- The prototype has both isolated tests for recoverable logic and browser verification for the recording path.

### Phase 2: Tempo-Independent Podcast Media

Goal: represent long recordings as timeline media without forcing musical tempo semantics.

Tasks:

- Define how an OPFS-backed recording artifact is referenced by project state.
- Preserve sample rate, channel count, duration, channel order, and source metadata.
- Generate and cache waveform overview data separately from raw media.
- Define how trims, splits, fades, and ripple edits refer back to chunked media.
- Ensure tempo changes do not move or stretch podcast recordings unexpectedly.

Acceptance criteria:

- A recorded podcast source can appear on the timeline without loading all audio frames.
- Project save/load preserves references and metadata.
- Tempo changes do not change the absolute timing of podcast media.

### Phase 3: Capture Source Abstraction

Goal: separate recording storage from capture source details.

Tasks:

- Define a capture-source interface around stream metadata, audio blocks, channel mapping, errors, and continuity/drop
  observability.
- Keep `getUserMedia` as the first implementation.
- Report requested versus actual sample rate and channel count.
- Add channel-to-track mapping for devices that expose more than two channels.
- Evaluate whether multichannel browser capture is usable for common podcast interfaces.

Acceptance criteria:

- openDAW can distinguish capture-source capability from recording storage.
- Normal podcast users continue to use browser capture.
- Later native or virtual-device paths can be evaluated against the same interface.

### Phase 4: Optional Native/Multichannel Host Path

Goal: support professional host hardware only if browser capture is insufficient.

Reference contract from the PoC:

- `stream-started` metadata: sample rate, channel count, frames per block, and sample format.
- Binary PCM blocks: 16-byte header with `frameStart`, `frameCount`, and channel count, followed by interleaved Float32
  PCM.
- `native-input-stats`: dropped callback buffers, dropped frames, drop events, source, bridge queue capacity, and backend
  frame cursor.
- `stream-error`: lag or delivery errors that must be surfaced without synthesizing missing audio.

Acceptance criteria:

- The native path has a concrete reason, such as browser capture exposing only mono/stereo or unstable channel mapping.
- It preserves channel order and uses explicit channel-to-track mapping.
- It reports native drop counters and stream continuity warnings.
- It does not replace the OPFS-backed podcast media model.

## Later Podcast Workflow Ideas

These should not be first-slice requirements, but they are useful once long recording is safe:

- Podcast session templates with host, guest, music/stinger, soundboard, and master tracks.
- A soundcheck panel for mic permission, level, clipping, headphones, sample rate, storage persistence, and duplicate
  input assignment.
- Track roles for host, guest, producer, soundboard, call reference, music, and master.
- A podcast soundboard device.
- Chapter markers and edit markers as timeline objects.
- Ripple edit commands that move chapter markers and transcript anchors with audio edits.
- Cough button or temporary per-track mute.
- Podcast export assistant with loudness target, true peak ceiling, chapters, transcript, and metadata checks.
- LUFS/true-peak analysis, de-esser, voice-chain presets, and final render checks.

## Non-Goals For The First Slice

- Full Ultraschall replacement.
- Remote recording room.
- WebRTC live call.
- Product backend, guest invites, progressive upload, or podcast hosting.
- Auphonic integration.
- Transcript-linked editing.
- Native CoreAudio/cpal integration inside openDAW.
- DAW import automation.
- Production codec decision for all podcast media.
- Hardware-dependent tests (real microphones, ZOOM L-12, Loopback, multichannel interfaces). A synthetic
  browser automation harness for the OPFS recording path is in scope (see Phase 1's
  `scripts/podcast-recording-browser-check.mjs`) and is intentionally hardware-free.

## Open Questions

- Can the existing sample/project model represent large media by reference, or is a new long-recording artifact required?
- Should the first chunks be raw Float32, Int16 PCM, WAV chunks, WebCodecs output, FLAC via wasm, Opus, or raw-then-transcode?
- Where should finalized podcast recordings live in project state?
- What exact recovery states are needed after reload, tab close, browser crash, storage failure, or failed finalization?
- Should strict podcast recording require 48 kHz, or allow other rates with explicit post-processing?
- How far can `getUserMedia` expose multichannel devices in Chromium, Safari, and Firefox?
- How should waveform overview generation work for chunked media?
- How should long recordings interact with existing sample storage, asset sync, and project export?
- How should openDAW Live Rooms relate to podcast media, if at all?

## Immediate Next Step

Post a concise issue comment or open a small planning PR with this document. If the direction is accepted, start with
Phase 0 and then implement the smallest Phase 1 prototype:

Podcast-safe mono/stereo browser recording to OPFS chunks with manifest-based recovery.
