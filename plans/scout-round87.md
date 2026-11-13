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
