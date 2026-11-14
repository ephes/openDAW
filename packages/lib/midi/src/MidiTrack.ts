import {ArrayMultimap, ByteArrayOutput, int, isDefined} from "@opendaw/lib-std"
import {Channel} from "./Channel"
import {ControlEvent} from "./ControlEvent"
import {MetaEvent, MetaType} from "./MetaType"
import {MidiFileDecoder} from "./MidiFileDecoder"
import {ControlType} from "./ControlType"

export class MidiTrack {
    static decode(decoder: MidiFileDecoder): MidiTrack {
        const controlEvents: ArrayMultimap<Channel, ControlEvent> = new ArrayMultimap<Channel, ControlEvent>()
        const metaEvents: Array<MetaEvent> = []
        let ticks: int = 0
        let eventType: int = 0
        let channel: Channel = 0
        for (;;) {
            const varLen = decoder.readVarLen()
            ticks += varLen
            const b = decoder.readByte() & 0xff
            if (b < 0xf0) {
                // 0x00....0xEF (MidiControl)
                if (b < 0x80) {
                    // running mode, use the last eventType/channel!
                    decoder.skip(-1)
                } else {
                    eventType = b & 0xf0
                    channel = b & 0x0f
                }
                const event = ControlEvent.decode(decoder, eventType, ticks)
                if (isDefined(event)) {
                    controlEvents.add(channel, event)
                }
            } else if (b === 0xf0 || b === 0xf7) {
                decoder.skipSysEx(b)
            } else if (b === 0xff) {
                const event: MetaEvent | null = MetaEvent.decode(decoder, ticks)
                if (event !== null) {
                    metaEvents.push(event)
                    if (event.type === MetaType.END_OF_TRACK) {
                        break
                    }
                }
            } else {
                throw new Error("Unsupported MIDI system event")
            }
        }
        return new MidiTrack(controlEvents, metaEvents)
    }

    static createEmpty(): MidiTrack {return new MidiTrack(new ArrayMultimap<Channel, ControlEvent>(), [])}

    constructor(readonly controlEvents: ArrayMultimap<Channel, ControlEvent>,
                readonly metaEvents: Array<MetaEvent>) {}

    encode(): ArrayBufferLike {
        const timeline: {ticks: number, bytes: number[]}[] = []
        // Numeric channel order, then original event order, breaks equal-tick ties.
        for (const channel of Array.from(this.controlEvents.keys()).sort((a, b) => a - b)) {
            if (!Number.isInteger(channel) || channel < 0 || channel > 15) {throw new Error("Invalid MIDI channel")}
            for (const event of this.controlEvents.get(channel)) {
                let length: number
                switch (event.type) {
                    case ControlType.NOTE_ON:
                    case ControlType.NOTE_OFF:
                    case ControlType.CONTROLLER:
                    case ControlType.PITCH_BEND:
                    case ControlType.NOTE_AFTER_TOUCH: length = 2; break
                    case ControlType.PROGRAM_CHANGE:
                    case ControlType.CHANNEL_AFTER_TOUCH: length = 1; break
                    default: throw new Error("Unsupported MIDI control type")
                }
                const data = length === 1 ? [event.param0] : [event.param0, event.param1]
                if (data.some(value => !Number.isInteger(value) || value < 0 || value > 127)) {
                    throw new Error("Invalid MIDI channel data")
                }
                timeline.push({ticks: event.ticks, bytes: [event.type | channel, ...data]})
            }
        }
        let endTick = 0
        for (const event of this.metaEvents) {
            switch (event.type) {
                case MetaType.SET_TEMPO: {
                    const tempo = Math.round(60_000_000 / (event.value as number))
                    if (!Number.isInteger(tempo) || tempo < 1 || tempo > 0xffffff) {
                        throw new Error("Invalid MIDI tempo")
                    }
                    timeline.push({ticks: event.ticks, bytes: [0xff, event.type, 3,
                        Math.floor(tempo / 65536), Math.floor(tempo / 256) % 256, tempo % 256]})
                    break
                }
                case MetaType.TIME_SIGNATURE: {
                    const [numerator, denominator] = event.value as [number, number]
                    const exponent = Math.log2(denominator)
                    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 255
                        || !Number.isInteger(exponent) || exponent < 0 || exponent > 30) {
                        throw new Error("Invalid MIDI time signature")
                    }
                    timeline.push({ticks: event.ticks, bytes: [0xff, event.type, 4, numerator, exponent, 24, 8]})
                    break
                }
                case MetaType.END_OF_TRACK: endTick = Math.max(endTick, event.ticks); break
                default: break // Other metadata is not retained by the decoder.
            }
        }
        // Stable sort preserves same-channel order. Musical metadata precedes controls at a shared tick.
        timeline.sort((a, b) => a.ticks - b.ticks || (b.bytes[0] === 0xff ? 1 : 0) - (a.bytes[0] === 0xff ? 1 : 0))
        endTick = Math.max(endTick, timeline.at(-1)?.ticks ?? 0)
        timeline.push({ticks: endTick, bytes: [0xff, MetaType.END_OF_TRACK, 0]})
        const output = ByteArrayOutput.create()
        const writeVarInt = (value: int): void => {
            const bytes = [value % 128]
            for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
                bytes.unshift((rest % 128) | 0x80)
            }
            bytes.forEach(byte => output.writeByte(byte))
        }
        let ticks = 0
        for (const event of timeline) {
            writeVarInt(event.ticks - ticks)
            event.bytes.forEach(byte => output.writeByte(byte))
            ticks = event.ticks
        }
        return output.toArrayBuffer()
    }
}
