# Round 135: DSP timing and Revamp display

Implementation uses synthetic signals, independent FIR/response calculations and
real effect processors with synthetic adapter fields. Each regression is run against
the preceding implementation before its fix. No audio hardware or external data is used.
Codex implements and inspects the changes; the local handoff clerk owns cross-family
review and integration. No review CLI or remote push runs in this checkout.

## B01

The even-phase impulse/DC regression fails when the last four nonzero halfband
taps are discarded. Both phase lengths now derive from the 31-tap source filter.
