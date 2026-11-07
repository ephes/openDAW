import {Notifier, Observer, Option, Subscription, UUID} from "@opendaw/lib-std"
import {ProjectMeta} from "./ProjectMeta"
import {Project} from "./Project"
import {Workers} from "../Workers"
import {ProjectPaths} from "./ProjectPaths"

export class ProjectProfile {
    readonly #uuid: UUID.Bytes
    readonly #project: Project
    readonly #meta: ProjectMeta

    #cover: Option<ArrayBuffer>

    readonly #metaUpdated: Notifier<ProjectMeta>

    #saved: boolean
    #hasChanges: boolean = false
    #metaGeneration: number = 0

    constructor(uuid: UUID.Bytes,
                project: Project,
                meta: ProjectMeta,
                cover: Option<ArrayBuffer>,
                hasBeenSaved: boolean = false) {
        this.#uuid = uuid
        this.#project = project
        this.#meta = meta
        this.#cover = cover

        this.#saved = hasBeenSaved
        this.#metaUpdated = new Notifier<ProjectMeta>()
    }

    get uuid(): UUID.Bytes {return this.#uuid}
    get project(): Project {return this.#project}
    get meta(): ProjectMeta {return this.#meta}
    get cover(): Option<ArrayBuffer> {return this.#cover}

    async save(): Promise<void> {
        if (!this.#saved) {throw new Error("Project has not been saved")}
        this.updateModifyDate()
        this.#project.editing.mark()
        this.#hasChanges = true
        const generation = this.#metaGeneration
        const bytes = await ProjectProfile.#writeFiles(this)
        this.#finishSave(bytes, generation)
    }

    async saveAs(meta: ProjectMeta): Promise<Option<ProjectProfile>> {
        const nextMeta = structuredClone(Object.assign({}, this.meta, meta, {modified: new Date().toISOString()}))
        if (this.#saved) {
            const profile = new ProjectProfile(UUID.generate(), this.project.copy(), nextMeta,
                this.cover.map(bytes => bytes.slice(0)), true)
            await profile.save()
            return Option.wrap(profile)
        }
        this.#project.editing.mark()
        this.#hasChanges = true
        const generation = this.#metaGeneration
        const priorMeta = structuredClone(this.meta)
        const bytes = await ProjectProfile.#writeFiles(this, nextMeta)
        this.#saved = true
        for (const [key, value] of Object.entries(nextMeta)) {
            // Publish requested fields without overwriting edits made during I/O.
            if (JSON.stringify(Reflect.get(this.meta, key)) === JSON.stringify(Reflect.get(priorMeta, key))) {
                Object.assign(this.meta, {[key]: value})
            }
        }
        this.#finishSave(bytes, generation)
        this.#metaUpdated.notify(this.meta)
        return Option.None
    }

    #finishSave(bytes: Uint8Array, generation: number): void {
        // Only mark the live graph saved if it still equals the persisted revision.
        const current = new Uint8Array(this.project.toArrayBuffer())
        const sameGraph = current.length === bytes.length && current.every((value, index) => value === bytes[index])
        this.#hasChanges = !sameGraph || this.#metaGeneration !== generation
        if (sameGraph) {this.#project.editing.markSaved()}
    }

    saved(): boolean {return this.#saved}
    hasUnsavedChanges(): boolean {return this.#project.editing.hasUnsavedChanges() || this.#hasChanges}

    subscribeMetaData(observer: Observer<ProjectMeta>): Subscription {
        return this.#metaUpdated.subscribe(observer)
    }

    updateCover(cover: Option<ArrayBuffer>): void {
        this.#cover = cover
        this.#metaGeneration++
        this.#hasChanges = true
    }

    updateMetaData<KEY extends keyof ProjectMeta>(key: KEY, value: ProjectMeta[KEY]): void {
        if (this.meta[key] === value) {return}
        this.meta[key] = value
        this.#metaGeneration++
        this.#hasChanges = true
        this.#metaUpdated.notify(this.meta)
    }

    updateModifyDate(): void {this.meta.modified = new Date().toISOString()}

    copyForUpload(): ProjectProfile {
        const meta = ProjectMeta.copy(this.meta)
        delete meta.radioToken // we do not expose this
        return new ProjectProfile(this.uuid, this.project, meta, this.cover)
    }

    toString(): string {
        return `{uuid: ${UUID.toString(this.uuid)}, meta: ${JSON.stringify(this.meta)}}`
    }

    static async #writeFiles({uuid, project, meta, cover}: ProjectProfile, snapshotMeta: ProjectMeta = meta): Promise<Uint8Array> {
        // Encode one revision before waiting for another storage owner.
        const projectBytes = new Uint8Array(project.toArrayBuffer())
        const metaBytes = new TextEncoder().encode(JSON.stringify(snapshotMeta))
        const coverBytes = cover.map(bytes => new Uint8Array(bytes.slice(0)))
        return navigator.locks.request(`opendaw:storage:${ProjectPaths.Folder}`, async () => {
            const results = await Promise.allSettled([
                Workers.Opfs.write(ProjectPaths.projectFile(uuid), projectBytes),
                Workers.Opfs.write(ProjectPaths.projectMeta(uuid), metaBytes),
                coverBytes.match({
                    none: () => Workers.Opfs.delete(ProjectPaths.projectCover(uuid)),
                    some: bytes => Workers.Opfs.write(ProjectPaths.projectCover(uuid), bytes)
                })
            ])
            const failed = results.find(result => result.status === "rejected")
            if (failed?.status === "rejected") {throw failed.reason}
            return projectBytes
        })
    }
}
