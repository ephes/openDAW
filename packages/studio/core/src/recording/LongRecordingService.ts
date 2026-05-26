import {int, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {AudioWorklets} from "../AudioWorklets"
import {CaptureSource, CaptureSourceMetadata} from "../capture-source"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {LongRecordingWorklet} from "./LongRecordingWorklet"

export interface LongRecordingHandle extends Terminable {
    readonly session: LongRecordingSession
    readonly worklet: LongRecordingWorklet
    readonly captureSource: CaptureSource
    readonly metadata: CaptureSourceMetadata

    stop(): Promise<void>
}

export interface LongRecordingServiceConfig {
    readonly worklets: AudioWorklets
    readonly storage: LongRecordingStorage
    readonly captureSource: CaptureSource
    readonly framesPerChunk: int
    readonly overviewSamplesPerBin?: int
    readonly now?: () => int
}

export namespace LongRecordingService {
    export const startFromSource = async (config: LongRecordingServiceConfig): Promise<LongRecordingHandle> => {
        const {worklets, storage, captureSource} = config
        const sampleRate = captureSource.metadata.actualSampleRate
        const numberOfChannels = captureSource.metadata.actualChannels
        const session = new LongRecordingSession({
            storage,
            sampleRate,
            numberOfChannels,
            framesPerChunk: config.framesPerChunk,
            source: CaptureSourceMetadata.toLongRecordingSource(captureSource.metadata),
            now: config.now,
            overviewSamplesPerBin: config.overviewSamplesPerBin
        })
        await session.arm()
        const worklet = worklets.createLongRecording(session, numberOfChannels)
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
            metadata: captureSource.metadata,
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
