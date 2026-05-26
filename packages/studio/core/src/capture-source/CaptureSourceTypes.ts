import {int, Observer, Subscription, Terminable} from "@opendaw/lib-std"

export type CaptureSourceKind = "getUserMedia" | "synthetic"

export interface CaptureSourceMetadata {
    readonly kind: CaptureSourceKind
    readonly label: string
    readonly deviceId?: string
    readonly deviceLabel?: string
    readonly requestedSampleRate: int
    readonly requestedChannels: int
    readonly actualSampleRate: int
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
    readonly kind: "sample-rate" | "channel-count" | "auto-processing-modified"
    readonly message: string
    readonly requested: number | boolean | string
    readonly actual: number | boolean | string
}

export namespace CaptureSourceMetadata {
    export const toLongRecordingSource = (metadata: CaptureSourceMetadata): {
        readonly kind: "getUserMedia" | "synthetic"
        readonly label: string
        readonly requestedSampleRate: int
        readonly requestedChannels: int
        readonly actualSampleRate: int
        readonly actualChannels: int
    } => ({
        kind: metadata.kind,
        label: metadata.label,
        requestedSampleRate: metadata.requestedSampleRate,
        requestedChannels: metadata.requestedChannels,
        actualSampleRate: metadata.actualSampleRate,
        actualChannels: metadata.actualChannels
    })

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
