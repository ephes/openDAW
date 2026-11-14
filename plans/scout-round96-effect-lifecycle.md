# Effect lifecycle and deterministic restart (round 96)

## Scope and process

Twelve scout slices in six ordered bundles cover NAM loading/activation and owned
cleanup, effect input leases and silence, delay timing/restart, vocoder sample
cadence/restart, and gate sidechain/stereo-tool restart. Codex implements each
bundle with synthetic public-entry-point regression tests, first run against the
unfixed implementation. No native model, external service or personal data is
used. Production build, lint and the full test suite are the local release gates.
The combined branch is parked for an external cross-family review; no merge,
Claude command, release or deployment is part of this work.

## B01 — NAM loading and activation

Concurrent NAM module reads share one attempt. A rejected transport or module
initialization is forgotten so a later explicit request can retry; successful
modules remain shared. Switching a loaded mono device to stereo admits the right
instance only after its model load succeeds. A false return or exception leaves
usable mono processing in place and retires the failed candidate. Changing the
mono control again retries. An unloaded device remains in dry bypass until a
complete model load succeeds.

Regression: shared rejected attempt then concurrent successful retry; false and
throwing right-channel loads, mono output, candidate retirement and stereo retry.
All three tests failed before the B01 fix and pass afterward.

## B02 — NAM ownership and pending work

Termination retires instance ownership before attempting cleanup. Base teardown,
left/right unload and destruction are all attempted independently; the first
failure is rethrown after cleanup. Repeated termination cannot destroy twice.
Mono transitions and failed stereo candidates likewise attempt destruction even
if unloading throws (transition errors are reported and usable mode retained).
One continuation per device applies the latest model after a pending module
load; terminated devices cannot create/apply instances. Later edits still apply.

Regression: four new cases failed before the fix (including 202 loads instead of
two for 100 pending edits); all seven NAM cases pass after it.

## B03 — Connection leases and disconnected silence

Every effect input attachment owns a distinct Option object, including repeated
attachments of the same buffer. Releasing a superseded lease cannot disconnect
its replacement; release is idempotent. The same small pattern is applied to all
16 audio effect source setters. Disconnected effects clear their requested output
span (Nop owns a whole render quantum). DSP and tails remain suspended while
unconnected, as before; this change does not render a tail from an absent input.
Reattachment resumes processing without requiring an engine reset.

Regression: eight new Gate, Stereo Tool, Nop and NAM cases failed before the fix;
all 15 connection/NAM cases pass after it. Tests cover distinct and same-buffer
leases, duplicate disposal, irregular output spans and reattachment.

## B04 — Delay timing and restart

The linked-channel limiter uses 50 ms attack and 250 ms release (constants are
converted to seconds in the per-sample coefficient). Reset starts modulation
depth smoothing from zero, exactly like a fresh equally configured delay, while
preserving the current depth target and other controls.

Regression: overload, silence and an attenuated probe match the closed-form
exponential time law at 44.1/48/96 kHz on both channels. A warmed modulated delay
reset twice matches a fresh device's split-span impulse response. All four tests
failed before the fix and pass afterward.

## B05 — Vocoder sample cadence and restart

All three DSP entry points carry their position within the render quantum across
calls. Coefficients advance at 64-sample boundaries and cold bands are trimmed at
128-sample boundaries, preserving the full-quantum cadence. Controls changed
inside a partial subblock take effect at the next coefficient boundary; splitting
an otherwise identical span does not accelerate smoothing. No hot-loop allocation
is added. Invocation boundaries still store filter state as Float32, so partition
comparisons allow small rounding differences (relative/absolute 1e-5).

Reset snaps frequency/Q coefficients and band fades to current targets, clears
filter/envelope history and restarts the sample clock. Compare with another
configured device after reset, not with its initial parameter ramp before reset.
Nine stereo/mono/self tests failed before the fix. Afterward partitioned parameter
transitions agree within Float32 tolerance and 16→8→12 mid-transition restarts
match exactly, including finite silent output.
