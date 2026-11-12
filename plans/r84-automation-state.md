# Round 84 B06: automation recording state and simplification

Scope: `opendaw-automation-deleted-active-state-retirement` and
`opendaw-automation-simplification-error-envelope` in
`packages/studio/core/src/capture/RecordAutomation.ts`.

Rechecked on main `fbf2cb4b`: both defects remained.

- Deleting the region being recorded (or its event collection) left the state in
  `activeRecordings`. Later writes went to the dead collection and position
  updates skipped it, so the parameter recorded nothing until the touch ended.
  Detached states are now retired on each write and position update, so the next
  write starts a fresh region.
- `simplifyRecordedEvents` dropped a point when it was within `Epsilon` of the
  line between its kept neighbours but never rechecked earlier dropped points.
  The error built up, and a slow curve could collapse into one segment (0.25 off
  in the regression). Each kept event now tracks the points dropped before it,
  and a removal only happens if all covered points stay within `Epsilon` of the
  new segment.

Regressions are in `RecordAutomationState.test.ts`: real box graph, with the
engine, parameter adapters, event adapters and clip resolver stubbed. They fail
on the previous implementation and pass now. The file is separate from B05's
`RecordAutomation.test.ts` so the two branches do not hit an add/add conflict.
B05 and B06 both edit `RecordAutomation.ts`, in different functions.
