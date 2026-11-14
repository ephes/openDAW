# Sample loading and MIDI export reliability

Round 89 uses synthetic deferred storage, provider and worklet promises to reproduce
sample lifecycle races before changing production code. Codex implements the scoped
fixes and runs local build, lint and test gates. The branch is parked for external
review; no Claude CLI, merge, deployment, release or version bump is involved.

## Manager load outcomes (B1)

Each UUID load owns one attempt. Invalidation replaces that attempt; only the
current attempt may fall back to the API, report progress, start persistence,
publish PCM or remove pending state. A save already started cannot be undone,
but its retired result cannot repopulate the in-memory cache. All readers joining
the same attempt receive its success or error. Retry is explicit via invalidation.
Deferred storage/fetch/peak regressions failed on main before the fix.

## Manager reference ownership (B2)

Each registration releases once and only its own reference-count generation.
Removal/final release retires pending work and settles its readers with
`Sample load retired`. A later owner starts fresh; unregistered `getOrCreate`
callers still retain their ordinary cache until explicit removal. Deferred storage
and peak completions cannot restore evicted cache entries or start a save.
Five added regressions failed before this fix.

## Worklet lifecycle (B3)

Worklet loaders retain their identity across invalidation but clear PCM while
reloading. An attempt counter fences old fetch settlement; removal/termination
retires the loader permanently. A live EngineSampleSource watches client loader
transitions and sends the engine's `invalidateSample` command. Its watches and
pending reads end with the engine. Error/retirement releases client loader PCM.
Terminal DefaultSampleLoader subscriptions remain attached until terminated;
the already-loaded-client variant of the oracle caught and fixed a missing watch.
The real client/worklet manager integration oracle observed stale A before the
reload fix and B afterward. Separate regressions cover retired fulfillment,
retired rejection, repeated removal and out-of-order reloads. Existing playing
voices may finish with the audio captured at their attack; subsequent consumers
read replacement PCM. Offline renders use their initial project snapshot.

## Catalog identity and retry (B4)

Catalog reads coalesce and cache successful results, including genuine empty
catalogs. HTTP, transport and schema failures reject that read and clear the
cached promise so a later explicit read retries. Metadata must match the requested
UUID by bytes before following its asset URL; accepted uppercase spellings are
returned as canonical lowercase UUIDs. Catalog retry/coalescing and UUID binding
regressions failed before the fix; successful empty discovery remains covered.

## Stock transfer limits (B5)

Stock WAV transfers admit at most 64 MiB, checking declared length and actual
bytes before retaining each chunk. A single 60-second timer covers metadata,
header retries and the entire body; trickling bytes do not renew the budget.
Abort reaches both fetch requests and the active reader. Failed readers are
cancelled once and every acquired reader releases its lock. Expired attempts
cannot start later asset requests, retry headers or decode. Successful short WAV,
missing/lying length, overflow, stalled/trickling bodies, late metadata and queued
retry regressions use native streams and fake timers. Byte and deadline tests
were verified red against the pre-transfer-fix source and green after the fix.

## Stock completion and MIDI quantization (B6)

The awaited body loop needed for B5 also fixes discarded callback rejections.
Its observer-failure test was verified red against the pre-B5 source. Progress
normalization tests failed on B5 and now pass for absent, zero, invalid, negative,
infinite and underreported lengths. Unknown lengths report zero until completion;
known lengths stay in [0, 1]. Callback failures reject without decoding.

MIDI export keeps flooring positions to 96 PPQ, but gives positive notes a minimum
one-tick duration and attack byte of one. Silent/nonpositive-duration notes are
omitted. Releases precede attacks at equal ticks; overlap endpoints are preserved,
and simultaneous quantized attacks are not shifted. Encode/decode/visitor fixtures
cover short notes, quiet attacks, silence, adjacency and overlapping retriggers;
four regressions failed before the fix.

## Local validation and handoff

Fresh SSH clone from main `73e54ebb3d20db2c572f90aa3b080693f3716180`.
No slice was already fixed or required an owner decision. All twelve slices are
implemented; the callback-settlement mechanism shares B5's awaited stream loop.
`npm ci --ignore-scripts`, `npm run build`, `npm run lint` and `npm test` pass
locally on Node 26.13.1 / npm 11.20.0. Lint has existing warnings but no errors;
no local gate was blocked. Regression red/green and full-gate logs are kept in
the worker's coordination log directory outside the repository. No Actions runs
were used for validation. The one combined branch `codex-q/r89-openDAW` is parked
for the external Claude clerk's review and merge; no review verdict is claimed.
