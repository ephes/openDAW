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
A pointerup from the initiating pointer always stops it, so a cancelled dragstart
cannot leave the gesture active. A pointerdown from the same pointer or a new primary
pointer restarts the gesture after a lost completion; secondary contacts are ignored.
A new source drag retires the old source's payload, class and ghost. Failed source
setup and source disposal run the same cleanup, which cannot clear a newer owner.
Twelve synthetic gesture tests reproduce the previous failures.

## Shortcut and upload admission

Shortcut imports stage all known contexts and publish only after whole-import
validation. Own keys only are admitted; corrupt roots and contexts preserve working
shortcuts and do not write storage. Unknown action/context keys remain compatible.

Sample upload accepts RIFF WAV files the browser can decode (any sample format,
including WAVE_FORMAT_EXTENSIBLE, with consistent block geometry) up to 64 MiB
of source bytes and 64 MiB of float PCM (at most 32 channels and 16,777,216 frames,
subject to the aggregate PCM budget). Declared and actual byte sizes are checked.
Allocation-free WAV inspection precedes decode; both source and predicted resampled
geometry must fit. Actual decoded geometry is checked again before WAV encoding.
These bounds apply to this upload page; other sample import paths are unchanged.

Browse stays disabled from picker entry through actual transport settlement. Page
retirement fences picker/read/decode results and aborts a published XHR where
possible. Picker and file reads cannot be cancelled through their current APIs;
their late results are discarded. Aborting an upload rejects with AbortError and cannot guarantee server rollback.
Definite refusals (missing access key before sending, HTTP 4xx) are reported with
the server reason. Otherwise a live page reports an uncertain upload result and asks the user to check the
catalog before explicitly retrying; there is no automatic replay.

Synthetic tests cover malicious shortcut names, atomic rejection, exact/small
allocation budgets, oversized advertised/decoded geometry, double-clicks, every
await boundary, transport success/refusal and cancellation.

## Room duration and identity

Room duration uses monotonic elapsed time, including delayed background callbacks.
Heartbeats send whole additive minutes and carry the remainder; terminal close
rounds the remaining active duration to the nearest minute once (30 seconds rounds
up). Persisted pagehide pauses without rounding. Persisted pageshow resumes only
the currently installed, still-owned room. Time in BFCache is excluded. Project
retirement or non-persisted pagehide finalizes once and cannot be resumed.

An accepted beacon sends no duplicate fetch. Beacon refusal, synchronous throw or
absence attempts the same keepalive JSON request once; network failures remain
best effort, with no replay. Name/color storage is optional. The current launch
keeps its latest chosen identity in memory even when storage discovery, reading
or writing fails; awareness remains authoritative for the room. Available storage
still loads at launch and saves later edits.

Regression tests inject monotonic clocks, delayed timers, repeated suspension,
room replacement, all beacon outcomes and storage failures during join/broadcast.
Chromium additionally exercises actual AudioNode connect/disconnect overloads and
AutoScroll pointer/animation retirement.

## Local gate results (2026-11-17)

Fresh SSH clone from main `6b2e5dbb`; all twelve slices remained applicable.
`npm ci --ignore-scripts`, `npm run build`, `npm run lint` and `npm test` pass
with Node 26.13.1. Targeted regression runs failed against the old behavior, then
passed with the fixes. Lint retains existing unused-variable warnings.

Chromium installation succeeded, but this exact gate is blocked by the macOS
sandbox before any browser test runs:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r123-opendaw/.cache/playwright npm run test:browser
```

Chromium exits at `bootstrap_check_in ... MachPortRendezvousServer: Permission
denied (1100)`. The merge clerk must run the full suite outside the sandbox;
no browser pass is claimed here. Build/test/review logs remain outside the clone
in the runner's prescribed `cx-r123-opendaw` log directory. No owner decisions
were needed, no remote refs were written and no cross-family review was invoked.
