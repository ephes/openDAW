import {int, isDefined, Optional, Terminable} from "@opendaw/lib-std"

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

export interface CaptureSource extends Terminable {
    readonly metadata: CaptureSourceMetadata
    readonly outputNode: AudioNode
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

    export interface TrackMetadataParams {
        readonly requestedSampleRate: int
        readonly requestedChannels: int
        readonly actualSampleRate: int
        readonly actualChannels: int
    }

    /**
     * Derive `getUserMedia` capture metadata from a `MediaStreamTrack`. Shared by
     * `GetUserMediaCaptureSource` and `CaptureAudio` so the device/label/sample-rate/auto-processing
     * fields are read in exactly one place. The channel/sample-rate values that differ per caller
     * are passed in explicitly. `deviceChannels` falls back to `actualChannels` when the track does
     * not report a channel count.
     */
    export const fromMediaStreamTrack = (
        track: Optional<MediaStreamTrack>,
        params: TrackMetadataParams
    ): CaptureSourceMetadata => {
        const trackSettings = track?.getSettings() ?? {}
        return {
            kind: "getUserMedia",
            label: track?.label ?? "default",
            deviceId: trackSettings.deviceId,
            deviceLabel: track?.label,
            requestedSampleRate: params.requestedSampleRate,
            requestedChannels: params.requestedChannels,
            actualSampleRate: params.actualSampleRate,
            deviceSampleRate: trackSettings.sampleRate,
            deviceChannels: trackSettings.channelCount ?? params.actualChannels,
            actualChannels: params.actualChannels,
            autoGainControl: trackSettings.autoGainControl,
            echoCancellation: trackSettings.echoCancellation,
            noiseSuppression: trackSettings.noiseSuppression
        }
    }
}
