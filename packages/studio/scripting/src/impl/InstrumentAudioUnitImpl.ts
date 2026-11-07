import {AuxAudioUnit, GroupAudioUnit, Instrument, InstrumentAudioUnit, Instruments, Send} from "../Api"
import {AudioUnitImpl} from "./AudioUnitImpl"
import {SendImpl} from "./SendImpl"
import {InstrumentImpl} from "./InstrumentImpl"
import {Arrays, Procedure} from "@opendaw/lib-std"

export class InstrumentAudioUnitImpl extends AudioUnitImpl implements InstrumentAudioUnit {
    readonly kind = "instrument" as const
    readonly #sends: Array<SendImpl> = []

    instrument: InstrumentImpl

    constructor(instrumentName: keyof Instruments, constructorFn?: Procedure<never>) {
        super()
        this.instrument = new InstrumentImpl(this, instrumentName, constructorFn as Procedure<Instruments[keyof Instruments]> | undefined)
    }

    setInstrument(instrumentName: keyof Instruments, constructorFn?: Procedure<never>): Instrument {
        this.instrument = new InstrumentImpl(this, instrumentName, constructorFn as Procedure<Instruments[keyof Instruments]> | undefined)
        return this.instrument
    }

    addSend(target: AuxAudioUnit | GroupAudioUnit, props?: Partial<Send>): Send {
        const send = new SendImpl(target, props)
        this.#sends.push(send)
        return send
    }

    removeSend(send: Send): void {Arrays.remove(this.#sends, send)}

    get sends(): ReadonlyArray<SendImpl> {return this.#sends}
}
