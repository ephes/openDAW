import {int, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {AudioWorklets} from "../AudioWorklets"
import {CaptureSource, CaptureSourceMetadata} from "../capture-source"
import {LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {LongRecordingWorklet} from "./LongRecordingWorklet"

export const captureMetadataToLongRecordingSource = (metadata: CaptureSourceMetadata): LongRecordingSource => ({
    kind: metadata.kind,
    label: metadata.label,
    requestedSampleRate: metadata.requestedSampleRate,
    requestedChannels: metadata.requestedChannels,
    actualSampleRate: metadata.actualSampleRate,
    actualChannels: metadata.actualChannels
})

export interface LongRecordingHandle extends Terminable {
    readonly session: LongRecordingSession
    readonly worklet: LongRecordingWorklet
    readonly captureSource: CaptureSource
    readonly metadata: CaptureSourceMetadata

    stop(): Promise<void>
}

export interface LongRecordingArmedSession {
    readonly session: LongRecordingSession
    readonly captureSource: CaptureSource
    readonly metadata: CaptureSourceMetadata
}

export interface LongRecordingPrepareConfig {
    readonly storage: LongRecordingStorage
    readonly captureSource: CaptureSource
    readonly framesPerChunk: int
    readonly overviewSamplesPerBin?: int
    readonly now?: () => int
}

export interface LongRecordingServiceConfig extends LongRecordingPrepareConfig {
    readonly worklets: AudioWorklets
}

export namespace LongRecordingService {
    /**
     * Build and arm a `LongRecordingSession` from a `CaptureSource`. This is the testable half: it pulls the
     * actual sample-rate / channel-count / metadata off the capture source, projects metadata into the
     * manifest's source block via {@link captureMetadataToLongRecordingSource}, and persists the initial
     * active manifest. The caller is responsible for wiring `captureSource.outputNode` into a worklet.
     */
    export const prepareSessionFromCaptureSource = async (
        config: LongRecordingPrepareConfig
    ): Promise<LongRecordingArmedSession> => {
        const {storage, captureSource} = config
        const sampleRate = captureSource.metadata.actualSampleRate
        const numberOfChannels = captureSource.metadata.actualChannels
        const session = new LongRecordingSession({
            storage,
            sampleRate,
            numberOfChannels,
            framesPerChunk: config.framesPerChunk,
            source: captureMetadataToLongRecordingSource(captureSource.metadata),
            now: config.now,
            overviewSamplesPerBin: config.overviewSamplesPerBin
        })
        await session.arm()
        return {session, captureSource, metadata: captureSource.metadata}
    }

    /**
     * Build, arm, and connect a long-recording session end-to-end against the given capture source. The
     * returned handle owns the worklet, the capture source, and the session; calling `stop()` drains the
     * write queue and terminates all three.
     */
    export const startFromSource = async (config: LongRecordingServiceConfig): Promise<LongRecordingHandle> => {
        const armed = await prepareSessionFromCaptureSource(config)
        const {session, captureSource, metadata} = armed
        const worklet = config.worklets.createLongRecording(session, metadata.actualChannels)
        captureSource.outputNode.connect(worklet)
        const terminator = new Terminator()
        terminator.own({
            terminate: () => {
                captureSource.outputNode.disconnect(worklet)
            }
        })
        return {
            session,
            worklet,
            captureSource,
            metadata,
            terminate(): void {
                terminator.terminate()
                captureSource.terminate()
                worklet.terminate()
            },
            async stop(): Promise<void> {
                terminator.terminate()
                await session.stop()
                captureSource.terminate()
                worklet.terminate()
            }
        }
    }

    export const recordingIdFromHandle = (handle: LongRecordingHandle): UUID.String =>
        handle.session.recordingId
}
