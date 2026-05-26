import {int, isDefined, Observer, Subscription, Terminable} from "@opendaw/lib-std"

export type CaptureSourceKind = "getUserMedia" | "synthetic"

export interface CaptureSourceMetadata {
    readonly kind: CaptureSourceKind
    readonly label: string
    readonly deviceId?: string
    readonly deviceLabel?: string
    readonly requestedSampleRate: int
    readonly requestedChannels: int
    /**
     * Sample rate of the PCM that the source's `outputNode` actually emits. This is the
     * `AudioContext` / worklet sample rate — i.e. the clock the recorder writes at. It is NOT
     * the device-reported sample rate; the browser may resample between the device and the
     * graph. Downstream recording uses this value as the manifest sample rate.
     */
    readonly actualSampleRate: int
    /**
     * Sample rate the underlying input device reports (for getUserMedia,
     * `MediaStreamTrack.getSettings().sampleRate`). Diagnostic-only; if it differs from
     * `actualSampleRate` the browser is resampling between device and graph, which is
     * surfaced as a `device-sample-rate` mismatch but never used for recording timing.
     */
    readonly deviceSampleRate?: int
    /**
     * Channels delivered by the underlying device before any channel mapping is applied.
     * For getUserMedia this is `MediaStreamTrack.getSettings().channelCount`; for synthetic sources
     * it is the oscillator count.
     */
    readonly deviceChannels: int
    /**
     * Channels in the source's `outputNode` after any `CaptureChannelMap` is applied. This is the value
     * that downstream recording uses for chunk encoding and that the manifest persists as `actualChannels`.
     */
    readonly actualChannels: int
    readonly autoGainControl?: boolean
    readonly echoCancellation?: boolean
    readonly noiseSuppression?: boolean
}

export interface CaptureContinuityReport {
    readonly droppedBlocks: int
    readonly droppedFrames: int
    readonly underruns: int
    readonly errors: ReadonlyArray<string>
}

export interface CaptureSource extends Terminable {
    readonly metadata: CaptureSourceMetadata
    readonly outputNode: AudioNode

    subscribeContinuity(observer: Observer<CaptureContinuityReport>): Subscription

    subscribeErrors(observer: Observer<unknown>): Subscription
}

export interface CaptureSourceMismatch {
    readonly kind: "sample-rate" | "channel-count" | "auto-processing-modified" | "device-sample-rate"
    readonly message: string
    readonly requested: number | boolean | string
    readonly actual: number | boolean | string
}

export namespace CaptureSourceMetadata {
    export const mismatches = (metadata: CaptureSourceMetadata): ReadonlyArray<CaptureSourceMismatch> => {
        const reports: Array<CaptureSourceMismatch> = []
        if (metadata.requestedSampleRate !== metadata.actualSampleRate) {
            reports.push({
                kind: "sample-rate",
                message: `Requested sample rate ${metadata.requestedSampleRate} but got ${metadata.actualSampleRate}`,
                requested: metadata.requestedSampleRate,
                actual: metadata.actualSampleRate
            })
        }
        if (metadata.requestedChannels !== metadata.actualChannels) {
            reports.push({
                kind: "channel-count",
                message: `Requested ${metadata.requestedChannels} channel(s) but got ${metadata.actualChannels}`,
                requested: metadata.requestedChannels,
                actual: metadata.actualChannels
            })
        }
        if (isDefined(metadata.deviceSampleRate) && metadata.deviceSampleRate !== metadata.actualSampleRate) {
            reports.push({
                kind: "device-sample-rate",
                message: `Device reports sample rate ${metadata.deviceSampleRate} but recording graph runs at ${metadata.actualSampleRate}; browser is resampling`,
                requested: metadata.actualSampleRate,
                actual: metadata.deviceSampleRate
            })
        }
        if (metadata.echoCancellation === true || metadata.noiseSuppression === true
            || metadata.autoGainControl === true) {
            reports.push({
                kind: "auto-processing-modified",
                message: "Browser auto-processing is enabled; audio may be modified by AGC / noise suppression / echo cancel",
                requested: false,
                actual: true
            })
        }
        return reports
    }
}
