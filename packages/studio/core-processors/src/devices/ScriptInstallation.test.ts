import {expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {ScriptCompiler, SpielwerkDeviceBoxAdapter, WerkstattDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {SpielwerkDeviceBox, WerkstattDeviceBox} from "@opendaw/studio-boxes"
import {block, deviceFixture, eventSource} from "./script-test-fixture"

it.each(["werkstatt", "spielwerk"])("%s activates exact compiled updates after reverse completion and undo", async kind => {
    Object.assign(globalThis, {sampleRate: 48000})
    const {WerkstattDeviceProcessor} = await import("./audio-effects/WerkstattDeviceProcessor")
    const {SpielwerkDeviceProcessor} = await import("./midi-effects/SpielwerkDeviceProcessor")
    const f = deviceFixture(), editing = new BoxEditing(f.graph)
    const box = f.edit(() => kind === "werkstatt" ? WerkstattDeviceBox.create(f.graph, UUID.generate())
        : SpielwerkDeviceBox.create(f.graph, UUID.generate()))
    const compiler = ScriptCompiler.create({headerTag: kind, registryName: kind + "Processors", functionName: kind})
    const evaluate = async (url: string) => {new Function(await (await fetch(url)).text())()}
    const addModule = vi.fn(evaluate), context = {audioWorklet: {addModule}} as unknown as Parameters<typeof compiler.compile>[0]
    const source = (value: number) => kind === "werkstatt"
        ? `class Processor {process(io) {io.out.forEach(ch => ch.fill(${value}))}}`
        : `class Processor {*process(b) {yield {position: b.from, duration: 1, pitch: ${value}, velocity: 1, cent: 0}}}`
    const firstValue = kind === "werkstatt" ? 0.25 : 60, lastValue = kind === "werkstatt" ? 0.75 : 72
    await compiler.compile(context, editing, box, source(firstValue))
    const saved = box.code.getValue()
    let finish!: () => Promise<void>
    addModule.mockImplementationOnce(url => new Promise<void>((resolve, reject) => {
        finish = async () => {try {await evaluate(url); resolve()} catch (error) {reject(error)}}
    }))
    const old = compiler.compile(context, editing, box, source(firstValue))
    await compiler.compile(context, editing, box, source(lastValue))
    await finish(); await old
    const read = () => {
        if (box instanceof WerkstattDeviceBox) {
            const processor = new WerkstattDeviceProcessor(f.context, f.adapters.adapterFor(box, WerkstattDeviceBoxAdapter))
            processor.setAudioSource(new AudioBuffer())
            processor.process({blocks: [block()]})
            const value = processor.audioOutput.getChannel(0)[0]
            processor.terminate()
            return value
        }
        const processor = new SpielwerkDeviceProcessor(f.context, f.adapters.adapterFor(box, SpielwerkDeviceBoxAdapter))
        processor.setNoteEventSource(eventSource([]))
        processor.process({blocks: [block()]})
        const events = [...processor.processNotes(0, 10, 0)]
        processor.terminate()
        return events.find(event => event.type === "note-event")?.pitch
    }
    expect(read()).toBe(lastValue)
    editing.modify(() => box.code.setValue(saved))
    await compiler.load(context, box)
    expect(read()).toBe(firstValue)
    expect(f.messages).toEqual([])
})
