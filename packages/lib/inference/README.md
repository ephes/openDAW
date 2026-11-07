# @opendaw/lib-inference

In-browser ML inference for openDAW. Lazy-loaded ONNX runtime plus a
registry-driven task surface (stem separation, pitch estimation,
audio-to-MIDI, etc.).

Not yet part of the public SDK. See `plans/onnxruntime.md` for the
design.

## Quick start

Once at app boot, plug in the OPFS provider:

```ts
import {Inference} from "@opendaw/lib-inference"
import {Workers} from "@opendaw/studio-core"

Inference.install({opfs: Workers.Opfs})
```

Then anywhere in the studio:

```ts
const stems = await Inference.run("stem-separation",
    {audio: float32Channel, sampleRate: 44100},
    {progress: (value) => console.log(`progress: ${(value * 100).toFixed(0)}%`)})
```

The first call downloads the model (cached in OPFS) and spins up the
inference worker. Subsequent calls reuse both.

## Structure

- `src/index.ts` — public API (`Inference.run`, `Inference.acquire`).
- `src/registry.ts` — task registry; one entry per task.
- `src/tasks/` — task definitions (model URL, pre/post-processing).
- `src/ModelStore.ts` — OPFS-cached model download with SHA-256
  verification.
- `src/EngineHost.ts` — main-thread side, owns the worker and
  serialises calls.
- `src/workers/inference.worker.ts` — worker side, owns the ORT
  session per task.

### Host failures and shutdown

Each queued job settles independently, including synchronous callback failures. A
worker error or messageerror rejects its pending calls, removes its listeners and
invalidates session names; a later load may create a fresh worker. Startup failures
release readiness ownership rather than caching rejection. Shutdown is terminal for
that host: active/queued callers reject, new work rejects, and worker termination
bounds cleanup without waiting for an acknowledgement. Reinstall creates a new host.

The inference browser baseline requires the standard `AbortSignal.any` and
`AbortSignal.throwIfAborted` APIs. Worker failures retain at most 300 characters of
startup/runtime message detail alongside retry guidance.

### Shared session ownership and cancellation

Concurrent loads of one task share one operation; different tasks remain independent.
Each caller can cancel its own wait, preserving its abort reason. Shared loading
continues while another waiter remains. The last cancelled waiter aborts the shared
download; no worker is created afterward. Already dispatched ONNX session creation
cannot be forcibly interrupted; its result remains releasable/cached on the host. The
first caller receives download progress while active; joining callers receive terminal
progress. Release waits behind queued runs and session creation; worker messages for
one task execute in order, and disposal finishes before a replacement is created.
A preload concurrent with a release that has not yet begun may observe the current
session; await explicit release before requesting a guaranteed replacement.
Cancellation checks surround awaited inference and successful result/progress
publication. They do not claim to forcibly interrupt ONNX computation.

Cancellation is an API contract change: failures now preserve `AbortSignal.reason`
(including default AbortError), rather than constructing InferenceCancelledError.
That legacy error export is deprecated. Compare failures with the caller's
`signal.reason`. Concurrent same-task loads use the first model/provider selection;
await release before switching descriptors/providers. Release after a failed load
is a no-op; disposal failures from a loaded session still reach explicit callers.

### Model cache and transfer limits

`isCached` is a metadata/existence probe; `ensure` checks metadata shape, byte length
and the SHA-256 of the actual returned cached bytes. Corruption triggers a verified
download. Downloads have a 512 MiB actual-byte ceiling and a one-hour default whole-transfer
deadline, combined with caller cancellation. Content-Length/model.bytes are progress
hints, not exact-length requirements. Tests can lower `maxBytes` and `timeoutMs`;
the byte option cannot raise the intrinsic byte ceiling. Install configuration
`modelDownloadTimeoutMs` may raise the deadline for slow links, up to a finite
24-hour ceiling; per-transfer `timeoutMs` uses the same ceiling. Failed transfers cancel/release
the reader and never publish a cache entry.

HTTP download failures retain bounded status text and the model origin/path, with
URL credentials, queries and fragments excluded from diagnostics. Cached reads
are hashed directly without an additional full-model copy.

Download limits are checked before transfer; invalid nonpositive/nonfinite limits
fail then. Deadline settings greater than 24 hours are clamped to that ceiling.
