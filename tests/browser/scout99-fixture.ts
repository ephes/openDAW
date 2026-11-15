import {BoxEditing, Vertex} from "@opendaw/lib-box"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {ProjectSkeleton, VertexSelection} from "@opendaw/studio-adapters"
import {DawProjectService, SampleService} from "@opendaw/studio-core"
import {isDefined, UUID} from "@opendaw/lib-std"
import JSZip from "jszip"

const check = (value: boolean, message: string): void => {if (!value) {throw new Error(message)}}

export const selection = (): void => {
    const {boxGraph, mandatoryBoxes: {userInterfaceBoxes, primaryAudioBusBox, primaryAudioUnitBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const selected = new VertexSelection(new BoxEditing(boxGraph), boxGraph).switch(userInterfaceBoxes[0].selection)
    const filtered = selected.createFilteredSelection<Vertex>(() => true, {fx: value => value, fy: value => value})
    selected.select(primaryAudioBusBox)
    const projection: string[] = []
    const subscription = filtered.catchupAndSubscribe({onSelected: vertex => {
        check(selected.isSelected(vertex), "selection notification preceded state")
        projection.push(vertex.address.toString())
        if (vertex === primaryAudioBusBox) {selected.select(primaryAudioUnitBox)}
    }, onDeselected: () => {}})
    check(projection.length === 2 && selected.count() === 2 && filtered.count() === 2, "reentrant catchup lost an event")
    subscription.terminate()
    selected.release()
    check(selected.count() === 0 && filtered.count() === 0, "release retained selection")
    boxGraph.verifyPointers()
}

export const portableImport = async (): Promise<void> => {
    const original = Object.getOwnPropertyDescriptor(window, "showOpenFilePicker")
    const choose = (file: File): void => {
        Object.defineProperty(window, "showOpenFilePicker", {configurable: true, value: async () => [{getFile: async () => file}]})
    }
    let read = false
    const oversized = new File([], "synthetic.dawproject")
    Object.defineProperty(oversized, "size", {value: DawProjectService.MaxCompressedBytes + 1})
    oversized.arrayBuffer = async () => {read = true; return new ArrayBuffer(0)}
    choose(oversized)
    const assets = new Set<string>()
    let active = 0, maximum = 0, fail = false, calls = 0
    const samples = {importOwnedFile: async (args: {uuid: UUID.Bytes}) => {
        maximum = Math.max(maximum, ++active)
        const call = ++calls
        await new Promise(resolve => setTimeout(resolve, call === 1 ? 10 : 1))
        active--
        if (fail && call === 2) {throw new Error("synthetic decoder failure")}
        const id = UUID.toString(args.uuid)
        assets.add(id)
        return {publish: () => {}, rollback: async () => {assets.delete(id)}}
    }} as unknown as SampleService
    try {
        let refused = false
        try {await DawProjectService.importDawproject(samples)} catch {refused = true}
        check(refused && !read, "oversized picker input was read")
        const zip = new JSZip()
        const clips: string[] = []
        for (let index = 0; index < 5; index++) {
            const audio = AudioData.create(4, 16, 1)
            audio.frames[0].fill(index / 8)
            zip.file(`${index}.wav`, WavFile.encodeFloats(audio))
            clips.push(`<Clip time="${index * 8}" duration="8"><Warps contentTimeUnit="seconds"><Warp time="0" contentTime="0"/>
                <Warp time="8" contentTime="4"/><Audio duration="4" channels="1" sampleRate="4"><File path="${index}.wav"/></Audio></Warps></Clip>`)
        }
        zip.file("project.xml", `<Project version="1.0"><Structure>
            <Track id="audio" contentType="audio"><Channel id="channel" role="regular" destination="master"/></Track>
            <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
            </Structure><Arrangement><Lanes><Lanes track="audio"><Clips>${clips.join("")}</Clips></Lanes></Lanes></Arrangement></Project>`)
        const file = new File([await zip.generateAsync({type: "arraybuffer"})], "synthetic.dawproject")
        choose(file)
        fail = true
        let rejected = false
        try {await DawProjectService.importDawproject(samples)} catch {rejected = true}
        check(rejected && active === 0 && assets.size === 0, "failed import retained an owned sample")
        fail = false
        calls = 0
        const result = await DawProjectService.importDawproject(samples)
        check(result.nonEmpty() && assets.size === 5 && maximum <= 2, "bounded import/retry failed")
    } finally {
        if (isDefined(original)) {Object.defineProperty(window, "showOpenFilePicker", original)}
        else {Reflect.deleteProperty(window, "showOpenFilePicker")}
    }
}
