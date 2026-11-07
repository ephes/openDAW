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
