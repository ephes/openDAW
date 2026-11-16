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
