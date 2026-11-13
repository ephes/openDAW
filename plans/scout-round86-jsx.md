# JSX lifecycle fixes (scout round 86)

Implementation uses Codex to inspect the current sources, add synthetic jsdom
regressions before fixes, and update lifecycle ownership in small ordered bundles.
No external review agent runs in this sandbox; the parked branch is for the
external clerk review. No release, version change or deployment is included.

B01: deferred navigation rejection and return-to-visible regressions fail on the
original Router and pass with the ownership fences. The test command now invokes
Vitest and lint includes TSX.
