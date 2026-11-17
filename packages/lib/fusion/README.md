_This package is part of the openDAW SDK_

# @opendaw/lib-fusion

Web-based audio workstation fusion utilities for TypeScript projects.

## File System Operations

* **OpfsWorker.ts** - Origin Private File System worker implementation
* **OpfsProtocol.ts** - OPFS communication protocol definitions

## Audio Visualization

* **Peaks.ts** - Audio peak data management and processing
* **PeakWorker.ts** - Web Worker for peak generation
* **PeakProtocol.ts** - Peak data communication protocol
* **PeaksPainter.ts** - Canvas-based peak visualization rendering

## Live Audio Streaming

* **live-stream/** - Directory containing live audio stream processing utilities

## Core Types

* **types.ts** - Type definitions for fusion operations

OPFS writes accept `Uint8Array` subviews and store only the supplied byte range, including empty views.
Reads and writes complete short transfers using explicit offsets and reject zero progress; handle closure is always attempted.
`exists` treats empty files as absent. Missing entries normalize to `false`/an empty listing/a no-op deletion;
permission, access-state and other operational errors reject through the protocol.
Leading/trailing slashes are aliases. Empty internal segments, dot segments, NUL
and backslashes are refused before storage access. All operations share one FIFO
worker queue, including reads/listings and recursive parent/root deletion. A
completed child write is therefore followed by a queued deletion, or a later
write recreates the subtree after deletion. Exclusion covers this worker only.

`read(path, maxBytes?)` defaults to 64 MiB. The budget must be a nonnegative safe
integer; the opened handle's size is checked before allocating or reading.
`OpfsProtocol.ReadLimits` provides Metadata (1 MiB), Project (64 MiB), Preset
(16 MiB) and Media (1 GiB) budgets. Studio metadata, indexes and journals use
Metadata, project/recovery graphs use Project, and sample/soundfont binaries use
Media explicitly. Inference uses its existing 512 MiB model limit and Metadata
for its sidecar. Oversized files reject through normal load/recovery paths.
Closing each opened handle is attempted. A close-only failure rejects; a simultaneous
operation/close failure is an AggregateError whose cause and first error are the
original operation failure, with bounded secondary cleanup context. Queue slots
are released in every case.

### Sample peak format

Short/empty samples may have no stages; nearest-stage lookup then returns null and
audio remains usable. Partial buckets at every stage include the final extrema.
Serialization accepts Int32Array views and stores only the logical view bytes.
The existing PEAKS format validates ordered shifts (0–30), contiguous stage offsets,
frame/bucket counts, matching channel counts bounded by the complete input, complete aligned byte
lengths and input bounds before allocation. Invalid stored files use the existing
sample recovery/regeneration path. No binary format version change.

Preferences fall back to schema defaults when storage discovery or reads fail,
with one bounded diagnostic and no writes through the unavailable storage. Valid
persisted sections survive schema changes. Queued facade updates coalesce to the
latest settings and only reach the current host binding; replacement, release and
termination invalidate already queued work. Run `npm test --workspace=@opendaw/lib-fusion`
after the root build for synthetic storage and microtask lifecycle regressions.

`PreferencesHost.syncWith` owns its outbound source subscription and RPC sender.
Unsubscribing retires the owner before releasing either subscription, so queued
microtasks cannot send afterward. Host termination retires all active syncs and
later sync attempts are inert. Active syncs still send an initial snapshot and
coalesce changes to the latest settings once per microtask.

Live stream subscription handles belong to one registration generation. Each
package dispatch uses a stable listener snapshot; additions affect the next
frame, removals apply at once. See [live stream contracts](src/live-stream/README.md).

Receiver disconnect also releases its per-address typed-array cache; reconnects
never reuse payload arrays from an earlier connection.
