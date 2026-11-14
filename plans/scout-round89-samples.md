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
