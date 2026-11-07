import {UUID} from "@opendaw/lib-std"
import {Workers} from "./Workers"

// Web Locks coordinate every tab of this origin, unlike a worker-local mutex.
export const deleteWithJournal = async (folder: string, uuid: UUID.Bytes, path: string): Promise<void> =>
    navigator.locks.request(`opendaw:storage:${folder}`, async () => {
        const journal = `${folder}/trash.json`
        const ids = await readTrashedIds(folder)
        const next = [...new Set([...ids, UUID.toString(uuid)])]
        await Workers.Opfs.write(journal, new TextEncoder().encode(JSON.stringify(next)))
        await Workers.Opfs.delete(path)
    })

// An unreadable journal is unknown deletion intent, never an empty library.
export const readTrashedIds = async (folder: string): Promise<Array<UUID.String>> => {
    let bytes: Uint8Array
    try {
        bytes = await Workers.Opfs.read(`${folder}/trash.json`)
    } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {return []}
        throw error
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(value) || !value.every(id => typeof id === "string" && UUID.validateString(id))) {
        throw new Error(`Invalid deletion journal (${folder}/trash.json); repair it before continuing.`)
    }
    return value
}
