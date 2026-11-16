# Round 107 processor lifecycle

Fresh base: `ab95c07113d0b5a315f4b42088591efee12633b7` (`origin/main`).
All twelve scout findings remain applicable. Work proceeds B01 through B06.
Implementation uses synthetic Vitest collaborators and actual scheduling/DSP code;
no personal data or external playback services. Codex assisted implementation;
regressions are run against the old code before each fix, then the corrected code.

B01: `ChainRetirement.test.ts` fails for both chain kinds before cleanup ownership
is added (missing device disposal / retained enabled subscription). Both pass
afterwards, including repeated termination, zero edges and zero connections.

B02: graph disposal, queued deletion notifications and a 2000-track churn probe
all fail before the fix. Disposal occurs once; later deletion visits one live state.

B03: five failing cases cover replacement/stop cancellation, first-boundary
play/stop partition parity and right-endpoint ownership. All pass after the fix.

B04: twelve failing cases cover three-beat one-shots launched at beat four across
three partitions, invalid initial/edited durations and explicit repaired relaunch.
Natural ending also applies to the remainder of the launch span.

B05: deterministic Atomics interception publishes a new start between counters and
timestamps; the old reader accepts a mixed pair. A worker-source fixture executes
two iterations and checks the odd write fence. Negative counters and both signed
rollover pairs fail before the modular comparison fix. No busy waiting is added.

B06: empty-span impulse comparisons fail both fresh and after reset before the
fix. Input/frozen construction faults are injected after registering a processor
and edge; failure must retain the old output and wiring, return registration
counts to one, and permit a retry that replaces the old owner once. Temporary
registration leases are idempotent so partial processor cleanup cannot double
remove graph ownership.

## Local handoff validation

The supplied scout has no section named "Pinned sources and future local gates".
The openDAW "Local gates and documentation" entry and README Checks contract
supply these gates (build precedes lint/tests):

- `npm_config_cache=/Users/jochen/workspaces/ws-cx-cx-r107-opendaw/.cache/npm npm ci --ignore-scripts`: passed.
- `npm run build`: passed (24 tasks, including TypeScript production and test checks).
- `npm run lint`: passed (existing warnings remain).
- `npm test`: passed (44 tasks; processor suite 303 tests, core suite 782 tests).
- `npm run test:browser`: blocked before all 11 fixtures by macOS sandbox refusal:
  Chromium `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`.
  The merge clerk must rerun this exact command outside the sandbox.
- `npm run typecheck --workspace=@opendaw/studio-core-processors`: passed.
- `git diff --check`: passed.

Red/green and full gate logs are retained outside the clone at
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r107-opendaw/`.
No slice needs an owner decision. All work stays on local branch
`codex-q/r107-openDAW`; no push, merge, PR, tag or deployment was performed.
