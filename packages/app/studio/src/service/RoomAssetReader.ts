import {OpfsProtocol} from "@opendaw/lib-fusion"
import {BoxGraph} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioFileBox, SoundfontFileBox} from "@opendaw/studio-boxes"
import {SampleStorage, SoundfontStorage, Workers} from "@opendaw/studio-core"
import type {AssetReader} from "@opendaw/studio-p2p"

// Room peers may fetch only assets the shared project references, never the rest of local storage.
export const createRoomAssetReader = (boxGraph: BoxGraph): AssetReader => {
    const isSample = (uuid: UUID.Bytes) => boxGraph.findBox(uuid).unwrapOrNull() instanceof AudioFileBox
    const isSoundfont = (uuid: UUID.Bytes) => boxGraph.findBox(uuid).unwrapOrNull() instanceof SoundfontFileBox
    const refuse = (): never => {throw new Error("Asset is not shared in this room")}
    return {
        hasSample: async uuid => isSample(uuid) && SampleStorage.get().exists(uuid),
        hasSoundfont: async uuid => isSoundfont(uuid)
            && Workers.Opfs.exists(`${SoundfontStorage.Folder}/${UUID.toString(uuid)}`),
        readSample: async uuid => {
            if (!isSample(uuid)) {return refuse()}
            const path = `${SampleStorage.Folder}/${UUID.toString(uuid)}`
            const [wavBytes, metaBytes] = await Promise.all([
                Workers.Opfs.read(`${path}/audio.wav`, OpfsProtocol.ReadLimits.Media),
                Workers.Opfs.read(`${path}/meta.json`, OpfsProtocol.ReadLimits.Metadata)
            ])
            return [wavBytes.buffer as ArrayBuffer, JSON.parse(new TextDecoder().decode(metaBytes))]
        },
        readSoundfont: async uuid => isSoundfont(uuid) ? SoundfontStorage.get().load(uuid) : refuse()
    }
}
