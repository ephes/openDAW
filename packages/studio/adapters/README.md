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

Script declarations require complete finite decimal/scientific numbers representable
as finite float32 values. Shorthand defaults are in [0,1]; explicit defaults are
within their bounds. Exponential endpoints must be positive with a finite ratio.
Boolean endpoints are 0 and 1. Integer mappings use ValueMapping's rounded/clamped
bounds and must remain increasing. Parameter and sample labels share one unique,
case-sensitive namespace; duplicates report the declaration line and preserve the
previous device. ScriptDeclaration.validate applies these admission rules to new
compile input only. Saved code, loads, parameter bindings and the device editor keep
the legacy tolerant reading, so projects saved with earlier declarations (for example
an exponential range starting at 0) still open, and a corrected script can be compiled
over them.

### Script installation publication

Compilation validates declarations and syntax, installs a private attempt-specific
constructor, then activates it and publishes one graph transaction. Installation
failure leaves saved code, labels, parameters and samples unchanged. A newer
compile/load request, source edit or removed device retires pending publication.
Request ownership is shared across compiler instances for each context/device and
is separate from saved update numbers, so undo may deliberately reload an older
saved update. Worklet staging fences late modules; retirement restores only the
same attempt's activation and frees its candidate. Script top-level code runs
during preparation, so external/global side effects authored by a script are not
rolled back. Successful graph publication remains successful if candidate cleanup
is refused; that cleanup fault is logged. The first compile of a new device appends
to the creation history step only if no other history change happened while the
module installed; otherwise it publishes as its own step.
