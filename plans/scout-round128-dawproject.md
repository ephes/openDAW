# DAWproject round 128

Codex implementation from the scout's pinned source findings. Changes are split
by bundle on one local branch. Regressions run first against the preceding code,
then against each fix. Test and gate logs live outside the checkout. No deployment
or remote publication is part of this work.

B01: use actual loop playback coordinates. The current engine does not consume
NoteRegionBox.eventOffset; refuse nonzero values rather than invent semantics.
