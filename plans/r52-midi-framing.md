# MIDI framing and round trips

Scope: enforce declared track spans and header counts, bound VLQs to four bytes,
consume F0/F7 payloads exactly while retaining deltas, and terminate exported tracks.
Fixed-size meta lengths are checked at their parser entry point. Multitrack exports
use format 1 so they satisfy the checked header contract. The existing encoder's
channel/event support is unchanged.

Implementation was assisted by Codex, with independent Claude harness review.
The test command now runs Vitest instead of a no-op. Fixtures contain only synthetic
bytes and note events, with assertions on parser positions, absolute ticks and encoded
chunk lengths. Before the repairs, 26 of 41 tests failed. Package README and Unreleased
notes describe supported timing, error behavior and export termination.

The first review identified overstrict handling of extension chunks. The repair skips
only validated chunk spans without counting unknown chunks as tracks, honors longer
bounded headers, and reads track counts as unsigned 16-bit fields. Regression fixtures
cover extensions before/between tracks, invalid spans, missing tracks and extended headers.
