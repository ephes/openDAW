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
