import {Lazy, UUID} from "@opendaw/lib-std"
import {Soundfont, SoundfontMetaData} from "@opendaw/studio-adapters"
import {Workers} from "../Workers"
import {Storage} from "../Storage"
import {ExternalLib} from "../ExternalLib"

export namespace SoundfontStorage {
    export type NewSoundfont = {
        uuid: UUID.Bytes,
        file: ArrayBuffer,
        meta: SoundfontMetaData
    }
}

export class SoundfontStorage extends Storage<Soundfont, SoundfontMetaData, SoundfontStorage.NewSoundfont,
    [ArrayBuffer, SoundfontMetaData]> {
    static readonly Folder = "soundfont"

    @Lazy
    static get(): SoundfontStorage {return new SoundfontStorage()}

    private constructor() {super(SoundfontStorage.Folder)}

    async save({uuid, file, meta}: SoundfontStorage.NewSoundfont): Promise<void> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        console.debug(`save soundfont '${path}'`)
        return navigator.locks.request(`opendaw:storage:${this.folder}`, async () => {
            const existing = (await Workers.Opfs.list(this.folder)).some(entry => entry.name === UUID.toString(uuid))
            const library = await ExternalLib.SoundFont2()
            if (library.status === "rejected") {throw library.error}
            const validate = (file: ArrayBuffer, meta: SoundfontMetaData) => {
                SoundfontMetaData.parse(meta)
                new library.value(new Uint8Array(file))
            }
            if (existing) {
                const parts = await Promise.allSettled([
                    Workers.Opfs.read(`${path}/soundfont.sf2`), Workers.Opfs.read(`${path}/meta.json`)
                ])
                for (const part of parts) {
                    if (part.status === "rejected" && (!(part.reason instanceof DOMException) || part.reason.name !== "NotFoundError")) {throw part.reason}
                }
                const [media, metadata] = parts
                if (media.status === "fulfilled" && metadata.status === "fulfilled") {
                    try {
                        const bytes = media.value
                        validate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
                            JSON.parse(new TextDecoder().decode(metadata.value)))
                        return // Complete UUIDs are immutable, including their local metadata.
                    } catch { /* Invalid existing bytes/metadata can be repaired from fresh validated input. */ }
                }
            }
            validate(file, meta)
            if (existing) {
                // Retire the invalid commit marker only after fresh bytes validate.
                await Workers.Opfs.delete(`${path}/meta.json`)
            }
            try {
                await Workers.Opfs.write(`${path}/soundfont.sf2`, new Uint8Array(file))
                await Workers.Opfs.write(`${path}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)))
            } catch (error) {
                try {
                    // Existing directories belong to recovery, never to this cleanup.
                    await Workers.Opfs.delete(existing ? `${path}/meta.json` : path)
                } catch {
                    console.warn("Soundfont cleanup failed; incomplete output retained for repair.")
                }
                throw error
            }
        })
    }

    async load(uuid: UUID.Bytes): Promise<[ArrayBuffer, SoundfontMetaData]> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        return Promise.all([
            Workers.Opfs.read(`${path}/soundfont.sf2`)
                .then(bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
            Workers.Opfs.read(`${path}/meta.json`)
                .then(bytes => JSON.parse(new TextDecoder().decode(bytes)))
        ])
    }
}
