# Scout round 87 implementation

Implemented sequentially by Codex from fresh main b47821b, using synthetic
Vitest fixtures and explicit before/after regression runs. No external reviewer
or Claude CLI runs in this sandbox; the parked branch awaits the external clerk.

- B01: real binary box imports cover opaque unknown fields, frame admission,
  mutating supported decoders, rollback and retry. Field payload limit: 64 MiB.
