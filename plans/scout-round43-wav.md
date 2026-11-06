# Scout round 43: WAV correctness

Implemented with Codex and reviewed through the Claude review harness. Synthetic RIFF fixtures exercise
chunk bounds, frame dimensions, odd ancillary chunks and PCM/float decoding. Encoder boundary tests intercept
ArrayBuffer allocation so no multi-gigabyte sample/output is created. Shared size arithmetic runs before
channel retrieval. Public signatures and classic RIFF output formats are preserved.

Unreleased notes must be folded into the next generated package release entry when releasing.

First review: one Warning about compatibility with malformed trailing metadata and two Suggestions.
The compatibility claim is rejected: the owner explicitly requires validating RIFF and chunk bounds, including
out-of-bounds/truncated chunks. Existing synthetic regressions verify those rejections and valid odd ancillary
chunks decode. No evidence establishes malformed-metadata tolerance as a supported contract.
Accepted the Suggestion to assert allocation has not occurred for all named pre-allocation cases.
Declined a typed-array float fast path: no measured performance regression; DataView is the requested portable
little-endian implementation. No endian/platform assumptions enter tests.

Second review: CLEAN, no Critical/Warning/Suggestion findings. DSP tests (136), test TypeScript,
SDK dependency builds and root tests pass. Root lint remains blocked by the independently verified main
baseline; keep the three WAV fixes on this feature branch until lint is repaired.
