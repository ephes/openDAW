# Round 109 audio and script contracts

Implementation uses source inspection and synthetic Vitest/Chromium regressions.
Changes are grouped by the six ordered bundles; no external reviewer ran here.
Regression failures and full local gate output are retained in the worker log directory.

## B05 — output routing

Selecting Default passes the empty sink ID to AudioContext.setSinkId. Refusals
propagate to the existing selector error path. Enumeration publishes only for the
latest sinkchange and a still-matching context sink.

## B06 — graph lifetime and scaling

Graph tests reproduce source-first teardown, duplicate releases and the old
transitive-closure work count. Iterative SCC discovery and ordering handle a
20,000-vertex reverse chain without recursive stack growth. Engine registration
leases already release once; incident-edge cleanup makes their release order safe.

## B07 — shared note and recording state

Signed-word presence tests preserve the four-word MIDI wire format. The recording
ring reserves one slot and stores sticky loss evidence in a third header word.
Both polling and finalization inspect it, preventing a save before a delayed
poll observes overflow. Faults terminate capture resources and require a fresh
ring. Unit tests cover wrapping and owner refusal; the Chromium fixture exchanges
real SAB blocks with a worker and checks overflow before reader startup.
