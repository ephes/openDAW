import {UUID} from "@opendaw/lib-std"
import {Workers} from "./Workers"

// Web Locks coordinate every tab of this origin, unlike a worker-local mutex.
export const deleteWithJournal = async (folder: string, uuid: UUID.Bytes, path: string): Promise<void> =>
    navigator.locks.request(`opendaw:storage:${folder}`, async () => {
        const journal = `${folder}/trash.json`
        let ids: Array<UUID.String>
        try {
            ids = JSON.parse(new TextDecoder().decode(await Workers.Opfs.read(journal)))
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error}
            ids = []
        }
        const next = [...new Set([...ids, UUID.toString(uuid)])]
        await Workers.Opfs.write(journal, new TextEncoder().encode(JSON.stringify(next)))
        await Workers.Opfs.delete(path)
    })
