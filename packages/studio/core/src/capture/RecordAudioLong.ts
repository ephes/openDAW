import {isDefined, Option, Terminable, Terminator, tryCatch, UUID} from "@opendaw/lib-std"
import {ppqn, TimeBase} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {ColorCodes, SampleLoaderManager, TrackType} from "@opendaw/studio-adapters"
import {Project} from "../project"
import {LongRecordingHandle} from "../recording/LongRecordingService"
import {Capture} from "./Capture"
import {RecordTrack} from "./RecordTrack"

export namespace RecordAudioLong {
    export interface Context {
        readonly handle: LongRecordingHandle
        readonly sampleManager: SampleLoaderManager
        readonly project: Project
        readonly capture: Capture
        readonly outputLatency: number
    }

    export const start = ({handle, sampleManager, project, capture, outputLatency}: Context): Terminable => {
        console.debug("[RecordAudioLong] start", {outputLatency, recordingId: handle.session.recordingId})
        const terminator = new Terminator()
        const {editing, engine, boxGraph, timelineBox, selection} = project
        const {env: {audioContext: {sampleRate: graphSampleRate}}} = project
        const recordingUuid: UUID.Bytes = UUID.parse(handle.session.recordingId)
        const recordingSampleRate = handle.session.manifest.sampleRate
        let fileBox: Option<AudioFileBox> = Option.None
        let regionBox: Option<AudioRegionBox> = Option.None
        let waveformOffset: number = 0

        const computeWaveformOffset = (): number => {
            const head = Math.max(0, handle.session.manifest.totalFrames / recordingSampleRate)
            return head + outputLatency
        }

        const createFileBox = (): AudioFileBox => {
            const stamp = new Date()
                .toISOString()
                .replaceAll("T", "-")
                .replaceAll(".", "-")
                .replaceAll(":", "-")
                .replaceAll("Z", "")
            const fileName = `Recording-${stamp}`
            return AudioFileBox.create(boxGraph, recordingUuid, box => box.fileName.setValue(fileName))
        }

        const createTakeRegion = (position: ppqn, waveformOffset: number): AudioRegionBox => {
            const track = RecordTrack.findOrCreate(editing, capture.audioUnitBox, TrackType.Audio, null)
            const collectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate())
            return AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                box.file.refer(fileBox.unwrap())
                box.events.refer(collectionBox.owners)
                box.regions.refer(track.regions)
                box.position.setValue(position)
                box.hue.setValue(ColorCodes.forTrackType(TrackType.Audio))
                box.timeBase.setValue(TimeBase.Seconds)
                box.label.setValue("Long Recording")
                box.waveformOffset.setValue(waveformOffset)
            })
        }

        const applyProgress = (): void => {
            if (regionBox.isEmpty() || fileBox.isEmpty()) {return}
            const region = regionBox.unwrap()
            const file = fileBox.unwrap()
            if (!region.isAttached() || !file.isAttached()) {return}
            const fullDuration = handle.session.manifest.totalFrames / recordingSampleRate
            const elapsed = Math.max(0, fullDuration - waveformOffset)
            editing.modify(() => {
                region.duration.setValue(elapsed)
                region.loopDuration.setValue(elapsed)
                file.endInSeconds.setValue(fullDuration)
            }, false)
        }

        terminator.ownAll(
            Terminable.create(() => {
                const totalFrames = handle.session.manifest.totalFrames
                if (totalFrames === 0 || fileBox.isEmpty()) {
                    console.debug("[RecordAudioLong] abort", {totalFrames, hasFile: fileBox.nonEmpty()})
                    sampleManager.remove(recordingUuid)
                    handle.session.abandon().catch(error =>
                        console.warn("[RecordAudioLong] abandon failed", error))
                    handle.terminate()
                    regionBox.ifSome(region => {
                        if (region.isAttached()) {editing.modify(() => region.delete(), false)}
                    })
                    fileBox.ifSome(file => {
                        if (file.isAttached()) {editing.modify(() => file.delete(), false)}
                    })
                    return
                }
                handle.stop().then(() => {
                    applyProgress()
                    project.trackUserCreatedSample(recordingUuid)
                    sampleManager.invalidate(recordingUuid)
                    editing.mark()
                }).catch(error => {
                    console.warn("[RecordAudioLong] stop failed", error)
                    handle.terminate()
                })
            }),
            handle.session.subscribeProgress(() => applyProgress()),
            engine.position.catchupAndSubscribe(owner => {
                const isCountingIn = engine.isCountingIn.getValue()
                const isRecording = engine.isRecording.getValue()
                if (!isCountingIn && !isRecording) {return}
                if (isCountingIn) {return}
                if (fileBox.isEmpty()) {
                    waveformOffset = computeWaveformOffset()
                    const startPosition = owner.getValue()
                    editing.modify(() => {
                        fileBox = Option.wrap(createFileBox())
                        const region = createTakeRegion(startPosition, waveformOffset)
                        regionBox = Option.wrap(region)
                        capture.addRecordedRegion(region)
                        selection.select(region)
                    }, false)
                }
                applyProgress()
            })
        )

        if (!isDefined(graphSampleRate)) {
            console.warn("[RecordAudioLong] missing graph sample rate; recording will still use the session's manifest rate")
        }

        return Terminable.create(() => {
            tryCatch(() => terminator.terminate())
        })
    }
}
