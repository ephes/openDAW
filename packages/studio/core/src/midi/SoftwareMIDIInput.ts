import {
    assert,
    byte,
    clamp,
    DefaultObservableValue,
    int,
    Nullable,
    ObservableValue,
    safeExecute,
    unitValue
} from "@opendaw/lib-std"
import {MidiData} from "@opendaw/lib-midi"

type OnMidiMessage = Nullable<(this: MIDIInput, ev: MIDIMessageEvent) => unknown>

type OnStateChange = Nullable<(this: MIDIPort, ev: MIDIConnectionEvent) => unknown>

type ListenerRegistration = {
    type: string
    listener: EventListenerOrEventListenerObject
    capture: boolean
    wrapped: EventListener
    signal?: AbortSignal
    abort: () => void
}

export class SoftwareMIDIInput implements MIDIInput {
    readonly manufacturer: string | null = "openDAW"
    readonly connection: MIDIPortConnectionState = "open"
    readonly id: string = "software-midi-input"
    readonly name: string | null = "Software Keyboard"
    readonly state: MIDIPortDeviceState = "connected"
    readonly type: MIDIPortType = "input"
    readonly version: string | null = "1.0.0"

    readonly #dispatcher: EventTarget
    readonly #countListeners: DefaultObservableValue<int>
    readonly #activeNotes: number[]
    readonly #listeners: ListenerRegistration[] = []

    onstatechange: OnStateChange = null // has no effect. this device is always connected.

    #onmidimessage: OnMidiMessage = null
    #channel: byte = 0 // 0...15

    constructor() {
        this.#dispatcher = new EventTarget()
        this.#countListeners = new DefaultObservableValue(0)
        this.#activeNotes = new Array<number>(128).fill(0)
    }

    get onmidimessage(): OnMidiMessage {return this.#onmidimessage}
    set onmidimessage(value: OnMidiMessage) {
        const previous = this.#onmidimessage
        this.#onmidimessage = value
        if (previous === null && value !== null) {this.#changeListenerCount(1)}
        else if (previous !== null && value === null) {this.#changeListenerCount(-1)}
    }

    get countListeners(): ObservableValue<int> {return this.#countListeners}

    sendNoteOn(note: byte, velocity: unitValue = 1.0): void {
        assert(Number.isInteger(note) && note >= 0 && note <= 127, `Note must be between 0 and 127, but was ${note}`)
        assert(this.#activeNotes[note] < Number.MAX_SAFE_INTEGER, "Too many active presses")
        this.#activeNotes[note]++
        const velocityByte = Math.round(clamp(velocity, 0.0, 1.0) * 127.0)
        this.#sendMIDIMessageData(MidiData.noteOn(this.#channel, note, velocityByte))
    }

    sendNoteOff(note: byte): void {
        assert(Number.isInteger(note) && note >= 0 && note <= 127, `Note must be between 0 and 127, but was ${note}`)
        if (this.#activeNotes[note] === 0) {return}
        this.#activeNotes[note]--
        this.#sendMIDIMessageData(MidiData.noteOff(this.#channel, note))
    }

    releaseAllNotes(): void {
        const activeNotes = this.#activeNotes.slice()
        this.#activeNotes.fill(0)
        activeNotes.forEach((count, note) => {
            for (let i = 0; i < count; i++) {
                this.#sendMIDIMessageData(MidiData.noteOff(this.#channel, note))
            }
        })
    }

    hasActiveNote(note: byte): boolean {return this.#activeNotes[note] > 0}
    hasActiveNotes(): boolean {return this.#activeNotes.some(count => count > 0)}

    get channel(): byte {return this.#channel}
    set channel(value: byte) {
        assert(Number.isInteger(value) && value >= 0 && value <= 15, `Channel must be between 0 and 15, but was ${value}`)
        if (this.#channel === value) {return}
        this.releaseAllNotes()
        this.#channel = value
    }

    open(): Promise<MIDIPort> {return Promise.resolve(this)}
    close(): Promise<MIDIPort> {return Promise.resolve(this)}
    addEventListener<K extends keyof MIDIInputEventMap>(type: K, listener: (this: MIDIInput, ev: MIDIInputEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void
    addEventListener<K extends keyof MIDIPortEventMap>(type: K, listener: (this: MIDIPort, ev: MIDIPortEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void
    addEventListener(type: string, listener: Nullable<EventListenerOrEventListenerObject>, options?: boolean | AddEventListenerOptions): void
    addEventListener(type: string, listener: Nullable<EventListenerOrEventListenerObject>, options?: boolean | AddEventListenerOptions): void {
        if (listener === null) {return}
        const capture = typeof options === "boolean" ? options : options?.capture ?? false
        const signal = typeof options === "object" ? options.signal : undefined
        if (signal?.aborted || this.#listeners.some(entry =>
            entry.type === type && entry.listener === listener && entry.capture === capture)) {return}
        const once = typeof options === "object" && options.once
        const abort = () => this.removeEventListener(type, listener, capture)
        const wrapped: EventListener = event => {
            if (once) {abort()}
            if (typeof listener === "function") {listener.call(this, event)}
            else {listener.handleEvent(event)}
        }
        this.#dispatcher.addEventListener(type, wrapped, {
            capture, passive: typeof options === "object" && options.passive
        })
        this.#listeners.push({type, listener, capture, wrapped, signal, abort})
        signal?.addEventListener("abort", abort, {once: true})
        this.#changeListenerCount(1)
    }
    dispatchEvent(event: MIDIMessageEvent): boolean {
        safeExecute(this.#onmidimessage, event)
        return this.#dispatcher.dispatchEvent(event)
    }
    removeEventListener<K extends keyof MIDIInputEventMap>(type: K, listener: (this: MIDIInput, ev: MIDIInputEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void
    removeEventListener<K extends keyof MIDIPortEventMap>(type: K, listener: (this: MIDIPort, ev: MIDIPortEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void
    removeEventListener(type: string, listener: Nullable<EventListenerOrEventListenerObject>, options?: boolean | EventListenerOptions): void
    removeEventListener(type: string, listener: Nullable<EventListenerOrEventListenerObject>, options?: boolean | EventListenerOptions): void {
        const capture = typeof options === "boolean" ? options : options?.capture ?? false
        const index = this.#listeners.findIndex(entry =>
            entry.type === type && entry.listener === listener && entry.capture === capture)
        if (index === -1) {return}
        const [entry] = this.#listeners.splice(index, 1)
        this.#dispatcher.removeEventListener(type, entry.wrapped, capture)
        entry.signal?.removeEventListener("abort", entry.abort)
        this.#changeListenerCount(-1)
    }

    #sendMIDIMessageData(data: Uint8Array): void {
        const eventInit: MessageEventInit = {data}
        this.dispatchEvent(new MessageEvent("midimessage", eventInit))
    }

    #changeListenerCount(delta: -1 | 1): void {
        this.#countListeners.setValue(this.#countListeners.getValue() + delta)
    }
}