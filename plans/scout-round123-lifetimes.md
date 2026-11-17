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

## Shortcut and upload admission

Shortcut imports stage all known contexts and publish only after whole-import
validation. Own keys only are admitted; corrupt roots and contexts preserve working
shortcuts and do not write storage. Unknown action/context keys remain compatible.

Sample upload accepts supported RIFF PCM16/24 and float32 WAV files up to 64 MiB
of source bytes and 64 MiB of float PCM (at most 32 channels and 16,777,216 frames,
subject to the aggregate PCM budget). Declared and actual byte sizes are checked.
Allocation-free WAV inspection precedes decode; both source and predicted resampled
geometry must fit. Actual decoded geometry is checked again before WAV encoding.
These bounds apply to this upload page; other sample import paths are unchanged.

Browse stays disabled from picker entry through actual transport settlement. Page
retirement fences picker/read/decode results and aborts a published XHR where
possible. Picker and file reads cannot be cancelled through their current APIs;
their late results are discarded. Aborting an upload cannot guarantee server rollback.
A live page reports an uncertain upload result and asks the user to check the
catalog before explicitly retrying; there is no automatic replay.

Synthetic tests cover malicious shortcut names, atomic rejection, exact/small
allocation budgets, oversized advertised/decoded geometry, double-clicks, every
await boundary, transport success/refusal and cancellation.
