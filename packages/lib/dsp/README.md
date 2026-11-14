_This package is part of the openDAW SDK_

# @opendaw/lib-dsp

Digital Signal Processing utilities and audio processing functions for TypeScript projects.

## Core Audio Processing

* **fft.ts** - Fast Fourier Transform implementations
* **rms.ts** - Root Mean Square calculations
* **delay.ts** - Audio delay effects and processing
* **stereo.ts** - Stereo audio processing utilities
* **window.ts** - Windowing functions for signal processing

## Oscillators & Synthesis

* **osc.ts** - Oscillator implementations and waveform generation
* **value.ts** - Audio value processing and manipulation
* **ramp.ts** - Smooth parameter transitions and ramping

## Musical Theory & MIDI

* **notes.ts** - Musical note utilities and conversions
* **chords.ts** - Chord theory and generation
* **midi-keys.ts** - MIDI key mapping and utilities
* **fractions.ts** - Musical fraction calculations

## Timing & Rhythm

* **ppqn.ts** - Pulses Per Quarter Note timing utilities
* **bpm-tools.ts** - Beats Per Minute calculations and tools
* **GrooveBoxes.ts** - Rhythm and groove pattern utilities

## Audio Graph & Events

* **graph.ts** - Audio processing graph utilities
* **events.ts** - Audio event handling and scheduling
* **fragmentor.ts** - Audio fragment processing

## Filters & Effects

* **biquad-coeff.ts** - Biquad filter coefficient calculations
* **biquad-processor.ts** - Biquad filter processing implementation

## Utilities

* **utils.ts** - General DSP utility functions
* **global-console.d.ts** - Global console type definitions

## Deterministic DSP validation

After the root build, run `npm test --workspace=@opendaw/lib-dsp`. Tests use
synthetic signals and controlled worklet globals; no audio hardware is required.
Immediate scalar/matrix ramp sets cancel pending interpolation even when the new
value equals the current value. Glide completion commits the current pitch before
retargeting; zero-duration glides cancel movement immediately. ADSR gate-on
recalculates a full attack from the current amplitude. Release phase is normalized
to its entry amplitude (including zero sustain), and force-stop clears phase.

Biquad coefficient caching includes cutoff and order-adjusted resonance; reset
clears feedback history independently. Reference tests pin filter-mode limits,
center gains and impulse-DFT magnitude/phase. Mono/cascade tests cover orders 1–4,
frame/block equivalence, partition continuity, in-place processing and range guards.

Routing tests exercise mono duplication, stereo separation, replace versus mix,
half-open clear ranges and unsupported layouts. AudioData planes share a buffer
at disjoint offsets, including coherent zero-frame allocation. StereoMatrix tests
use independent basis signals for pan laws, width, inversion and swaps, and compare
scalar/block/in-place subranges with untouched sentinels. Swapping exchanges input
channels; inversion applies to the resulting left/right outputs.

Effect tests pin the limiter's linked stereo attack/release recurrence (without
claiming a brick-wall ceiling), waveshaper display/audio parity and independent
transfer boundaries. Crusher crush-rate ramps update filtering and hold cadence
at each sample; identical parameter changes at identical sample positions produce
the same output across block partitions. Reset plus the same configuration matches
a fresh effect. Unequal stereo signals test channel independence and wet/dry paths.

Oscillator tests compare constant and per-sample frequency APIs, phase/integrator
continuity across partitions, analytic sine references (including varying frequencies) and finite zero-frequency
behavior. LFO quarter-cycle tests pin all four shapes, reset and shape-switch phase.
Tidal tests cover depth/slope/symmetry endpoints, integer-period wraps, bounded gain
and continuity at the symmetric midpoint join with independent triangular reference values.

TransientDetector tests use invented silence/bursts and require finite, strictly
increasing markers within the source duration, invariant under sign inversion and
duplicated channels. TimeBaseConverter tests use a piecewise-tempo map to distinguish
position-aware duration conversion from absolute-position conversion, including
live owners, preview immutability and sample-rate scaling. Fragmentor tests pin
half-open grid intersections, negative/fractional windows, indexes and adjacent
partition equivalence for positive finite step sizes.

BPMTools.detect requires finite positive sample rate/BPM bounds, minBPM < maxBPM,
and positive safe-integer interval/scanSteps/scanSamples counts. The derived
interval must be finite and advance in floating point. Invalid options fail before
envelope allocation or scanning; defaults and valid empty-audio NaN are preserved.
The seeded synthetic 120 BPM click regression uses interval=8, scanSteps=64 and
scanSamples=128, with a 2 BPM tolerance.

The progress guard also rejects half-ULP tie cases that can stall at an even
mantissa. Preflight does not impose a wall-clock deadline or practical work ceiling:
callers choose the budget through scanSteps and scanSamples, whose product
determines scan work.

## Streaming analysis and fades

RMS is the amplitude square root of a finite rolling energy window, initially padded with zeros.
Analysis windows require an integer length of at least two; unsupported lengths throw RangeError.
Fade buffers sample the half-open interval `[start,end)` at `start+i*(end-start)/sampleCount`,
matching `gainAt` for curved and overlapping fades, and leave samples beyond the count untouched.
Spectral tests use deterministic bin-centered stereo sines and real FFT/window dependencies;
RMS tests compare scalar/block calls to an independent FIFO energy oracle.

Pulse tests cover finite positive sample rates, frequencies from zero through Nyquist (higher
positive values are capped), and duty widths clamped to [0,1]. One-harmonic cases have analytical
expectations; reset and pitch-change tests check deterministic state. C64Noise tests cover finite
nonnegative clocks, including fractional and multiple wraps, against an integer LFSR reference.

## WAV export admission

Both float32 and PCM16 encoders accept AudioData or AudioBufferLike sources.
Before output allocation they require equal, complete channel-plane lengths,
a matching declared channel count, a nonnegative safe-integer frame count and
maxLength, and a positive integer sample rate. Channel block alignment must fit
uint16; sample rate and byte rate must fit uint32. RIFF size must fit uint32,
including the 36-byte RIFF payload overhead. Malformed sources throw rather than
silently padding short channels. Validation covers full planes even for prefix
exports; maxLength deliberately selects at most that many frames, including zero.

Run `npm test -w @opendaw/lib-dsp` for exact interleaved prefix/header and
pre-allocation admission regressions.
