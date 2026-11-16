# Round 101 processor contracts

Implementation uses Codex with real headless processors/DSP, synthetic adapter
fields, fake NAM and invented PCM only. No external reviewer runs in this sandbox;
the parked branch is for a separate Claude clerk review and merge.

## B01 — Nano event/sample ownership

Both source-delivery regressions fail against main: disabled starts survive until
enable, and a held A voice reads B after a file edit. Disable refuses starts;
retarget resets audio, voices and display using the existing reset path.

## B02 — Endpoints and mix leases

The 1/2/3-frame interpolation oracle (mono/stereo, four rates, split spans)
fails before the endpoint fix. Duplicate-lease release also fails before the
identity fix. The final interpolation neighbour is clamped to the last frame.

## B03 — Revamp generations

All four regressions fail before repair: immediate/partial-window spectrum
publication and high-Q bell/stacked HP/LP bypass. Use AudioAnalyser.clear(), since
its reset() only restarts the cursor and retains bins. New tones repopulate normally.

## B04 — Partitions and restart

Real AudioProcessor update-event splits (17+31+80 and loop wrap) reproduce
Tidal phase drift. Output, end phase and RMS agree after repair. Fold impulse
restart comparisons fail before repair at all 2x/4x/8x factors; uneven subspans,
silence, a second impulse and interrupted gain ramps match fresh controls afterward.

## B05 — Native DSP outcomes

All three partial-write NAM regressions fail before the exception boundary.
Mono/left/right failures, repeated blocks, reset/mono edits, cleanup refusal and
replacement recovery pass afterward. One constant diagnostic avoids serializing
unbounded native errors. Model changes are the explicit recovery boundary.

Dattorro needs no runtime repair: fresh/restarted output and irregular partitions
agree exactly, with 1e-7 tolerance only for independently specified dB gain mapping.
Unity dry preserves channels and the wet network decorrelates stereo. The test
rejects an intentional omitted-DSP-reset mutation; restored production code passes.

## B22 — Maximizer modes and numerical contracts

Both mode regressions fail before the shared history reset. Delay buffers, hold,
envelope and published reduction retire on mode edits; parameter ramps continue.
The static numerical oracle specifies gain algebraically, exact 5 ms latency,
linked stereo ratios, steady headroom and sentinel preservation at 44.1/48/96 kHz.
Whole and irregular rendering agree exactly through threshold automation. No
additional numerical DSP repair was needed. A deliberate latency mutation is
rejected, establishing oracle sensitivity without changing the production delay.

## Local validation and handoff

Fresh SSH clone of ephes/openDAW main at
`9d2ed4229c10f676e181447ac1166313b5eea3c2` (newer than the scout pin); no
repository AGENTS.md was present. The fresh branch already includes the round-100
preset, compaction, demux and NAM pack fixes, which remain intact.
All twelve slice scopes remained applicable. No version bump, workflow edit,
external data, deployment, PR or merge. The two oracle-only slices needed no
runtime repair; mutation probes demonstrate their failure sensitivity.

Gates: locked `npm ci --ignore-scripts`, processor workspace Vitest/lint/typecheck,
root `npm run build`, `npm test`, `npm run lint`. Local browser installation used
the workspace cache. The exact browser gate attempted was:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Users/jochen/workspaces/ws-cx-cx-r101-opendaw/.cache/playwright npm run test:browser
```

All nine browser cases stop before test code at Chromium launch: macOS
`bootstrap_check_in … Permission denied (1100)` (MachPortRendezvousServer).
The external clerk must run that gate outside the sandbox before adoption.
No Actions are used to replace it. Logs are retained outside the clone at
`/Users/jochen/workspaces/ws-work-planning/coordination/codex/logs/cx-r101-opendaw/`.

Result: root build succeeded (24 tasks), lint succeeded (existing warnings only),
and the complete root test run passed 276 files / 2,875 tests. The processor
workspace typecheck passed. Added processor regressions/oracles cover 42 tests.
Browser validation remains blocked as described above. All changes are parked
for external review; no owner decisions or skipped slices remain. The final
parking commit requests `[skip ci]` to avoid paid Actions on the branch push.
