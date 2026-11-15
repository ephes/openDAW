This package is part of the openDAW SDK

Preset import requires an eight-byte header before either magic/version integer is
read. Short presets use the existing notification or Attempt failure channel and
do not touch the target graph.

Werkstatt integer declarations are validated through ValueMapping during parsing,
so ranges collapsed by rounding/clamping produce `Malformed @param` before any
parameter mappings change. Run `npm test --workspace=@opendaw/studio-adapters`
after building; this runs ScriptDeclaration and selection regressions.

Selection indexes are updated before notifications. Reentrant selects cannot create
duplicate SelectionBoxes; release detaches the previous indexes and watch before
callbacks, preserving a target installed by a callback. The latest reentrant switch
wins. Notifications for selection commands wait until editing/pointer finalization
finishes, so nested commands start valid graph transactions. External graph edits
deliver notifications on the next microtask; retired/stale events are skipped.
Catchup subscribes before replaying an owned snapshot, skips removed entries,
and delivers each current member once. Live removals only balance delivered additions.
A throwing replay unsubscribes before rethrowing. Filtered selections share this contract.
