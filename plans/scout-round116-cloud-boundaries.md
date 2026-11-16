# Round 116 cloud and stock transfer boundaries

Implementation uses synthetic provider/stream fixtures, no cloud account. Codex
assisted source changes and regression construction; local gates are recorded in
the worker handoff. Work is serialized B01 through B05 on one local branch.

- B01: regression first (provider cycles/page/name overflow, duplicate target
  permutations, escaped literals); original source failed, fixed source passes
  all 20 cases. Inventory failure returns no partial list.
- B02: original providers fail all 12 initial exchange regressions. Fixed providers
  pass 48 inventory/exchange/deletion/cancellation cases, including a late-header
  and folder-ownership barrier. Runtime/core TypeScript builds pass. Shared reader
  uses public streams and signals; SDK fetch injection bounds Dropbox before Blob.
  Limits reuse OPFS contracts. Provider errors retain operation/status only.
- B03: stock preset regressions fail before the change (11 of 12 cases, including
  unhandled observer continuations); all 12 pass with the shared awaited reader.
  Both progress modes now reject declared/streamed overflow and release ownership.
- B04: four race/eligibility/physical-file regressions fail on original code; 98
  focused storage/cloud cases pass after the fix, including edits during network
  upload remaining eligible next run. Core build/lint pass; browser fixture lint
  passes. Added a real Web Locks storage journey. Browser launch is sandbox-blocked
  (`npm run test:browser -- tests/browser/r116.spec.ts`, Chromium MachPortRendezvous
  bootstrap_check_in Permission denied 1100); external clerk must run it.
- B05: all 13 initial retry regressions and the mixed stock-transfer barrier fail
  before the fixes. The final policy permits two transient retries, never retries
  missing/abort/permanent failures and preserves the original final rejection.
  Backup-level list/download failures prove notification and lock cleanup, allowing
  the queued backup to run without automatic mutation replay. Shared four-slot
  permits span stock metadata, response bodies and sample decoding; abort/read
  failures advance the queue. A further red EOF-observer-abort regression now
  passes. Standard fetch-decoded gzip/deflate/Brotli remain supported with decoded
  byte enforcement; unknown encoding declarations fail before assembly.

## Final local validation and handoff

Fresh origin: `git@github.com:ephes/openDAW.git`, default `main` at
`5575dc9298cbbd78aaf150c0581b531b36866955`. No applicable slice was already fixed;
no owner decision was required. No versions changed. Sibling app runtime retry
consumers were inspected: they use explicit finite import policies and require no
independent change. No subscription-backed review was invoked; the external clerk
owns cross-family review and integration.

Passed in the fresh clone with Node v26.13.1 / npm 11.20.0:

- `npm ci` (npm cache redirected to workspace `.cache/npm`).
- `npm run build` (24 tasks successful).
- `npm run lint` including browser fixture lint (existing warnings, no errors).
- `npm run test` (44 tasks successful; runtime 61 tests and core 878 tests pass).
- `git diff --check`.

Blocked by the macOS sandbox:

- `npm run test:browser -- tests/browser/r116.spec.ts`.
- `npm run test:browser` (25 cases fail before their body executes).

Both browser commands hit Chromium's MachPortRendezvous `bootstrap_check_in:
Permission denied (1100)`. The browser binary is present; no test outcome or browser
acceptance is claimed. The external clerk must rerun the full browser gate.
Logs remain outside the clone in
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r116-opendaw/`.
All bundles stay on local branch `codex-q/r116-openDAW`; no push, remote branch
query, merge, deployment or release was performed.
