# Round 84 B04: capture device lifetime and notifications

Scope: `opendaw-capture-device-inner-subscription-retirement` and
`opendaw-capture-detach-notifies-observers` in
`packages/studio/core/src/capture/CaptureDevices.ts`.

Rechecked on main `d08d9519`: both defects remained.

- `terminate()` only released the audio-unit pointer-hub subscription; each
  unit's `capture` pointer subscription stayed live, so later capture changes
  created new `Capture` instances (MIDI/audio listeners) for a retired project.
  Termination now releases and clears those subscriptions and is idempotent.
- When a unit's capture pointer was cleared, the old capture was terminated and
  removed silently; only additions notified. Observers such as
  `Project.subscribeMidiCaptureAvailable` kept the stale capture. Any removal or
  addition now notifies.

Regressions in `CaptureDevices.test.ts` (real box graph, mocked capture classes)
fail on the previous implementation (detach without notification, captures
created after termination) and pass now.
