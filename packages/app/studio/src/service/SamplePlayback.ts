import {
    ArrayMultimap,
    clamp,
    DefaultObservableValue,
    Option,
    Procedure,
    RuntimeNotifier,
    Subscription,
    unitValue,
    UUID
} from "@opendaw/lib-std"
import {OpenSampleAPI, SampleStorage} from "@opendaw/studio-core"
import {dbToGain, WavFile} from "@opendaw/lib-dsp"

export type PlaybackEvent = {
    type: "idle"
} | {
    type: "buffering"
} | {
    type: "playing"
} | {
    type: "error"
    reason: string
}

export class SamplePlayback {
    readonly #audio: HTMLAudioElement
    readonly #notifiers: ArrayMultimap<string, Procedure<PlaybackEvent>>
    readonly #linearVolume: DefaultObservableValue<unitValue>

    #current: Option<string> = Option.None
    #errorDialogOpen: boolean = false
    #generation = 0
    #loading = false
    #ownedUrl: string | undefined

    constructor() {
        this.#audio = new Audio()
        this.#audio.crossOrigin = "use-credentials"
        this.#audio.preload = "auto"
        this.#audio.onerror = () => {
            this.#current.ifSome(uuid => this.#notify(uuid, {type: "error", reason: "Unsupported format"}))
            if (this.#errorDialogOpen) {return}
            this.#errorDialogOpen = true
            RuntimeNotifier.info({
                headline: "Playback Error",
                message: "Your browser does not support playing this audio format."
            }).finally(() => this.#errorDialogOpen = false)
        }
        this.#notifiers = new ArrayMultimap<string, Procedure<PlaybackEvent>>()
        this.#linearVolume = new DefaultObservableValue<number>(0.0, {
            guard: (value: number): number => clamp(value, -36, 0)
        })
        this.#linearVolume.catchupAndSubscribe(owner => this.#audio.volume = dbToGain(owner.getValue()))
    }

    toggle(uuidAsString: string): void {
        if (this.#current.contains(uuidAsString)) {
            if (this.#loading) {return}
            if (this.#audio.paused) {
                this.#notify(uuidAsString, {type: "buffering"})
                this.#play(uuidAsString, this.#generation)
            } else {
                ++this.#generation
                this.#audio.currentTime = 0.0
                this.#audio.pause()
            }
            return
        }
        this.eject()
        const generation = this.#generation
        this.#current = Option.wrap(uuidAsString)
        this.#watchAudio(uuidAsString)
        this.#loading = true
        this.#notify(uuidAsString, {type: "buffering"})
        void SampleStorage.get().load(UUID.parse(uuidAsString)).then(([audio]) => {
            if (generation !== this.#generation) {return}
            const url = URL.createObjectURL(new Blob([WavFile.encodeFloats({
                frames: audio.frames.slice(),
                sampleRate: audio.sampleRate,
                numberOfFrames: audio.numberOfFrames,
                numberOfChannels: audio.numberOfChannels
            })], {type: "audio/wav"}))
            this.#ownedUrl = url
            this.#audio.src = url
        }, () => {
            if (generation === this.#generation) {this.#audio.src = `${OpenSampleAPI.FileRoot}/${uuidAsString}`}
        }).then(() => {
            if (generation !== this.#generation) {return}
            this.#loading = false
            this.#play(uuidAsString, generation)
        }).catch(() => {
            if (generation !== this.#generation) {return}
            this.eject()
            this.#notify(uuidAsString, {type: "error", reason: "Could not prepare preview; try again"})
        })
    }

    eject(): void {
        ++this.#generation
        this.#loading = false
        this.#unwatchAudio()
        this.#audio.pause()
        this.#audio.removeAttribute("src")
        this.#audio.load()
        if (this.#ownedUrl !== undefined) {
            URL.revokeObjectURL(this.#ownedUrl)
            this.#ownedUrl = undefined
        }
        this.#current.ifSome(uuid => this.#notify(uuid, {type: "idle"}))
        this.#current = Option.None
    }

    #play(uuid: string, generation: number): void {
        void this.#audio.play().catch(() => {
            if (generation !== this.#generation) {return}
            this.#notify(uuid, {type: "error", reason: "Could not play preview; try again"})
        })
    }

    subscribe(uuidAsString: string, procedure: Procedure<PlaybackEvent>): Subscription {
        this.#notifiers.add(uuidAsString, procedure)
        return {terminate: () => this.#notifiers.remove(uuidAsString, procedure)}
    }

    get linearVolume(): DefaultObservableValue<number> {return this.#linearVolume}

    #notify(uuidAsString: string, event: PlaybackEvent): void {
        this.#notifiers.get(uuidAsString).forEach(procedure => procedure(event))
    }

    #watchAudio(uuidAsString: string): void {
        this.#audio.onended = () => this.#notify(uuidAsString, {type: "idle"})
        this.#audio.ontimeupdate = () => {
            if (!this.#audio.paused && this.#audio.duration > 0.0) {this.#notify(uuidAsString, {type: "playing"})}
        }
        this.#audio.onpause = () => this.#notify(uuidAsString, {type: "idle"})
        this.#audio.onstalled = () => this.#notify(uuidAsString, {type: "buffering"})
    }

    #unwatchAudio(): void {
        this.#audio.onended = null
        this.#audio.onplay = null
        this.#audio.onpause = null
        this.#audio.onstalled = null
        this.#audio.ontimeupdate = null
    }
}