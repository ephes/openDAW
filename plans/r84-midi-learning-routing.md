# Round 84 B03: MIDI learning attempts and live routing

Scope: `opendaw-midi-learning-single-active-attempt` and
`opendaw-midi-controller-live-routing-retarget`. Based on the B02 branch
`q-r84-midi-learning-lifetime` (same file).

Rechecked on the B02 tip: both defects remained.

- Overlapping `learnMIDIControls` calls each installed their own listener and
  dialog, so one controller message created a mapping per pending attempt (for
  different parameters). Now each attempt bumps an attempt counter and retires the
  previous learning lifecycle (aborting its dialog); stale permission completions
  are ignored.
- A controller connection captured its target adapter and channel at
  registration. Retargeting `MIDIControllerBox.parameter` or changing
  `deviceChannel` kept driving the old parameter on the old channel while
  `hasMidiConnection` reported the new target. The connection now rebuilds its
  route when either field changes and is fenced against late end-of-transaction
  notifications after removal.

Regressions in `MIDILearning.test.ts` (real graph/editing, stubbed permission,
notifier and MIDI input): four fail on the previous implementation and pass now.
