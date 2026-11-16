# Round 106 editor and project ownership

Implemented by Codex using source inspection and synthetic Vitest/DOM graphs.
No external accounts or personal data are used. Regression receipts and full local
check output are kept in the worker handoff log directory.

## Drum pads (B01)

Drops resolve the dragged sample UUID, require its current slot and the displayed
device, and find destination pads only in that device. Foreign, retired or moved
sources are refused. Alt-copy creates a fresh sample identity, shares the source
audio file and copies its serialized authored fields through the public Box API
before retargeting the slot. Incoming effect chains are not duplicated.

Regression: real drop handlers and two graph-backed devices; both swap directions,
foreign drops, nondefault pitch/trim/envelope/gate/polyphony and replacement undo/redo.
The identity test failed on refreshed main; after identity repair the copy test
still failed (pitch 0 instead of 7). Both pass with the complete change.

## Destructive drops (B02)

Pad copy resolves a live file and device and snapshots fields before opening an
edit. A refused drop does not enter history. Effect moves require every distinct
UUID to be an indexed member of the currently displayed chain with the matching
host pointer kind. Partial selections are refused as a whole.

Regression: missing-file getter at drop time, unchanged graph/history/undo/redo;
foreign chains with matching indexes, MIDI/audio mixes, missing and duplicate
UUIDs, plus a valid reorder. Both new tests failed before repair and pass after.

## Project dialogs (B03)

Cancel, Escape, Enter and programmatic close settle browsing as cancellation;
selection resolves before close. Stem Enter uses the Export button action and
prevents duplicate native activation; composing Enter is ignored. Unresolved
close cancels. A finally block retires each dialog owner, including setup failure,
without replacing Dialog's own close cleanup.

Regression: actual ProjectDialogs functions with synthetic dialog controls cover
all terminal paths, composing Enter and showModal refusal. The original code left
close paths pending and leaked setup owners; the repaired functions settle once.

## Retired editors and browser rows (B04)

Each project-list generation owns its row filter and context-menu subscriptions.
Refresh retires the generation before loading; row removal retires its own owner.
Closed browsers do not install late list results. Soundfont imports require a
live editor, the same project and device object, and unchanged file selection;
a newer import or selection supersedes older results. Cancellation is quiet and
current failures use the existing notifier. Imported library assets may remain
available even when their retired editor no longer applies them.

Regression: 100 synthetic rows over three refreshes, filtering retired rows,
row deletion and teardown; delayed browse across editor/device/project retirement,
current success and observed failure. Byte snapshots compare Uint8Array contents.
New tests failed before each repair and pass after.

## Audition pointers and portable stems (B05)

A pad-label audition owns one pointer and one note. Replacement ends the old
note first; releases from other pointers do nothing. Up, cancel, lost capture
and disposal release the active note once and relinquish capture.
Stem naming follows the adapter README policy and preserves display labels.

Regression: real sample-editor event handlers with synthetic note routing cover
two-pointer ordering, cancellation, lost capture and disposal. Export tests cover
case/Unicode collisions, reserved names, empty/punctuation names, authored suffix
collisions, byte limits and idempotence. Both failed before repair and pass after.
