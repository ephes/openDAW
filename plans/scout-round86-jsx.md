# JSX lifecycle fixes (scout round 86)

Implementation uses Codex to inspect the current sources, add synthetic jsdom
regressions before fixes, and update lifecycle ownership in small ordered bundles.
No external review agent runs in this sandbox; the parked branch is for the
external clerk review. No release, version change or deployment is included.

B01: deferred navigation rejection and return-to-visible regressions fail on the
original Router and pass with the ownership fences. The test command now invokes
Vitest and lint includes TSX.

B02: runtime disposal (late resolution and rejection) and a never-settling factory
with an owned interval fail before the teardown fix. Immediate disposal is
idempotent and late outcomes cannot replace the visible DOM.

B03: synchronous factory throws, rejecting/throwing error pages, and the missing
error-page path fail before the boundary fix. Error rendering is terminal after
one attempt and leaves the previous page available. Request ownership is installed
before factory invocation so a factory cannot overwrite a newer request.
