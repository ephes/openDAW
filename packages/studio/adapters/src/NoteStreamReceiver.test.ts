import {expect, it} from "vitest"
import {LiveStreamBroadcaster, LiveStreamReceiver} from "@opendaw/lib-fusion"
import {Address} from "@opendaw/lib-box"
import {Terminable} from "@opendaw/lib-std"
import {NoteBroadcaster} from "./NoteBroadcaster"
import {NoteStreamReceiver} from "./NoteStreamReceiver"

it.each([31, 63, 95, 127])("displays boundary note %s through overlapping releases", note => {
    let shared!: Int32Array
    let deliver!: (array: Int32Array) => void
    const address = {} as Address
    const sender = new NoteBroadcaster({broadcastIntegers: (_address: Address, array: Int32Array) => {
        shared = array; return Terminable.Empty
    }} as unknown as LiveStreamBroadcaster, address)
    const receiver = new NoteStreamReceiver({subscribeIntegers: (_address: Address, callback: typeof deliver) => {
        deliver = callback; return Terminable.Empty
    }} as unknown as LiveStreamReceiver, address)
    sender.noteOn(note); sender.noteOn(note); deliver(shared)
    expect(receiver.isAnyNoteOn()).toBe(true)
    expect(receiver.isNoteOn(note)).toBe(true)
    sender.noteOff(note); deliver(shared)
    expect(receiver.isAnyNoteOn()).toBe(true)
    sender.noteOff(note); deliver(shared)
    expect(receiver.isAnyNoteOn()).toBe(false)
    sender.terminate(); receiver.terminate()
})
