# Compact Tracks

**Compact Tracks** packs the main audio or note lanes of an audio unit in their
existing top-to-bottom order. Each region moves to the first earlier lane with no
overlap. Touching endpoints are allowed. Empty main lanes are removed, retaining
at least one; clips and automation lanes stay where they are.

Audio occupancy follows the current tempo map, including recordings whose duration
is stored in seconds and regions crossing tempo changes. Compaction is one undoable
edit. Large collections reuse an interval index instead of repeatedly sorting the
target lane.
