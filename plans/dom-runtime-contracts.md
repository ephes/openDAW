# DOM and runtime contracts (scout round 92)

The implementation follows the twelve openDAW slices in scout round 92, in
bundle order. A fresh SSH clone of `ephes/openDAW` started at
`7b79c5081f29b2c1b4dc67172874b693fec10eff` (`main`). No slice was already fixed.
No version, deployment, release or workflow change is included.

## Changes and regression evidence

1. Gesture and shortcut dispatch: `dispatch.test.ts` failed all five cases on
   the original source. Both pointer directions now require a real matching
   pair; local declines continue, dispatch snapshots the whole event's candidates
   and retired contexts/entries are skipped. Unsubscription is idempotent.
2. Promise outcomes and cleanup: `outcomes.test.ts` originally had five failures
   and four unhandled errors. It covers clipboard refusal/missing APIs, actual
   malformed/truncated gzip, injected writer failure and deterministic dead
   WeakRefs with a throwing cleanup. The real RoomStatus consumer is also tested
   for success versus denial (denial fails with the original compiled adapter);
   fire-and-forget clipboard callers observe failures.
3. HTML trust and lifetime: `HTML.test.tsx` originally failed ten of eleven
   cases. The tests cover active HTML/SVG, direct-call root attributes, literal
   publication, HTTP refusal, declared/streamed byte overflow, trickling timeout,
   explicit retirement, late resolve/reject and detached URL-fetch ownership.
   DOMPurify's public allowlist and fragment/in-place APIs replace the partial
   sanitizer. The README defines supported markup, limits and trust boundaries.
4. Runtime cancellation and workload: `round92.test.ts` originally failed
   thirteen of eighteen cases. It checks invalid concurrency and active-job
   bounds/order, terminal online/offline aborts, backoff/approval cancellation,
   normal retries, and 10,000 ordered results with an iterator-operation oracle
   (not wall time). Active-fetch abort cases supplement this regression set.

All fixtures use synthetic data. The tests were written and run before applying
the corresponding fixes, then rerun after them. The initial test attempt needed
the documented build to generate package outputs. The browser fixtures ran in
Chromium; see the validation results below.

## Ownership and compatibility

The HTML component starts after a microtask so JSX can attach its placeholder.
It watches removal only while pending and disconnects its observer on settlement.
An explicit lifecycle can retire even a placeholder that was never mounted.
Retirement is silent; a current load failure logs once and shows bounded text.
A late caller-owned response promise is observed and its eventual body cancelled,
though the promise producer itself is outside component ownership.

The 1 MiB limit counts response body bytes delivered by Fetch after transport
content decoding, before UTF-8 decoding. A declared Content-Length above the
limit is conservatively refused. The 15-second deadline includes fetch headers,
caller-supplied response promises and all body reads. One oversized stream chunk
may already have been produced by the upstream stream before refusal; it is not
parsed or published. Sanitization allows links/images to load remote resources.
Unsupported direct-call roots are refused rather than silently retained.

The five-pixel gesture radius and HTML limits are intentionally explicit,
conservative defaults. Basic SVG excludes executable/embedded content and SVG
reuse/filters. No existing HTML component call sites need a signature change;
callers can add lifecycle ownership when available.

## Validation and handoff

Required local commands (Node 26.13.1, satisfying Node >=23):

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

Final local results: locked install passed; build passed all 24 tasks; lint
passed all 24 package tasks plus the browser fixture/config lint; tests passed
all 44 tasks, including 51 new cases. DOM/runtime test TypeScript checks and the
production build of the browser fixtures also passed. Existing lint warnings
remain non-fatal.

The browser fixtures use Playwright, a local Vite server and actual application
helpers including RoomStatus. No paid Actions run or workflow was added.
`npm run test:browser` passed in Chromium (3 contracts: gesture identity,
clipboard acknowledgement, HTML sanitization and retirement), as did the
`@opendaw/lib-dom` browser check.
