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
