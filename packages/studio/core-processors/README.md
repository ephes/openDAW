# Core processor lifecycle contracts

Audio effect source registrations are independent leases. A superseded lease
cannot remove a newer attachment, even when both attach the same buffer. When
no source is attached, processors publish silence for their requested output span
(Nop processes the entire quantum). Detached DSP and effect tails stay suspended;
reattachment resumes them unless the caller explicitly resets the processor.

NAM shares concurrent WASM initialization and caches successful modules. Failed
initialization can be retried by a later explicit load. Pending model edits are
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
at its first span after reset. Gate retries a nonempty sidechain pointer until
its target output registers; retargeting and termination retire its graph edge.

From the repository root, run `npm ci`, `npm run build`, `npm run lint`, and
`npm test`. Processor tests use fake WASM, synthetic adapters, the local output
registry and deterministic sample buffers; they need no browser or real model.
See the [round 96 plan](../../../plans/scout-round96-effect-lifecycle.md) for
regression evidence and restart/partition comparison tolerances.
