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

B04: a Router route table covers root, missing/extra segments, trailing slashes
and wildcards. Short paths and initial redirects fail before their fixes.
Subscription failure cleanup and synchronous runtime shutdown are retained.

B05: out-of-order results/rejections, stale retries, synchronous factories, and
throwing success/failure renderers all fail on the previous Await. Latest-attempt
ownership and terminal failure rendering prevent stale DOM and unhandled promises.

B06: real JSX HTML/SVG bindings expose overwritten attribute keys and the readonly
SVG className assignment before fixes. Weak target ownership, per-target key sets
and namespace-safe class attributes preserve values when detached.

## Final local validation

On 2026-11-13 with Node 26.13.1 / npm 11.20.0, all required root gates passed:

- `npm ci` (including the existing native dependency install scripts).
- `npm run build`: 24 successful tasks, including production TypeScript.
- `npm run lint`: 24 successful tasks, warnings but no errors; lib-jsx includes TSX.
- `npm test`: 44 successful tasks, including all 31 new lib-jsx DOM regressions.

Each bundle's focused Vitest regressions failed before its implementation and
passed afterward; focused lint and production type checks also passed per bundle.
No gate was sandbox-blocked. No slices were skipped and no owner decision was
needed. README and Unreleased notes cover the changed behavior; no version changed.
The branch is parked for external cross-family review and merging. No review CLI,
Actions wait, default-branch push, deployment, release or tag was performed.
