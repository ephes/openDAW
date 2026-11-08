import {describe, expect, it, vi} from "vitest"
import {SoftwareMIDIInput} from "./SoftwareMIDIInput"

const message = () => new MessageEvent("midimessage", {data: new Uint8Array([0x90, 60, 127])})
const collect = (input: SoftwareMIDIInput): number[][] => {
    const messages: number[][] = []
    input.onmidimessage = event => messages.push(Array.from(event.data!))
    return messages
}

describe("software MIDI note ownership", () => {
    it("ignores unmatched releases without inventing held notes", () => {
        const input = new SoftwareMIDIInput()
        const messages = collect(input)
        input.sendNoteOff(60)
        expect(input.hasActiveNotes()).toBe(false)
        input.releaseAllNotes()
        expect(messages).toEqual([])
    })

    it("releases every press on the old channel, including more than 255 presses", () => {
        const input = new SoftwareMIDIInput()
        const messages = collect(input)
        for (let i = 0; i < 256; i++) {input.sendNoteOn(60)}
        expect(input.hasActiveNote(60)).toBe(true)
        input.sendNoteOff(60)
        input.channel = 3
        expect(messages).toEqual([
            ...Array.from({length: 256}, () => [0x90, 60, 127]),
            ...Array.from({length: 256}, () => [0x80, 60, 0])
        ])
        expect(input.hasActiveNotes()).toBe(false)
        input.sendNoteOn(61)
        input.releaseAllNotes()
        input.releaseAllNotes()
        expect(messages.slice(-2)).toEqual([[0x93, 61, 127], [0x83, 61, 0]])
        expect(input.hasActiveNotes()).toBe(false)
    })

    it("rejects invalid note/channel domains before releasing or changing state", () => {
        const input = new SoftwareMIDIInput()
        const messages = collect(input)
        input.sendNoteOn(60)
        for (const value of [NaN, Infinity, -1, 0.5, 128]) {
            expect(() => input.sendNoteOn(value)).toThrow()
            expect(() => input.sendNoteOff(value)).toThrow()
        }
        for (const value of [NaN, Infinity, -1, 0.5, 16]) {
            expect(() => {input.channel = value}).toThrow()
            expect(input.channel).toBe(0)
            expect(input.hasActiveNote(60)).toBe(true)
        }
        expect(messages).toEqual([[0x90, 60, 127]])
    })
})

describe("software MIDI listener accounting", () => {
    it("counts property replacement as one slot and repeated null as none", () => {
        const input = new SoftwareMIDIInput()
        const first = vi.fn(), second = vi.fn()
        input.onmidimessage = null
        expect(input.countListeners.getValue()).toBe(0)
        input.onmidimessage = first
        input.onmidimessage = first
        input.onmidimessage = second
        expect(input.countListeners.getValue()).toBe(1)
        input.dispatchEvent(message())
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
        input.onmidimessage = null
        input.onmidimessage = null
        expect(input.countListeners.getValue()).toBe(0)
    })

    it("uses callback identity, event type and capture for registration/removal", () => {
        const input = new SoftwareMIDIInput()
        const listener = vi.fn(), absent = vi.fn()
        input.removeEventListener("midimessage", absent)
        expect(input.countListeners.getValue()).toBe(0)
        input.addEventListener("midimessage", listener)
        input.addEventListener("midimessage", listener, {once: true})
        expect(input.countListeners.getValue()).toBe(1)
        input.dispatchEvent(message())
        input.dispatchEvent(message())
        expect(listener).toHaveBeenCalledTimes(2)
        input.addEventListener("midimessage", listener, true)
        input.addEventListener("statechange", listener)
        expect(input.countListeners.getValue()).toBe(3)
        input.removeEventListener("midimessage", listener, true)
        input.removeEventListener("midimessage", listener, true)
        expect(input.countListeners.getValue()).toBe(2)
        input.removeEventListener("midimessage", listener)
        input.removeEventListener("statechange", listener)
        expect(input.countListeners.getValue()).toBe(0)
    })

    it("retires once before reentrant dispatch and accounts for abort lifetimes", () => {
        const input = new SoftwareMIDIInput()
        const once = vi.fn(() => {
            expect(input.countListeners.getValue()).toBe(0)
            input.dispatchEvent(message())
        })
        input.addEventListener("midimessage", once, {once: true})
        input.dispatchEvent(message())
        expect(once).toHaveBeenCalledTimes(1)
        const controller = new AbortController()
        const listener = vi.fn()
        input.addEventListener("midimessage", listener, {signal: controller.signal})
        expect(input.countListeners.getValue()).toBe(1)
        controller.abort()
        expect(input.countListeners.getValue()).toBe(0)
        input.addEventListener("midimessage", listener, {signal: controller.signal})
        input.dispatchEvent(message())
        expect(listener).not.toHaveBeenCalled()
        expect(input.countListeners.getValue()).toBe(0)
    })

    it("supports object listeners and releases abort hooks after manual/once removal", () => {
        const input = new SoftwareMIDIInput()
        const controller = new AbortController()
        const listener = {handleEvent: vi.fn()}
        input.addEventListener("midimessage", listener, {signal: controller.signal, once: true})
        input.dispatchEvent(message())
        expect(listener.handleEvent).toHaveBeenCalledTimes(1)
        expect(input.countListeners.getValue()).toBe(0)
        input.addEventListener("midimessage", listener, {signal: controller.signal})
        input.removeEventListener("midimessage", listener)
        controller.abort()
        expect(input.countListeners.getValue()).toBe(0)
    })
})
