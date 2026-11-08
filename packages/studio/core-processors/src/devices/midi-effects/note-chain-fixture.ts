import {BoxGraph} from "@opendaw/lib-box"
import {Terminable, UUID} from "@opendaw/lib-std"
import {ArpeggioDeviceBox, GrooveShuffleBox, ZeitgeistDeviceBox} from "@opendaw/studio-boxes"
import {ArpeggioDeviceBoxAdapter, BoxAdapters, BoxAdaptersContext, ParameterFieldAdapters, ZeitgeistDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {ArpeggioDeviceProcessor} from "./ArpeggioDeviceProcessor"
import {ZeitgeistDeviceProcessor} from "./ZeitgeistDeviceProcessor"

// Real graph, adapters and processors; only the worklet registration and stream sink are inert.
export function noteChainFixture() {
    const graph = new BoxGraph()
    const adapterContext = {boxGraph: graph, parameterFieldAdapters: new ParameterFieldAdapters(),
        isMainThread: false} as BoxAdaptersContext
    const adapters = new BoxAdapters(adapterContext)
    Object.assign(adapterContext, {boxAdapters: adapters})
    const context = {boxAdapters: adapters, registerProcessor: () => Terminable.Empty,
        broadcaster: {broadcastIntegers: () => Terminable.Empty}} as unknown as EngineContext
    const edit = (action: () => void) => {graph.beginTransaction(); action(); graph.endTransaction()}
    const arpeggio = (configure: (box: ArpeggioDeviceBox) => void = () => {}) => {
        graph.beginTransaction()
        const box = ArpeggioDeviceBox.create(graph, UUID.generate(), configure)
        graph.endTransaction()
        return new ArpeggioDeviceProcessor(context, adapters.adapterFor(box, ArpeggioDeviceBoxAdapter))
    }
    graph.beginTransaction()
    const groove = GrooveShuffleBox.create(graph, UUID.generate(), box => box.amount.setValue(0.8))
    graph.endTransaction()
    const zeitgeist = () => {
        graph.beginTransaction()
        const box = ZeitgeistDeviceBox.create(graph, UUID.generate(), box => box.groove.refer(groove))
        graph.endTransaction()
        return {box, processor: new ZeitgeistDeviceProcessor(context, adapters.adapterFor(box, ZeitgeistDeviceBoxAdapter))}
    }
    return {graph, context, adapters, groove, edit, arpeggio, zeitgeist}
}
