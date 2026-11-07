import {UUID} from "@opendaw/lib-std"
import {Workers} from "./Workers"
import {Promises} from "@opendaw/lib-runtime"
import {deleteWithJournal} from "./deletionJournal"

export abstract class Storage<ITEM extends { uuid: UUID.String } & META, META, NEW, PARTS> {
    protected constructor(readonly folder: string) {}

    abstract save(item: NEW): Promise<void>
    abstract load(uuid: UUID.Bytes): Promise<PARTS>

    async deleteItem(uuid: UUID.Bytes): Promise<void> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        console.debug(`deleteItem '${path}'`)
        await deleteWithJournal(this.folder, uuid, path)
    }

    async loadTrashedIds(): Promise<Array<UUID.String>> {
        const {status, value} = await Promises.tryCatch(Workers.Opfs.read(`${this.folder}/trash.json`))
        return status === "rejected" ? [] : JSON.parse(new TextDecoder().decode(value))
    }

    async saveTrashedIds(ids: ReadonlyArray<UUID.String>): Promise<void> {
        const trash = new TextEncoder().encode(JSON.stringify(ids))
        await Workers.Opfs.write(`${this.folder}/trash.json`, trash)
    }

    async list({strict = false}: {strict?: boolean} = {}): Promise<ReadonlyArray<ITEM>> {
        return strict
            ? navigator.locks.request(`opendaw:storage:${this.folder}`, () => this.#list(true))
            : this.#list(false)
    }

    async #list(strict: boolean): Promise<ReadonlyArray<ITEM>> {
        let files: Awaited<ReturnType<typeof Workers.Opfs.list>>
        try {
            files = await Workers.Opfs.list(this.folder)
        } catch (error) {
            if (!strict || (error instanceof DOMException && error.name === "NotFoundError")) {return []}
            throw error
        }
        const results = await Promise.all(files.filter(file => file.kind === "directory")
            .map(async ({name}) => {
                try {
                    if (!UUID.validateString(name)) {throw new Error("Invalid storage directory UUID")}
                    const array = await Workers.Opfs.read(`${this.folder}/${name}/meta.json`)
                    const meta = JSON.parse(new TextDecoder().decode(array))
                    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
                        throw new Error("Invalid storage metadata object")
                    }
                    if (Object.hasOwn(meta, "uuid") && (typeof meta.uuid !== "string"
                        || !UUID.validateString(meta.uuid) || meta.uuid.toLowerCase() !== name.toLowerCase())) {
                        throw new Error("Metadata UUID does not match its directory")
                    }
                    return {...meta, uuid: name} as ITEM
                } catch (cause) {
                    if (strict) {throw new Error(`Cannot scan local asset '${this.folder}/${name.slice(0, 80)}'; repair its directory/metadata before backup.`, {cause})}
                    console.warn(`Skipping unreadable local asset '${this.folder}/${name.slice(0, 80)}'; retained for recovery.`, cause)
                    return null
                }
            }))
        return results.filter(item => item !== null) as ReadonlyArray<ITEM>
    }
}
