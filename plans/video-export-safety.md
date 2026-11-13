# Video export safety

Round 88 implementation uses Codex to add focused synthetic regression fixtures,
then change the existing exporter and renderer. No production audio or browser
profile is used. Lifecycle tests fake WebCodecs and mediabunny; renderer fixtures
use deterministic stereo tones and silence. Local build, lint and test gates
validate the final branch. External cross-family review is left to the clerk.

## Admission

Video dimensions must be positive even integers, at most 4096 per side and
8,294,400 pixels in total (all existing presets fit). Supported video rates are
30, 60 and 120 fps. Audio accepts 1–2 channels at integral rates from 8000 to
192000 Hz. Video bitrate is at most 32 Mbit/s, audio at most 512 kbit/s.
Duration zero selects automatic completion. Explicit duration must be finite,
positive and at most 3600 seconds; work is limited to 432,000 video frames.
Admission runs before canvases, encoders or file creation.

Each submitted frame requires finite, nonnegative, strictly increasing video
timestamps and exactly the configured audio channels. Channel planes must have
equal lengths of at most one second. At low audio rates, a video tick whose
audio budget is already covered by a previous quantum submits video with empty
channel planes and creates no native audio wrapper. Malformed geometry is rejected
before either media source receives data. Samples retain planar channel order.

## Audio clock and automatic duration

Audio timestamps use cumulative submitted samples, independently of video frame
indices. The offline renderer retains its quantum overshoot in the next frame's
sample budget; samples are neither repeated nor discarded. Native AudioData
represents the cursor rounded to the nearest microsecond; AudioSample.setTimestamp
retains the precise seconds derived from the sample cursor for muxing.

Automatic duration preserves the complete arrangement, including silent gaps.
Tail silence is counted only after the final scheduled region. Empty/silent
projects finish within ten seconds after the arrangement end. All automatic
tails, including sustained effects, are capped at ten seconds. Automatic projects
whose arrangement plus tail exceeds the one-hour work limit are refused; use an
explicit shorter duration. Explicit duration ignores silence.

## Native resource ownership

Encoder construction owns its output and sources until start succeeds. Failed
track creation, codec probing or output startup closes acquired sources and
cancels the muxer. Each created AudioData and AudioSample closes in a finally
boundary, including failed sample construction or source submission. AudioSample
owns its input AudioData; the outer finally checks the native format so transferred
data is not closed twice. Cleanup
attempts do not replace the original encoding error.

## Abort and partial setup

Abort is a terminal, idempotent exporter transition: later frame/finalize calls
are refused and a late finalization cannot save buffered output. Streaming
exports retain a writer owned by the attempt: muxer cleanup cannot commit a
partial file, and abort discards it. A successful finalize alone closes the file.
The render copy, offline engine, shader state/runner, WebGL context, overlay and
progress dialog unwind independently on failure, including partial setup.

Mediabunny 1.45.4's public Output.cancel() releases active encoders, but is a
no-op once Output.finalize() has begun. Cancellation still retires the attempt,
discards its writable and suppresses late buffered saves. Native resources in
that finalizing phase can only finish when the library's pending flush settles;
there is no public force-close API for this phase. No private library fields are
used. This limitation remains for external review.

## Startup and active cancellation

Encoder initialization has a ten-second deadline. Its AbortSignal reaches codec
probing and output startup; acquired muxer/writer owners retire on cancellation
or refusal. A late initializer cannot transfer ownership or publish a file.
All pending promise rejections remain observed. A writable acquired late is
aborted rather than handed to an already retired attempt.

Cancel immediately retires the exporter, stops/terminates the offline engine,
releases acquired render resources and closes the progress dialog. Rendering
settles even if a step, backpressure, finalize or cleanup promise never settles.
Late results cannot continue the render or save buffered output. Expected user
cancellation does not open an error notification. Native audio wrappers close
promptly when a pending add is interrupted. The finalizing library limitation
above still applies to the underlying native flush; cancellation cannot undo a
file commit/download that has already been started.

## Buffered output and optional overlay

Without the direct file picker, duration must have a resolved positive upper
budget. Admission uses `(video bitrate + audio bitrate) × seconds / 8`, with
25% headroom and 1 MiB for metadata, and refuses budgets over 256 MiB. The
upper duration includes the automatic ten-second tail. Use a shorter export or
Chrome's direct file streaming for larger output.

A public Mediabunny StreamTarget writes into seekable bounded storage instead of
BufferTarget. Actual output offsets plus bytes may never exceed 256 MiB; crossing
the ceiling retires the export and cannot call Files.save. Header rewrites replace
bytes rather than retaining copies. This is an encoded-output limit, not a total
browser-memory guarantee: canvas/codec memory and temporary buffer copies also
need room. Tests use a sixteen-byte ceiling and a one-byte over-budget target
write, without allocating a large output file.

Disabled overlays do not create VideoOverlay or fetch/decode cover.png. Enabled
asset loads have a ten-second deadline covering fetch, body and bitmap decoding,
check HTTP success and observe cancellation. A late bitmap is closed. Asset
refusal/timeout uses the same render cleanup and controlled export error path.

## Round 88 validation and remaining review boundary

The six bundles were implemented in brief order on a fresh ephes/openDAW main
checkout (`73e54ebb`). All twelve scout scopes still applied. Each bundle's new
regressions was run against the preceding implementation and failed before its
fix; the geometry, native ownership/precision and low-rate quantum follow-ups
also have recorded red runs. Logs are retained outside the clone in the worker's
coordination log directory. Tests use synthetic data only.

The local gate is Node >=23, `npm ci --ignore-scripts`, `npm run build`, then
`npm run lint` and `npm test`. Focused validation also runs studio TypeScript
and lint checks. Fixtures cover fake codec lifecycle failures, one second of
stereo through renderer/exporter, and real Mediabunny MP4 target finalize/abort.
No native browser codec/decode smoke test is claimed.

The active muxer cancellation portion of B04 is implemented. Hard interruption
of a native flush already inside Mediabunny finalize remains unresolved: a probe
of the installed public API observes `finalizing` after cancel, then `finalized`
after the deferred finalization is released. Supporting hard cancellation there
requires an upstream public lifecycle change or an alternative encoder owner;
that portion is parked for the clerk/owner, not claimed complete. Other bundles
have no owner decisions. The feature branch is for external review and merge;
no Claude command, Actions wait, release or default-branch push is part of this
worker closeout.
