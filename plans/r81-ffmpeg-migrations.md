# FFmpeg and legacy migration boundary checks

Round 81 implementation uses synthetic Node streams and fake FFmpeg instances;
legacy graph fixtures use generated boxes and real serialization/adapters. No
runtime assets, user projects or browser/platform-specific codecs are required.
Changes are implemented with Codex. Validation uses the local build, lint and
test commands and a separate Claude review gate.

## Initialization ownership (O1)

Concurrent FFmpeg loads share one pending initialization and retain the successful
worker. A rejected startup permits retry. Startup owns both blob URLs until load
settles, then revokes them; failure terminates the unpublished instance while
preserving its primary error.

## Download bounds and conversion ownership (O2)

The mirrored single-threaded core has separate limits: JavaScript 2 MiB, WASM
40 MiB (the 0.12.6 distribution is approximately 112 KiB and 31 MiB). One
120-second deadline covers downloads and initialization. Missing Content-Length
is supported within the actual-byte limit; invalid sizes, empty/truncated bodies,
overflow and stalled startup refuse with cancellation before buffer assembly.
For compressed responses, encoded Content-Length is ignored; the decoded-byte
limit still applies. These limits apply only to the two known runtime assets, not user audio.

Every MP3/FLAC conversion queues on its owning worker. Reading input, progress
subscription, VFS writes, execution, output reads and cleanup all remain within
one operation. Rejection releases the queue. A terminated cached worker can be
loaded again. O1 and O2 are reviewed/merged together because sharing the worker
requires this conversion ownership.
