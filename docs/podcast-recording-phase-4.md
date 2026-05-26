# Podcast Recording — Phase 4: Native / Multichannel Host Path (Evaluation)

This document records the explicit Phase 4 evaluation called for by the goal: "Treat Phase 4 as conditional only:
evaluate and document whether it is needed, but do not implement native/multichannel host capture unless Phases
0–3 show browser capture cannot satisfy the accepted scope."

**Decision: defer.** A native/multichannel host capture path is **not** required to satisfy the accepted Phase 0–3
scope. Phases 0–3 already deliver:

- Browser-native long recording with bounded memory and OPFS-backed incremental writes (Phase 1).
- Project/timeline representation with tempo-independence and waveform overview (Phase 2).
- A capture-source abstraction that keeps `getUserMedia` as the default, reports requested vs actual stream
  parameters, and supports channel mapping for browsers that expose >2 channels (Phase 3).

The remainder of this document records the criteria considered, the evidence weighed, and the conditions under
which Phase 4 should be promoted from deferred to required.

## Criteria For Promotion

Phase 4 should be **required** only if at least one of the following is true:

1. **Browser capture cannot expose multichannel hardware reliably.** If `getUserMedia` on supported Chromium /
   Firefox / Safari can never expose >2 channels for the targeted devices (ZOOM L-12 class), then a native bridge
   is the only way to ingest multichannel host audio.
2. **Browser capture introduces drops that are invisible from the JS side.** If `MediaStreamTrack` does not
   report drops, underruns, or invalid blocks for these devices, recordings could be silently incomplete and the
   user has no recourse other than a native counter.
3. **Browser capture is rate-unstable under realistic CPU load.** If `AudioContext.sampleRate` cannot be held
   stable for hour-long sessions, the recording's "actual" sample rate becomes a fiction and per-chunk timing
   drifts.

Plain mono/stereo podcast recording — the explicit upstream first-slice direction — does not require any of the
above. It works on any browser that supports `AudioWorklet` + OPFS, which is the union of supported targets for
openDAW Studio today.

## Evidence Considered

### From Phase 0 baseline

`docs/podcast-recording-baseline.md` Section 3 (Browser Capture Capability — Known State) lists the platform
matrix. The Phase 3 evaluation (`docs/podcast-recording-phase-3.md` §"Multichannel Browser Capability —
Evaluation") confirmed that mono/stereo is fully supported, and that >2 channels are browser-dependent but not
zero on Chromium today. No criterion above is **clearly** met by the browser path; the worst case is "multichannel
is browser-dependent," which §"Promotion Conditions" below addresses without resorting to a native backend.

### From the native bridge PoC

The PoC at `../opendaw-native-audio-poc/` already established that a desktop fallback is **technically feasible**:

- 14-channel `f32` input at 48000 Hz over CoreAudio/cpal.
- 779.4 s validated recording with zero continuity errors, zero dropped blocks, zero dropped frames.
- Manifest inspection passes; the chunked storage shape used in Phase 1 is compatible with the same kind of
  payload.

So **if** Phase 4 were ever promoted, the wire shape from the PoC (`stream-started` metadata, 16-byte chunk
headers, `native-input-stats`, `stream-error`) maps cleanly onto the existing `CaptureSource` interface. The
required adapter is essentially:

- A new `NativeBridgeCaptureSource` implementation that owns a `WebSocket` (or postMessage transport) to the
  local bridge, pumps Float32 blocks into a buffer, and exposes the same `outputNode` + metadata + continuity
  / error notifiers.
- No change to `LongRecordingSession`, `LongRecordingStorage`, `LongRecordingManifest`, or
  `LongRecordingWorklet`. The whole point of Phase 3 was to make the source pluggable.

### From the plan's stated non-goals

`plans/podcast-recording.md` §"Non-Goals For The First Slice" explicitly lists "Native CoreAudio/cpal integration
inside openDAW" as out of scope. The goal of this work was a storage-safe long recording path, not a hardware
backend. Phase 4 would broaden the diff well beyond what is needed to ship the issue.

## Conditions To Revisit

Re-open Phase 4 if any of these happen:

| Trigger | Action |
| --- | --- |
| A real user demonstrates that Chromium on macOS cannot expose ≥3 channels for the ZOOM L-12 (or equivalent) even with the Phase 3 `GetUserMediaCaptureSource` and a `channelMap`. | Promote Phase 4. Implement `NativeBridgeCaptureSource` reusing the PoC's wire shape. |
| Browser recording exhibits silent drops that the user observes but `getUserMedia` does not surface. | Promote Phase 4 for **observability** even if multichannel works (the native path's `native-input-stats` is the differentiator, not the channel count). |
| A long session shows audible pitch drift attributable to `AudioContext.sampleRate` instability under load. | Promote Phase 4 with the native bridge providing a stable clock domain. |

Until one of those is documented with reproducible evidence on real hardware, the recommendation stands:
**stay browser-only.** Hardware-dependent checks (ZOOM L-12, virtual loopbacks) remain manual per the plan and
do not block this slice.

## Acceptance Check (Phase 4 — conditional)

| Acceptance criterion (from plan §"Phase 4" / goal) | Where it is satisfied |
| --- | --- |
| Phase 4 explicitly evaluated and either deferred with evidence or promoted only if required by accepted scope | This document. Decision: defer. |
| If promoted: concrete reason such as browser capture exposing only mono/stereo or unstable channel mapping | Not promoted. Reasons documented under §"Conditions To Revisit". |
| If promoted: preserves channel order and uses explicit channel-to-track mapping | Not implemented. Existing `CaptureChannelMap` already provides the shape a future implementation would use. |
| If promoted: reports native drop counters and stream continuity warnings | Not implemented. `CaptureSource.subscribeContinuity` / `subscribeErrors` are the integration points. |
| If promoted: does not replace the OPFS-backed podcast media model | Not implemented. The model is intentionally storage-source independent (Phase 1–2). |
