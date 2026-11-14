# Video export safety

Limits and lifecycle of the studio's video export (`packages/app/studio/src/video/`).
Tests fake WebCodecs and Mediabunny and use deterministic synthetic audio.

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

Automatic duration preserves the complete arrangement, including silent gaps,
and then renders a fixed ten-second tail for sustained effects. Empty/silent
projects therefore finish ten seconds after the arrangement end, and longer
tails are cut at ten seconds; there is no early stop on silence. Automatic projects
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
upper duration includes the automatic ten-second tail. That allows about 209 s
in total at the Medium preset (8 Mbit/s), about 106 s at the default High preset
(16 Mbit/s) and about 53 s at Very High (32 Mbit/s); subtract the tail for
automatic duration. Use a lower quality preset, a shorter export or Chrome's
direct file streaming for larger output.

Every refused configuration (geometry, rate, duration, the one-hour work limit
or the buffered budget) is shown as a "Video Export Failed" notice; the export
never silently does nothing.

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

## Known limitation: finalize cancellation

Cancelling stops active muxers and fences retired exports. A native flush that is
already inside Mediabunny's `finalize` cannot be interrupted through its public
API: after cancel the output still reports `finalizing`, then `finalized` once the
deferred finalization completes. The result is never saved. Hard interruption
there needs an upstream public lifecycle change or a different encoder owner.

## Validation

Node >=23: `npm ci --ignore-scripts`, `npm run build`, then `npm run lint` and
`npm test`. Fixtures cover fake codec lifecycle failures, one second of stereo
through renderer/exporter, and real Mediabunny MP4 target finalize/abort. No
native browser codec/decode smoke test is claimed.
