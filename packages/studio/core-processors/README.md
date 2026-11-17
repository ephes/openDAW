# Core processor lifecycle contracts

Audio effect source registrations are independent leases. A superseded lease
cannot remove a newer attachment, even when both attach the same buffer. When
no source is attached, processors publish silence for their requested output span
(Nop processes the entire quantum). Detached DSP and effect tails stay suspended;
reattachment resumes them unless the caller explicitly resets the processor.

NAM shares concurrent WASM initialization and caches successful modules. Failed
initialization can be retried by a later explicit load; a device whose model
apply failed applies its latest model once any later load has made the module ready. Pending model edits are
coalesced per device to the latest model. A failed mono-to-stereo activation keeps
the usable mono mode; toggling the mono control retries stereo. Missing/failed
complete model loads use dry bypass. Termination attempts both channels' unload
and destruction even after a base cleanup error and reports the first failure.
Retired devices cannot apply pending models or release an instance twice.

The delay's linked-channel limiter has 50 ms attack and 250 ms release. Delay reset
clears modulation smoothing history to the same zero start as a new device at the
same controls. Vocoder coefficients advance once per 64 processed samples across
partial blocks; a control change inside that interval is consumed at the next
boundary. Reset snaps coefficients and band fades to current controls and clears
filter/envelope history. Stereo Tool similarly snaps the current matrix controls
at its first span after reset. Gate, Compressor and Vocoder retry a nonempty
sidechain pointer until its target output registers; retargeting and termination
retire the graph edge.

From the repository root, run `npm ci`, `npm run build`, `npm run lint`, and
`npm test`. Processor tests use fake WASM, synthetic adapters, the local output
registry and deterministic sample buffers; they need no browser or real model.
See the [round 96 plan](../../../plans/scout-round96-effect-lifecycle.md) for
regression evidence and restart/partition comparison tolerances.

### Script generation faults

A constructor or parameter-callback failure quarantines that compiled generation
and reports once. Processing other devices continues. Compile new code to recover.
A matching registry entry is constructed at most once; a registry entry that has
not arrived yet is still polled on later blocks.

Spielwerk keeps source reverse indexes only for live output notes. Faults drain
active output through matching stop events before any replacement generation is
constructed. The drain also applies to notes emitted earlier in the failing pull.
Scheduled descendants retain their source and transport generation. See the
[Spielwerk manual](../../app/studio/public/manuals/devices/midi/spielwerk.md) and
[Werkstatt manual](../../app/studio/public/manuals/devices/audio/werkstatt.md) for
finite note admission and owned output-buffer contracts.

### Nano and Playfield ownership

Nano refuses note starts while disabled. Changing its file pointer retires held
voices and the note display immediately; only new notes use the new sample.

Nano interpolates up to the final frame, holding that endpoint until the source
position reaches its frame count. Mono duplicates into stereo. Playfield mix
attachments are independent, idempotent leases, including duplicate buffers;
teardown retires all remaining attachments.

### Revamp transient state

Reset clears the analyser window, retained bins and published spectrum immediately.
Subscriptions remain active. Each band enable transition clears that band's
filter history, including stacked HP/LP filters; coefficients and order stay set.
Re-enabling starts from silence rather than resuming pre-bypass ringing.

### Render partitions and restart

Tidal derives phase from each chunk's pulse origin and relative sample offset;
metering consumes only that span. Fold reset retires all anti-alias resampler
history and snaps drive/output ramps to current controls, preserving oversampling.

### Native DSP outcomes

A NAM process exception retires both native instances and reports one fixed
diagnostic. The complete requested span uses dry bypass, including when a native
channel already wrote partial output. Later blocks stay bypassed; reset and mono
edits do not retry that generation. Selecting a different valid model (or
recreating the processor, e.g. by reopening the project) creates new instances
and permits recovery; re-selecting the same model sends no model change and
stays bypassed. Cleanup attempts both channels even
if unloading one fails. Dattorro restart/partition tests exercise the real network
at 44.1, 48 and 96 kHz, including nonzero pre-delay and unity dry stereo routing.

### Maximizer latency modes

Changing lookahead mode clears queued stereo audio, detector envelope/peak hold
and reduction publication. Controls and any threshold ramp keep their values;
the transition deliberately drops the old tail and can create a discontinuity.
Lookahead restarts with ceil(sampleRate × 0.005) silent latency frames. Its linked
stereo gain targets -0.001 dBFS headroom and clamps output to full scale. The
zero-latency mode keeps the detector attack and can overshoot during transients.
Both modes preserve channel ratios and processing across partial spans.

### Instrument restart and playback

Vaporisateur refuses note starts while disabled. Reset (including disable) retires
voices, output and limiter history while preserving controls. Re-enabling requires
a new note start.

