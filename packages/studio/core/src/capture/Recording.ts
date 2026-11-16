import {assert, Option, Terminable, Terminator, tryCatch, UUID} from "@opendaw/lib-std"
import {Project} from "../project"
import {ppqn} from "@opendaw/lib-dsp"
import {RecordAutomation} from "./RecordAutomation"

export class Recording {
    static get isRecording(): boolean {return this.#isRecording}

    static async start(project: Project, countIn: boolean, signal?: AbortSignal): Promise<Terminable> {
        if (this.#isRecording) {
            return Promise.resolve(Terminable.Empty)
        }
        signal?.throwIfAborted()
        this.#isRecording = true
        assert(this.#instance.isEmpty(), "Recording already in progress")
        const {captureDevices, engine, editing} = project
        const terminator = new Terminator()
        // Install the final reset first: Terminator drains every resource even if
        // a capture's cleanup throws, so global ownership is always released.
        terminator.own({terminate: () => {
            this.#isRecording = false
            this.#instance = Option.None
        }})
        let transportAttempted = false
        try {
            const captures = captureDevices.filterArmed()
            const preparations = await Promise.allSettled(captures.map(async capture => {
                const prepared = await capture.prepareRecording()
                terminator.own(prepared)
            }))
            signal?.throwIfAborted()
            const failed = preparations.find(result => result.status === "rejected")
            if (failed?.status === "rejected") {throw failed.reason}
            for (const capture of captures) {
                signal?.throwIfAborted()
                capture.clearRecordedRegions()
                signal?.throwIfAborted()
                terminator.own(capture.startRecording())
            }
            signal?.throwIfAborted()
            if (project.engine.preferences.settings.recording.automationEnabled) {
                terminator.own(RecordAutomation.start(project))
            }
            const armedUUIDs = UUID.newSet<UUID.Bytes>(uuid => uuid)
            captures.forEach(capture => armedUUIDs.add(capture.audioUnitBox.address.uuid))
            project.regionSelection.deselect(...project.regionSelection.selected()
                .filter(region => region.trackBoxAdapter
                    .mapOr(track => armedUUIDs.hasKey(track.audioUnit.address.uuid), () => false)))
            signal?.throwIfAborted()
            transportAttempted = true
            engine.prepareRecordingState(countIn)
            const {isRecording, isCountingIn} = engine
            const stop = (): void => {
                if (isRecording.getValue() || isCountingIn.getValue()) {return}
                editing.modify(() => terminator.terminate(), false) // finalizes recording
            }
            terminator.own(engine.isRecording.subscribe(stop))
            terminator.own(engine.isCountingIn.subscribe(stop))
            this.#instance = Option.wrap(new Recording(countIn && !engine.isPlaying.getValue(), engine.position.getValue()))
            return terminator
        } catch (error) {
            if (transportAttempted) {tryCatch(() => engine.stopRecording())}
            const cleanup = tryCatch(() => terminator.terminate())
            if (cleanup.status === "failure") {console.warn("Recording startup cleanup failed")}
            throw error
        }
    }

    static #isRecording: boolean = false

    static #instance: Option<Recording> = Option.None

    static wasCountingIn(): boolean {return this.#instance.mapOr(recording => recording.countIn, () => false)}
    static wasStartingAt(): ppqn {return this.#instance.mapOr(recording => recording.startPosition, () => 0.0)}

    private constructor(readonly countIn: boolean, readonly startPosition: ppqn) {}
}