# Round 135: DSP timing and Revamp display

Implementation uses synthetic signals, independent FIR/response calculations and
real effect processors with synthetic adapter fields. Each regression is run against
the preceding implementation before its fix. No audio hardware or external data is used.
Codex implements and inspects the changes; the local handoff clerk owns cross-family
review and integration. No review CLI or remote push runs in this checkout.

## B01

The even-phase impulse/DC regression fails when the last four nonzero halfband
taps are discarded. Both phase lengths now derive from the 31-tap source filter.

The chronological impulse/ramp/DC regression separately fails for the old extra
source-sample delay on the odd phase. Correcting its origin passes direct FIR
checks at 2x/4x/8x and real Fold transfer/downsampling comparisons. Existing response
snapshots are regenerated only after those independent oracle checks pass.

The delay regression warms identical ramp histories, slews 0→10 for five frames,
then retargets to 5. The old code continues moving and fails the stationary reference.
Cancellation now retires its delta/countdown, including partitioned continuation.

## B02

Real Compressor regressions independently enable auto attack, auto release and both
(with automatic makeup disabled). Whole and uneven spans fail before the sample
clock fix; a changed future suffix also tests causal prefix equality. Continuation
for twelve quanta checks retained state, rather than only a block average.
