import {expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {StringMapping, UUID, ValueMapping} from "@opendaw/lib-std"
import {WerkstattParameterBox} from "@opendaw/studio-boxes"
import {ParameterAdapterSet} from "./ParameterAdapterSet"
import {ParameterFieldAdapters} from "./ParameterFieldAdapters"
import {BoxAdaptersContext} from "./BoxAdaptersContext"

it("retires removed parameter subscriptions and permits readding the same field", () => {
    const graph = new BoxGraph()
    graph.beginTransaction()
    const box = WerkstattParameterBox.create(graph, UUID.generate())
    graph.endTransaction()
    const registry = new ParameterFieldAdapters()
    const set = new ParameterAdapterSet({parameterFieldAdapters: registry} as BoxAdaptersContext)
    const add = () => set.createParameter(box.value, ValueMapping.unipolar(), StringMapping.percent(), "gain")
    const old = add(), notify = vi.fn(), terminate = vi.spyOn(old, "terminate")
    old.subscribe(notify)
    set.removeParameter(box.value.address)
    expect(registry.opt(box.value.address).isEmpty()).toBe(true)
    const current = add()
    graph.beginTransaction(); box.value.setValue(0.75); graph.endTransaction()
    expect(notify).not.toHaveBeenCalled()
    expect(current.getValue()).toBe(0.75)
    set.terminate()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(registry.opt(box.value.address).isEmpty()).toBe(true)
})
