# Podcast Recording Foundation Evidence

This folder archives the completed Phase 0–3 implementation evidence plus the Phase 4 deferral evaluation for
`plans/podcast-recording.md`.

The active planning entry point is `plans/podcast-recording.md`; active planning continues there with the
product-integration target. These notes explain what has already been implemented, verified, or evaluated:

- `baseline.md` — Phase 0 recording-path baseline, memory/finalization risks, and first storage decision.
- `phase-1-opfs.md` — OPFS-backed chunk recording, manifest recovery, and browser verification harness.
- `phase-2-media.md` — tempo-independent media reference, waveform overviews, and project bundle round trip.
- `phase-3-capture-source.md` — capture-source abstraction, getUserMedia/synthetic sources, and channel mapping.
- `phase-4-evaluation.md` — conditional native/multichannel host-path evaluation and deferral criteria.
- `product-integration-spec.md` — active spec: how the long-recording foundation plugs into the normal
  openDAW workflow (per-track toggle, lazy Peaks/AudioData adapter, Dashboard recovery panel).
- `product-integration-plan.md` — step-by-step implementation plan derived from the spec.
- `product-integration.md` — closure note for the implemented MVP, including exact verification commands.

Keep new product-integration planning in `plans/podcast-recording.md` unless a completed slice needs its own
evidence note.
