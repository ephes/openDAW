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
