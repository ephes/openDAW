import {
    AnyClipBoxAdapter,
    ClipSequencing,
    ClipSequencingUpdates,
    Section,
    TrackBoxAdapter
} from "@opendaw/studio-adapters"
import {Arrays, identity, Option, quantizeCeil, SortedSet, Terminator, UUID} from "@opendaw/lib-std"
import {ppqn, PPQN} from "@opendaw/lib-dsp"
import {BoxGraph, Update} from "@opendaw/lib-box"

// Just convenient to identify which UUID is for which type
type ClipKey = UUID.Bytes
type TrackKey = UUID.Bytes

class TrackState {
    waiting: Option<Option<AnyClipBoxAdapter>> = Option.None
    playing: Option<AnyClipBoxAdapter> = Option.None
    launchPosition: ppqn = 0

    constructor(readonly uuid: TrackKey) {}
}

export class ClipSequencingAudioContext implements ClipSequencing {
    readonly #terminator = new Terminator()
    readonly #states: SortedSet<TrackKey, TrackState>

    readonly #started: Array<ClipKey> = []
    readonly #stopped: Array<ClipKey> = []
    readonly #obsolete: Array<ClipKey> = []

    constructor(boxGraph: BoxGraph) {
        this.#states = UUID.newSet<TrackState>(state => state.uuid)
        this.#terminator.own(boxGraph.subscribeToAllUpdatesImmediate({
            onUpdate: (update: Update) => {
                if (update.type === "delete") {
                    const uuid = update.uuid
                    // handle track deletion
                    this.#states.opt(uuid).ifSome(state => {
                        state.playing.ifSome(playing => this.#onStop(playing.uuid))
                        state.waiting.flatMap(identity).ifSome(clip => this.#obsolete.push(clip.uuid))
                        this.#states.removeByKey(uuid)
                    })
                    // handle clip deletion
                    this.#states.forEach(state => {
                        if (state.playing.nonEmpty() && UUID.equals(state.playing.unwrap().uuid, uuid)) {
                            state.playing = Option.None
                            this.#onStop(uuid)
                        }
                        const optWaiting = state.waiting.flatMap(identity)
                        if (optWaiting.nonEmpty() && UUID.equals(optWaiting.unwrap().uuid, uuid)) {
                            state.waiting = Option.None
                        }
                    })
                }
            }
        }))
    }

    schedulePlay(clipAdapter: AnyClipBoxAdapter): void {
        if (!this.#validDuration(clipAdapter)) {
            this.#obsolete.push(clipAdapter.uuid)
            return
        }
        clipAdapter.trackBoxAdapter.ifSome(({uuid}) => {
            const trackState = this.#states.getOrCreate(uuid, uuid => new TrackState(uuid))
            const optClip = trackState.waiting.flatMap(waiting => waiting)
            if (optClip.nonEmpty()) {
                console.debug("obsolete", optClip.unwrap())
                this.#obsolete.push(optClip.unwrap().uuid)
            }
            trackState.waiting = Option.None
            if (trackState.playing.nonEmpty() && trackState.playing.unwrap() === clipAdapter) {
                console.debug(`${clipAdapter} is already playing (ignore)`)
                return
            }
            console.debug(`schedulePlay(${UUID.toString(trackState.uuid)} > ${clipAdapter})`)
            Arrays.removeOpt(this.#obsolete, clipAdapter.uuid)
            trackState.waiting = Option.wrap(Option.wrap(clipAdapter))
        })
    }

    scheduleStop({uuid}: TrackBoxAdapter): void {
        const trackState = this.#states.getOrCreate(uuid, uuid => new TrackState(uuid))
        const optClip = trackState.waiting.flatMap(waiting => waiting)
        if (optClip.nonEmpty()) {
            console.debug("obsolete", optClip.unwrap())
            this.#obsolete.push(optClip.unwrap().uuid)
            trackState.waiting = Option.None
        }
        if (trackState.playing.nonEmpty()) {
            console.debug(`scheduleStop(${UUID.toString(uuid)})`)
            trackState.waiting = Option.wrap(Option.None)
        }
    }

    reset(): void {
        this.#states.forEach(state => {
            state.waiting.ifSome(waiting => waiting.ifSome(clip => this.#obsolete.push(clip.uuid)))
            state.waiting = Option.None
            state.playing.ifSome(clip => this.#onStop(clip.uuid))
            state.playing = Option.None
        })
        this.#states.clear()
    }

    * iterate(trackKey: TrackKey, p0: ppqn, p1: ppqn): IterableIterator<Section> {
        if (p0 >= p1) {return}
        const state = this.#states.getOrNull(trackKey)
        if (state === null) {
            yield {optClip: Option.None, sectionFrom: p0, sectionTo: p1}
            return
        }
        state.waiting.flatMap(identity).ifSome(clip => {
            if (!this.#validDuration(clip)) {
                this.#obsolete.push(clip.uuid)
                state.waiting = Option.None
            }
        })
        state.playing.ifSome(clip => {
            if (!this.#validDuration(clip)) {
                this.#onStop(clip.uuid)
                state.playing = Option.None
            }
        })
        if (state.waiting.nonEmpty()) {
            const optNextClip = state.waiting.unwrap()
            // Replacement quantization is independent of a one-shot's natural end.
            const scheduleDuration = state.playing.mapOr(clip => clip.duration, PPQN.Bar)
            const scheduleEnd = quantizeCeil(p0, scheduleDuration)
            if (scheduleEnd < p1) {
                yield* this.#playingSections(state, p0, scheduleEnd)
                state.waiting = Option.None
                state.playing.ifSome(clip => this.#onStop(clip.uuid))
                state.playing = optNextClip
                state.launchPosition = scheduleEnd
                optNextClip.ifSome(clip => this.#onStart(clip.uuid))
                yield* this.#playingSections(state, scheduleEnd, p1)
                return
            }
        }
        yield* this.#playingSections(state, p0, p1)
    }

    * #playingSections(state: TrackState, p0: ppqn, p1: ppqn): IterableIterator<Section> {
        if (p0 >= p1) {return}
        if (state.playing.nonEmpty()) {
            const clip = state.playing.unwrap()
            if (!clip.box.triggerMode.loop.getValue()) {
                const end = state.launchPosition + clip.duration
                if (end <= p1) {
                    if (p0 < end) {
                        yield {optClip: state.playing, sectionFrom: p0, sectionTo: end}
                    }
                    state.playing = Option.None
                    this.#onStop(clip.uuid)
                    if (end < p1) {
                        yield {optClip: Option.None, sectionFrom: Math.max(p0, end), sectionTo: p1}
                    }
                    return
                }
            }
        }
        yield {optClip: state.playing, sectionFrom: p0, sectionTo: p1}
    }

    #validDuration(clip: AnyClipBoxAdapter): boolean {
        return Number.isFinite(clip.duration) && clip.duration > 0
    }

    changes(): Option<ClipSequencingUpdates> {
        if (this.#started.length > 0 || this.#stopped.length > 0 || this.#obsolete.length > 0) {
            const changes = Option.wrap({
                started: this.#started.slice(),
                stopped: this.#stopped.slice(),
                obsolete: this.#obsolete.slice()
            })
            this.#started.length = 0
            this.#stopped.length = 0
            this.#obsolete.length = 0
            return changes
        }
        return Option.None
    }

    terminate(): void {
        this.#terminator.terminate()
        this.#states.clear()
        this.#started.length = 0
        this.#stopped.length = 0
        this.#obsolete.length = 0
    }

    #onStart(clipKey: ClipKey): void {this.#started.push(clipKey)}
    #onStop(clipKey: ClipKey): void {this.#stopped.push(clipKey)}
}