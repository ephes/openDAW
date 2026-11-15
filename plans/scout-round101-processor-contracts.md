# Round 101 processor contracts

Implementation uses Codex with real headless processors/DSP, synthetic adapter
fields, fake NAM and invented PCM only. No external reviewer runs in this sandbox;
the parked branch is for a separate Claude clerk review and merge.

## B01 — Nano event/sample ownership

Both source-delivery regressions fail against main: disabled starts survive until
enable, and a held A voice reads B after a file edit. Disable refuses starts;
retarget resets audio, voices and display using the existing reset path.
