import {describe, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {StringMapping, UUID, ValueMapping} from "@opendaw/lib-std"
import {WerkstattParameterBox} from "@opendaw/studio-boxes"
import {AutomatableParameterFieldAdapter} from "./AutomatableParameterFieldAdapter"
import {ParameterFieldAdapters} from "./ParameterFieldAdapters"
import {BoxAdaptersContext} from "./BoxAdaptersContext"

const fixture = () => {
    const graph = new BoxGraph()
    graph.beginTransaction()
    const box = WerkstattParameterBox.create(graph, UUID.generate())
    graph.endTransaction()
    return new AutomatableParameterFieldAdapter({parameterFieldAdapters: new ParameterFieldAdapters()} as BoxAdaptersContext,
        box.value, ValueMapping.unipolar(), StringMapping.percent(), "gain")
}
const listener = () => ({onControlSourceAdd: vi.fn(), onControlSourceRemove: vi.fn()})

describe("MIDI control registration ownership", () => {
    it.each([false, true])("retains aggregate presence until both owners retire (reverse=%s)", reverse => {
        const parameter = fixture(), live = listener()
        parameter.catchupAndSubscribeControlSources(live)
        const first = parameter.registerMidiControl(), second = parameter.registerMidiControl()
        const handles = reverse ? [second, first] : [first, second]
        expect(live.onControlSourceAdd.mock.calls).toEqual([["midi"]])
        handles[0].terminate(); handles[0].terminate()
        expect(live.onControlSourceRemove).not.toHaveBeenCalled()
        const late = listener()
        parameter.catchupAndSubscribeControlSources(late)
        expect(late.onControlSourceAdd.mock.calls).toEqual([["midi"]])
        handles[1].terminate(); handles[1].terminate()
        expect(live.onControlSourceRemove.mock.calls).toEqual([["midi"]])
        expect(late.onControlSourceRemove.mock.calls).toEqual([["midi"]])
        const final = listener()
        parameter.catchupAndSubscribeControlSources(final)
        expect(final.onControlSourceAdd).not.toHaveBeenCalled()
        parameter.terminate()
    })
    it("publishes aggregate state before notifying a reentrant catchup listener", () => {
        const parameter = fixture(), late = listener()
        parameter.catchupAndSubscribeControlSources({
            onControlSourceAdd: () => {parameter.catchupAndSubscribeControlSources(late).terminate()},
            onControlSourceRemove: () => {}
        })
        const handle = parameter.registerMidiControl()
        expect(late.onControlSourceAdd.mock.calls).toEqual([["midi"]])
        handle.terminate()
        expect(late.onControlSourceRemove).not.toHaveBeenCalled()
        parameter.terminate()
    })
})
