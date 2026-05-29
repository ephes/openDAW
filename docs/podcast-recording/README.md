# Podcast Recording Foundation Evidence

This folder archives the completed Phase 0–3 implementation evidence plus the Phase 4 deferral evaluation for
`plans/podcast-recording.md`.

The active planning entry point is `plans/podcast-recording.md`; active planning continues there with the
product-integration target. These notes explain what has already been implemented, verified, or evaluated:

- `baseline.md` — Phase 0 recording-path baseline, memory/finalization risks, and first storage decision.
- `phase-1-opfs.md` — OPFS-backed chunk recording, manifest recovery, and browser verification harness.
- `phase-2-media.md` — tempo-independent media reference, waveform overviews, and project bundle round trip.
- `phase-3-capture-source.md` — capture-source abstraction, getUserMedia/synthetic sources, and the
  channel-mapping *library capability* (not wired into the production recorder — see note below).
- `phase-4-evaluation.md` — conditional native/multichannel host-path evaluation and deferral criteria.
- `product-integration.md` — **source of truth** for what actually shipped, including exact verification
  commands. Read this first; it overrides the historical design docs below where they disagree.
- `product-integration-spec.md` — **historical design doc, superseded.** Describes an earlier swap-based
  loader design that was not built. See its header banner and `product-integration.md` for the shipped design.
- `product-integration-plan.md` — **historical task breakdown, superseded.** Some listed tasks were
  descoped or implemented differently. See its header banner.

> **What shipped vs. what these docs originally described.** The production sample-loader fallback does
> **not** swap loaders; it keeps the original `DefaultSampleLoader` and attaches overview peaks immediately
> while deferring (lazy) the full `AudioData` materialization until a consumer calls
> `SampleLoader.requestData()` (the playback/export path); subscribing for repaint does not materialize
> (`DefaultSampleLoader.setPeaksReady`). Production recording captures mono/stereo via `WrappingCaptureSource`
> over the existing `recordGainNode`; the `CaptureChannelMap` routing is a library/harness capability and is
> **not** wired into the production recorder (multichannel remains Phase 4, deferred).

Keep new product-integration planning in `plans/podcast-recording.md` unless a completed slice needs its own
evidence note.
