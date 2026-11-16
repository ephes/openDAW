import {UUID} from "@opendaw/lib-std"
import {PresetStorage, Workers} from "@opendaw/studio-core"

const check = (condition: boolean, message: string) => {if (!condition) {throw new Error(message)}}
export const cloudPresetGenerations = async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Workers, "Opfs")!
    const id = "00000000-0000-4000-8000-000000000116" as UUID.String
    const root = "presets/user", index = `${root}/index.json`, file = `${root}/${id}.odp`
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const remote = {uuid: id, name: "Remote", created: 0, modified: 1, description: "", category: "audio-effect-chain" as const}
    const files = new Map([[index, json([])]])
    Object.defineProperty(Workers, "Opfs", {configurable: true, value: {
        read: async (path: string) => {
            if (!files.has(path)) {throw new DOMException("Synthetic missing", "NotFoundError")}
            return files.get(path)!.slice()
        },
        write: async (path: string, bytes: Uint8Array) => {files.set(path, bytes.slice())},
        exists: async (path: string) => files.has(path), list: async () => []
    }})
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    try {
        const backup = (async () => {
            entered.resolve(); await release.promise
            return PresetStorage.restoreIfAbsent(remote, new Uint8Array([1]).buffer)
        })()
        await entered.promise
        // Real browser Web Locks serialize this save with restore's admission.
        await PresetStorage.save({...remote, name: "Local"}, new Uint8Array([2]).buffer)
        release.resolve(); await backup
        check(files.get(file)?.[0] === 2, "restore replaced newer local bytes")
        const snapshot = await PresetStorage.readSnapshot(UUID.parse(id))
        check(snapshot?.meta.name === "Local" && new Uint8Array(snapshot.data)[0] === 2, "mixed local snapshot")
        // A snapshot queued behind a browser lock must see the complete next generation.
        const locked = Promise.withResolvers<void>(), unlock = Promise.withResolvers<void>()
        const held = navigator.locks.request(`opendaw:storage:${root}`, async () => {locked.resolve(); await unlock.promise})
        await locked.promise
        const save = PresetStorage.save({...remote, name: "Next"}, new Uint8Array([3]).buffer)
        const captured = PresetStorage.readSnapshot(UUID.parse(id))
        unlock.resolve(); await held; await save
        const next = await captured
        check(next?.meta.name === "Next" && new Uint8Array(next.data)[0] === 3, "snapshot bypassed queued save")
    } finally {
        release.resolve()
        Object.defineProperty(Workers, "Opfs", descriptor)
    }
}
