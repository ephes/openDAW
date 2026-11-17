import {Workers} from "@opendaw/studio-core"
import {readModelFromPack, readPackMetaFromId, storePackToOpfs} from "@/ui/devices/audio-effects/NeuralAmp/NamTone3000"

export const opfsProbe = async () => {
    await Workers.install("/r130-opfs-worker.ts")
    const folder = "r130-synthetic-atomic"
    const toneId = 1300001
    try {
        await Workers.Opfs.writeAtomic(`${folder}/manifest`, new Uint8Array([1, 2, 3]))
        await Workers.Opfs.writeAtomic(`${folder}/manifest`, new Uint8Array([4, 5, 6]).subarray(1, 2))
        const replacement = Array.from(await Workers.Opfs.read(`${folder}/manifest`))
        const tone = (revision: string) => ({id: toneId, title: "Synthetic pack", updated_at: revision,
            models: [{id: 1, name: "Synthetic NAM", size: "standard", model_url: `https://example.test/${revision}`} ]})
        await storePackToOpfs(tone("v1"))
        const prior = await readPackMetaFromId(String(toneId))
        let failed = false
        try {await storePackToOpfs(tone("v2"))} catch {failed = true}
        const current = await readPackMetaFromId(String(toneId))
        const model = await readModelFromPack(String(toneId), 1)
        return {replacement, failed, prior, current, model}
    } finally {
        await Workers.Opfs.delete(folder)
        await Workers.Opfs.delete(`tone3000/${toneId}`)
    }
}