Playfield treats equal endpoints and sources shorter than two frames as empty
playback intervals in every gate mode; they retire without audio. Nonfinite or
out-of-source endpoints/rates retire too. Nonempty loops preserve fractional
overshoot in either direction with constant work per frame, even for adjacent
representable endpoints.

Playfield one-shots contribute their current interpolated frame before retiring at
source boundaries, including position zero in reverse. Gate.On tapers by remaining
source distance in either direction. Zero attack/release controls use one sample.
Each sample owns at most 16 live voices, including release tails. A new start at
the ceiling discards the oldest voice immediately (a possible discontinuity).
Note-offs still match the surviving event IDs; mono retriggers and choke-group
release dispatch remain intact. Position broadcasts include a terminator after
all 16 voices.

Tape skips an unavailable timeline region (including a stretch region with fewer
than two transients) while continuing independent regions on the same lane.
Disabling an audio lane or changing it to another track type immediately discards
all its pitch, fade and stretch voices. Device reset discards them too. This hard
retirement can create a mute discontinuity, but no old tail returns on re-enable.
Transport stops/seeks retain their existing fade policy.

Tape pitch voices bind both the source UUID and the admitted AudioData object.
Replacing that data discards the previous generation and its pending fade tails;
the replacement uses the ordinary new-voice fade policy. In-place PCM mutation
is not a generation change: loaders must publish a new AudioData object.
Cycle start/end boundaries are each floored to output frames, then their difference
defines the span. Empty quantized spans do no work. Pitch and stretch gain buffers
use those same boundaries and evaluate region fades on the output frame grid,
so adjacent fractional cycles cover each frame once across block partitions.

Soundfont sample mode 0 plays once, mode 1 loops through its release envelope,
and mode 3 stops wrapping on note-off and plays the natural sample tail. Loop
admission requires integral sample-relative bounds with `0 <= start < end <=
length`. Invalid bounds and unsupported modes fall back to nonlooping playback;
empty samples and nonfinite/nonpositive playback rates retire silently without
reading PCM. Other voices continue. Valid loops wrap arbitrary finite overshoot
with modulo arithmetic, including one-frame loops and high pitches.

### MIDI and insert-return chain retirement

Chain termination disconnects all wiring, releases collection/phase observers and
retires every owned effect together with its enabled-field subscription. Repeated
termination is harmless; edits to former effects cannot rewire the retired chain.

### Clip graph ownership

Clip contexts release graph observation before clearing their state. Track deletion
stops its playing clip, marks its queued clip obsolete and removes the track state;
subsequent clip deletions visit only retained live tracks.

Selecting the playing clip cancels a queued replacement or stop; a superseded
queued clip becomes obsolete. Launch/stop quantization uses the first boundary at
or after the span start. Spans own `[from, to)`: a right-endpoint launch waits
for the next nonempty span, so large and partitioned renders launch identically.

One-shots end at their actual launch position plus their current duration, including
when launch and end fall within one large span. The engine reports each render's
transport blocks (`followTransport`) with their cumulative jump offset; when a track's
iteration reaches a block after a loop wrap, marker jump or seek, the launch is re-based so
the one-shot keeps its already played span and still ends after one duration. Point queries
such as automation `valueAt` never move the launch. Queued replacement quantization
remains independent of that end. Only finite positive clip durations are admitted:
invalid launch requests become obsolete; invalid queued or playing clips retire
on the next nonempty iteration (obsolete or stopped respectively). Repairing the
duration allows an explicit new launch. Empty spans perform no scheduling work.

### Clock publication

The timestamp worker brackets each response-counter/timestamp write with an
odd/even Int32 publication sequence in word 3 of the existing 32-byte buffer.
HRClock accepts only a stable even observation and consecutive response counters
in the modular Int32 domain, including signed rollover and zero. Initialization
is independent of counter sign. Overlapping or skipped publications return zero
for that measurement without waiting or retrying on the audio thread.

### Source replacement and empty delay spans

Input and frozen-source replacement constructs the next owner before disconnecting
or retiring the current source. Construction failure preserves the current source
and wiring. `EngineContext.constructAtomically` scopes processor/edge registrations
made during construction: they unwind on failure, completed sources own their leases
(the source keeps the real context, no wrapper), and successful replacement retires
the previous source once.

An empty Delay span touches neither output nor DSP/pre-delay history. Changing
controls after an empty first call initializes the delay just like a fresh network,
including after reset; smoothing begins only after actual frames were processed.

Auxiliary send enable state gates its effective gain while preserving the saved
level and pan. Disabling and re-enabling use the existing gain ramps. Existing
projects default auxiliary sends to enabled.
