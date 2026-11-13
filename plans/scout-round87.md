# Scout round 87 implementation

Implemented sequentially by Codex from fresh main b47821b, using synthetic
Vitest fixtures and explicit before/after regression runs. No external reviewer
or Claude CLI runs in this sandbox; the parked branch awaits the external clerk.

- B01: real binary box imports cover opaque unknown fields, frame admission,
  mutating supported decoders, rollback and retry. Field payload limit: 64 MiB.
- B02: paired Messenger/Communicator graphs cover failed batch rollback, protocol
  and field admission, transaction ownership, sender quarantine and snapshot reconnect.
- B03: real ProjectSkeleton/BoxAdapters automation move/copy and note relocation
  fixtures check pointer ownership and undo checksums; 150,000 synthetic displaced
  regions exercise stable movement beyond the function argument limit.
- B04: deferred browser API fixtures reproduce microphone cleanup and stale device
  inventories. Context fixtures reproduce duplicate installations and rejection
  retry; a native node stub hosts the real RecordingWorklet and RingBuffer reader/
  writer, including the 32-channel / 64 MiB admitted boundary. Browser audio
  hardware and live microphone permissions are not exercised by these local tests.

## Validation and closeout

Every numbered slice was still applicable on the fresh baseline. Before fixes,
B01 had 10 failing regressions, B02 10, B03 4, and B04 18. All now pass.
`npm ci --ignore-scripts`, `npm run build`, `npm run lint`, and `npm test`
completed successfully locally. Additional `tsc --noEmit` checks for lib-box and
studio-core test projects passed. Existing lint/build warnings remain non-fatal.
No check was blocked by the sandbox, no workflow was added, and no Actions run
was requested. Documentation and package Unreleased notes accompany all bundles;
no versions changed. The branch is parked for external review and merge.
