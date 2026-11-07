# Sample preview ownership

Round 58 A2, in order: generation fence, play rejection state, owned Blob URL cleanup.
Coding assistance produced a minimal real-class repair and synthetic audio/storage
regressions. No real audio devices or network. The app workspace test script now
runs these regressions in the root Turbo test graph.

Only the selected generation attaches local/remote sources and plays. Eject detaches
the element before revoking its local URL. Remote URLs are never owned. Rejected
play promises publish a bounded retryable error; replacing/ejecting invalidates old
continuations. A toggle while a local load is pending waits for that load.

Validate focused app tests, then root build, lint and tests.
