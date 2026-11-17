This package is part of the openDAW SDK

Curved tempo automation with equal endpoint BPM stays constant through contiguous
grid reads, seeks and neighboring ramp transitions. PPQN/seconds conversion uses
the same finite constant recurrence as the shared Curve primitive.

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

### Tempo cursor bounds

The tempo cursor integrates constant spans before the first and after the last
event in closed form; work there is independent of tail length. Changing zones
retain grid-origin sampling, including nonaligned event boundaries. Inputs must
be finite, tempo must be positive, and pulse coordinates must fit within
`Number.MAX_SAFE_INTEGER - TempoChangeGrid`. An unrepresentable position or
nonprogressing step throws `RangeError`; positions are never silently clamped.
Events must be sorted by `ValueEvent.Comparator`; a same-position pair (a tempo
step) is valid. Only the first and last event positions and each sampled tempo
are checked per call, so validation adds constant work on the audio thread.

Signature moves to occupied bars are refused without graph edits. Other moves
retain the absolute bar positions of every untouched signature event; undo/redo
restores the original order and relative distances.

### Flattening selected regions

Note and automation flattening replaces exactly the supplied selected regions on
one track. Other overlapping regions, including selected regions outside that
source list, keep their boxes and content. The replacement spans the earliest
start through the greatest complete endpoint, including nested and disjoint
regions. Copied notes retain their ratchet count and curve; explicit ratchet
consolidation still produces single notes.

Content-start trims isolate mirrored note/value collections before changing event
coordinates. Musical audio trims clone shared play modes and their warp markers.
Each selected region is translated once; other regions and clips retain their
content. Seconds-based audio trims continue to change only the region offset.
Automation preroll uses the first unmuted value region; all-muted tracks return
the supplied fallback. Enabled regions retain their holding-value behavior.

### Soundfont adapter ownership

Every font transition retires the prior loader observation, including switches to
cached fonts and clearing the file. Only the current loader generation publishes
font/preset state. Adapter termination releases file/preset pointer observers and
its loader observation once; queued old callbacks are inert. Shared loaders are
not invalidated or terminated by an adapter.

### MIDI control registrations

Each `registerMidiControl()` call owns one idempotent handle. Control-source
listeners see one aggregate MIDI-add transition on the first registration and one
remove transition on the last release. Catchup observes the aggregate presence
even after another owner has released its handle.

### Automation event identity and rollback

Value collections identify points by integer `(position, index)`. Creating the same
key again in one transaction updates its value/interpolation, including pending
points and replacements; indices 0 and 1 still represent intentional jumps. The
lookup follows immediate graph updates rather than scanning notified adapters.
One shared listener per box graph routes each update only to the collection that
indexes the box and to the collection a pointer or new box now targets, so the
cost of an update does not grow with the number of automation collections.
After an aborted graph transaction, collections rebuild their editor index from
the restored pointers, including replacement box instances. Editors may still
remove points temporarily to avoid collisions during promotion and batch moves.

Tempo and parameter cuts interpolate in the stored value domain and split both
curve slopes there. The optional historical display-mapping argument to `cut`
is accepted for compatibility and does not affect interpolation. Logarithmic
tempo display changes neither BPM playback nor the tempo-map time conversion
when inserting an unchanged point (within Float32 storage precision).

### Script initialization across editor remounts

`ScriptCompiler.initialize(context, editing, device, defaultCode)` loads saved
code or compiles the default with creation-history append semantics. Both it and
passive `load` join a current pending installation for the same device object and
audio context, even when another compiler/editor instance owns that operation.
Closing an editor retires UI callbacks, not the device's pending compile.

Explicit `compile` always claims a newer request. External source edits (including
edit/undo), device replacement/deletion and a different context cannot reuse an
obsolete pending owner. Publication-triggered reloads join the publishing owner
without installing saved old code over it. Pending owners/subscriptions are
released on success or failure, and a later explicit retry starts a fresh attempt.
The existing worklet activation fence and graph rollback remain in force.
