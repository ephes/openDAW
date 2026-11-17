# Round 123: ownership and input admission

Changes are implemented sequentially from fresh main, with synthetic regression
tests written and run against the original behavior before each fix. Instrumented
audio nodes count owned and foreign connections and inject construction, connect
and map-publication failures. Full build, lint, tests and Chromium fixtures run
locally; no remote publication or real user data is involved.

## Editor gestures

Auto-scroll retirement stops scrolling immediately and fences queued callbacks.
Only the initiating pointer moves or completes a pointer gesture. Cancellation and
window blur stop it. A native dragstart transfers completion to dragend (browsers
issue pointercancel when native dragging starts); native dragover still scrolls.
A new source drag retires the old source's payload, class and ghost. Failed source
setup and source disposal run the same cleanup, which cannot clear a newer owner.
Twelve synthetic gesture tests reproduce the previous failures.
