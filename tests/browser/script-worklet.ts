/* eslint-disable no-restricted-imports -- Integration-only access to private processors with no public runtime exports. */
import {AudioBuffer} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {MIDIOutputDeviceBoxAdapter, SpielwerkDeviceBoxAdapter, WerkstattDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {MIDIOutputBox, MIDIOutputDeviceBox, SpielwerkDeviceBox, WerkstattDeviceBox} from "@opendaw/studio-boxes"
import {block, deviceFixture, eventSource, outputNote, ScriptBlock} from "../../packages/studio/core-processors/src/devices/script-test-fixture"
import {SpielwerkDeviceProcessor} from "../../packages/studio/core-processors/src/devices/midi-effects/SpielwerkDeviceProcessor"
import {MIDIOutputDeviceProcessor} from "../../packages/studio/core-processors/src/devices/instruments/MIDIOutputDeviceProcessor"
import {WerkstattDeviceProcessor} from "../../packages/studio/core-processors/src/devices/audio-effects/WerkstattDeviceProcessor"

const check = (value: boolean, message: string) => {if (!value) throw new Error(message)}
class ScriptContractWorklet extends AudioWorkletProcessor {
    process(): boolean {
        try {
            const seen: ScriptBlock[] = []
            const f = deviceFixture()
            let serial = 0
            const nextUuid = () => UUID.parse(`00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`)
            const scriptUuid = nextUuid()
            Object.assign(globalThis, {openDAW: {spielwerkProcessors: {[UUID.toString(scriptUuid)]: {update: 1, create: class {
                *process(b: ScriptBlock) {
                    seen.push({...b})
                    yield outputNote(b.from, 1000)
                    throw new Error("synthetic generator fault")
                }
            }}}}})
            const scriptBox = f.edit(() => SpielwerkDeviceBox.create(f.graph, scriptUuid, b => b.code.setValue("// @spielwerk test 1 1\n")))
            const script = new SpielwerkDeviceProcessor(f.context, f.adapters.adapterFor(scriptBox, SpielwerkDeviceBoxAdapter))
            script.setNoteEventSource(eventSource([]))
            const endpoint = f.edit(() => MIDIOutputBox.create(f.graph, nextUuid(), b => b.id.setValue("fake-midi")))
            const midiBox = f.edit(() => MIDIOutputDeviceBox.create(f.graph, nextUuid(), b => b.device.refer(endpoint.device)))
            const midi = new MIDIOutputDeviceProcessor(f.context, f.adapters.adapterFor(midiBox, MIDIOutputDeviceBoxAdapter))
            midi.setNoteEventSource(script)
            const b = {...block(), s0: 7, s1: 109, bpm: 137}
            script.process({blocks: [b]})
            midi.process({blocks: [b]})
            check(seen[0].bpm === 137 && seen[0].s0 === 7 && seen[0].s1 === 109, "actual worklet block context")
            check(f.midi.length === 2 && f.midi[0].data[0] === 0x90 && f.midi[1].data[0] === 0x80, "balanced hardware output on fault")
            midi.reset()
            check(f.midi.length === 2, "idempotent hardware retirement")

            const uuid = nextUuid(), key = UUID.toString(uuid)
            let pass = 0
            Object.assign(globalThis, {openDAW: {werkstattProcessors: {[key]: {update: 1, create: class {
                process(io: {out: Float32Array[]}) {
                    if (++pass === 1) io.out.forEach(ch => ch.fill(0.25))
                    else io.out[0] = new Float32Array(0)
                }
            }}}}})
            const audioBox = f.edit(() => WerkstattDeviceBox.create(f.graph, uuid, b => b.code.setValue("// @werkstatt test 1 1\n")))
            const audio = new WerkstattDeviceProcessor(f.context, f.adapters.adapterFor(audioBox, WerkstattDeviceBoxAdapter))
            audio.setAudioSource(new AudioBuffer())
            audio.process({blocks: [b]})
            check(audio.audioOutput.getChannel(0)[7] === 0.25, "normal script audio")
            audio.process({blocks: [b]})
            check(audio.audioOutput.getChannel(0).every(v => v === 0), "silence after output substitution")
            check(f.messages.length === 2, "one report per failed generation")
            audio.terminate(); midi.terminate(); script.terminate()
            this.port.postMessage({ok: true})
        } catch (error) {
            this.port.postMessage({ok: false, error: String(error)})
        }
        return false
    }
}
registerProcessor("script-contracts", ScriptContractWorklet)
