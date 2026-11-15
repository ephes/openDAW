import {SpielwerkDeviceBox, WerkstattParameterBox} from "@opendaw/studio-boxes"
import {SpielwerkDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {SpielwerkDeviceProcessor} from "./SpielwerkDeviceProcessor"
import {deviceFixture, eventSource} from "../script-test-fixture"

export function spielFixture(create: new () => object, register = true) {
    const f = deviceFixture(), uuid = UUID.generate(), key = UUID.toString(uuid)
    const registry: Record<string, {update: number, create: new () => object}> = {}
    if (register) registry[key] = {update: 1, create}
    Object.assign(globalThis, {openDAW: {spielwerkProcessors: registry}})
    const box = f.edit(() => SpielwerkDeviceBox.create(f.graph, uuid, b => b.code.setValue("// @spielwerk test 1 1\n// @param Gain\n")))
    const param = f.edit(() => WerkstattParameterBox.create(f.graph, UUID.generate(), b => {
        b.owner.refer(box.parameters); b.label.setValue("Gain")
    }))
    const adapter = f.adapters.adapterFor(box, SpielwerkDeviceBoxAdapter)
    const processor = new SpielwerkDeviceProcessor(f.context, adapter)
    const sourceLease = processor.setNoteEventSource(eventSource([]))
    const compile = (create: new () => object, update = 2) => {
        registry[key] = {create, update}
        f.edit(() => box.code.setValue(`// @spielwerk test 1 ${update}\n// @param Gain\n`))
    }
    return {...f, box, param, adapter, processor, sourceLease, registry, key, compile}
}
