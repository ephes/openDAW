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
(including undo/redo and selection commands inside a caller's transaction) deliver
notifications on the next microtask. Filtered selection indexes still change
synchronously with the vertex index. Each listener receives only the transition
from its last delivered state to the current one, so changes reverted before
delivery produce no event and a removed-and-re-added member is not reported twice.
Catchup subscribes before replaying an owned snapshot of the members listeners
have already been told about (not the synchronous index), skips removed entries,
and delivers each current member once. Live removals only balance delivered additions.
A throwing replay unsubscribes before rethrowing. Filtered selections share this contract.

### Portable stem filenames

Export basenames use NFKC normalization, replace control/path characters, trim
trailing dots/spaces and fall back to `Stem` when no letter or digit remains
after truncation (also for the truncated base of a collision suffix).
Reserved DOS device names (including extension forms) receive an underscore.
Basenames are limited to 200 UTF-8 bytes before the audio extension. Collisions
use normalized case folding and deterministic ` 1`, ` 2`, … suffixes in stem
order, including collisions with authored suffixes. Display labels are unchanged.

### Script parameter lifetime

ParameterAdapterSet.removeParameter terminates the removed adapter and returns
that retired adapter. Registry, field and automation subscriptions end together.
Script default and display-unit edits preserve the parameter UUID, current value
and automation/MIDI links. Reset follows the latest declaration through undo/redo.
Changing mapping type or numeric endpoints recreates that parameter and retires
its old links. Reconciliation compares against saved source, so undo does not
leave an out-of-date declaration cache.
