# Round 90: DOM operation ownership

Scope: O1–O4, based on main `2984ab74a40ea9a5931613e5c809b2c58877fc9e`.
All eight scout findings were still applicable. No public API or package version
changes are required.

## Implemented contracts

- A drag settles once. Its subscriptions retire before user hooks, owned capture
  and pointer lock are released, and the final hook is attempted after a failed
  approve/cancel. Attachment disposal cancels provisional work.
- Factory success owns a process before capture or immediate updates. Setup
  failure and pre-abort compensate it. Pointer-lock requests are single-flight
  per element even across attachment replacement; retired success releases its
  lock before a replacement can request another one.
- Frame callbacks run from a detached snapshot with isolated error reporting.
  Stop/restart/driver changes fence retired snapshots and reset timestamp origin.
- Shortcut unsubscribe removes only its exact registered entry. IME composition
  is excluded from dispatch, matching and binding capture. Text ownership uses
  the composed event origin and native inherited editable state.

The package README documents lifecycle details, the closed-shadow-root boundary,
and browser-test setup. Its Unreleased notes cover all four bundles.

## Regression evidence and local validation

Codex implemented and checked these changes without delegated agents or an
external review. Tests were run before each fix. A final counterfactual run
restored original source files temporarily, ran the final regression suites, and
restored the fixed source in a guaranteed cleanup path: all 13 drag, 6 frame and
5 shortcut regressions failed against the original implementation. With the fix,
all 28 DOM tests pass (24 new regressions plus 4 existing tests).

Local gates:

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
npx tsc -p packages/lib/dom/tsconfig.test.json
npm run test:browser --workspace=@opendaw/lib-dom
```

Build, lint, root tests and DOM test types pass on Node 26. Lint retains existing
repository warnings. The browser harness bundles the actual DOM code and checks
native pointer capture and editing, with controlled composing events. Its syntax
and bundling pass, but Chromium startup is blocked by the worker's macOS sandbox:
`bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`.
No browser assertions executed; this gate must be rerun outside that sandbox.
The branch is parked for the external Claude clerk's review and merge; no Claude
CLI, Actions runs, merge, release or deployment was initiated by this worker.
