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
