# Scout round 95 repairs

Implemented with Codex from fresh `main` at `39dab9f`. All twelve scoped paths
were still applicable. Synthetic regressions are run against the original code
before each repair, then against the repair; logs stay outside this repository.
No account, personal media or external service data is used.

## B01: OPFS ordering

Alias writes previously opened two handles concurrently. Barrier tests also
showed parent/root deletion removing a directory while a child write owned an
open handle. The worker now canonicalizes paths before reserving a FIFO queue
slot. Serializing all worker operations also prevents read handles conflicting
with recursive deletion; no nested queue acquisition occurs for root deletion.
The new tests failed before the fix (8 cases) and pass afterward.
