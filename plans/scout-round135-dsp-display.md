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

Automatic makeup has its own failing whole/split regression with manual and auto
ballistics, including lookahead. A per-sample attenuation/makeup recurrence pins
the time constant and gain, and disabled→enabled tracking and existing reset tests
protect lifecycle behavior. Seeded nonempty partitions include nonzero offsets.

## B03

The response regression fails against the old fixed 96 kHz renderer at 44.1/48 kHz.
The editor now passes the engine sample rate to all band designs and response-axis
normalization. Unit tests capture actual renderer commands and compare digital
coefficient responses. The browser fixture keeps native Canvas/Path2D rendering
and compares plotted dB to an actual RevampDeviceProcessor impulse DFT at
44.1/48/96 kHz, including a high-Q bell and stacked low-pass near Nyquist.

Chromium launch is blocked by the sandbox: MachPortRendezvous bootstrap_check_in
returns Permission denied (1100). The clerk must run `npm run test:browser` outside
the sandbox, including `tests/browser/r135.spec.ts`.

Silence/mixed-spectrum command spies and zero/one-pixel curve geometry fail before
the floor/geometry fix. Spectrum magnitudes now clamp to the explicit -60 dB display
floor before logarithms/interpolation. Empty geometry skips drawing and the single
curve sample selects the leftmost frequency. Native-browser resizes check peak/floor
recovery and painted pixels as well as finite submitted coordinates; DSP is unchanged.

## Local gates (2026-11-17)

Fresh SSH clone of origin/main at `71937346`; all seven findings remain applicable.
`npm ci --ignore-scripts`, `npm run build` (24 tasks), `npm run lint`
(24 tasks plus browser fixtures) and `npm test` (44 tasks) pass. Lint retains
pre-existing warnings. `npm run test:browser` attempts all 50 fixtures and cannot
launch Chromium because of the sandbox permission failure above; none is claimed
as a browser pass. Unit red/green receipts and full gate logs are stored outside
the clone in the coordinator's `logs/cx-r135-opendaw/` directory.

The independent shared FIR oracle lives under the DSP package's `test/` directory
so real Fold tests can reuse it without forbidden cross-package production-source
imports or adding a production export. It is excluded from production compilation.
No slice required an owner decision. The clerk must validate the browser fixture
and perform cross-family review before integration. Audible Fold/compressor changes
require rebuilt studio assets; this branch performs no deployment or version bump.
