import {AudioBuffer} from "@opendaw/lib-dsp"
import {WerkstattDeviceBox, WerkstattParameterBox} from "@opendaw/studio-boxes"
import {WerkstattDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {deviceFixture} from "../script-test-fixture"

export async function werkFixture(create: new () => object, register = true) {
    Object.assign(globalThis, {sampleRate: 48000})
    const {WerkstattDeviceProcessor} = await import("./WerkstattDeviceProcessor")
    const f = deviceFixture(), uuid = UUID.generate(), key = UUID.toString(uuid)
    const registry: Record<string, {update: number, create: new () => object}> = {}
    if (register) registry[key] = {update: 1, create}
    Object.assign(globalThis, {openDAW: {werkstattProcessors: registry}})
    const box = f.edit(() => WerkstattDeviceBox.create(f.graph, uuid, b => b.code.setValue("// @werkstatt test 1 1\n// @param Gain\n")))
    const param = f.edit(() => WerkstattParameterBox.create(f.graph, UUID.generate(), b => {
        b.owner.refer(box.parameters); b.label.setValue("Gain")
    }))
    const adapter = f.adapters.adapterFor(box, WerkstattDeviceBoxAdapter)
    const processor = new WerkstattDeviceProcessor(f.context, adapter)
    const source = new AudioBuffer()
    source.channels().forEach(ch => ch.fill(0.25))
    processor.setAudioSource(source)
    const compile = (create: new () => object, update = 2) => {
        registry[key] = {create, update}
        f.edit(() => box.code.setValue(`// @werkstatt test 1 ${update}\n// @param Gain\n`))
    }
    return {...f, box, param, adapter, processor, source, registry, key, compile}
}
