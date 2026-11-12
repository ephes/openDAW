# Round 84 B05: automation recording loop boundaries

Scope: `opendaw-automation-nonquantized-loop-boundary` and
`opendaw-automation-seek-versus-loop-transition` in
`packages/studio/core/src/capture/RecordAutomation.ts`.

Rechecked on main `fbf2cb4b`: both defects remained.

- Non-quantized loop: region growth and loop-wrap finalization used
  `quantizeCeil` against the loop end and `quantizeFloor(loopFrom)` for the next
  lap, so with a loop end/start off the 16th grid regions (and their clip ranges)
  extended past the loop end and before the loop start, clipping material outside
  the loop. Durations are now clamped to the loop end and a lap starting inside
  the loop never starts before `loopFrom`.
- Position transitions: `lastPosition` was only updated while a parameter was
  being recorded, so the first update after an idle loop lap compared against a
  stale position and was taken as a loop wrap (finalizing the fresh region to the
  loop end and starting a duplicate). The position is now tracked on every update.
  A backward transition counts as a wrap only when the engine actually loops while
  recording (loop enabled and `recording.allowTakes`, as in `RecordMidi`/
  `RecordAudio`); otherwise regions are not clamped to the loop end.

Regressions in `RecordAutomation.test.ts` (real box graph, stubbed engine,
parameter adapters and clip resolver) fail on the previous implementation and
pass now.
