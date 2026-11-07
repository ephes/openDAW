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
        this.updateModifyDate()
        this.#project.editing.mark()
        return this.#saved
            ? ProjectProfile.#writeFiles(this).then(() => {
                this.#hasChanges = false
                this.#project.editing.markSaved()
            })
            : Promise.reject("Project has not been saved")
    }

    async saveAs(meta: ProjectMeta): Promise<Option<ProjectProfile>> {
        Object.assign(this.meta, meta)
        this.updateModifyDate()
        if (this.#saved) {
            // Copy project
            const uuid = UUID.generate()
            const project = this.project.copy()
            const meta = ProjectMeta.copy(this.meta)
            const profile = new ProjectProfile(uuid, project, meta, Option.None, true)
            await ProjectProfile.#writeFiles(profile)
            return Option.wrap(profile)
        } else {
            this.#project.editing.mark()
            return ProjectProfile.#writeFiles(this).then(() => {
                this.#saved = true
                this.#hasChanges = false
                this.#project.editing.markSaved()
                this.#metaUpdated.notify(this.meta)
                return Option.None
            })
        }
    }

    saved(): boolean {return this.#saved}
    hasUnsavedChanges(): boolean {return this.#project.editing.hasUnsavedChanges() || this.#hasChanges}

    subscribeMetaData(observer: Observer<ProjectMeta>): Subscription {
        return this.#metaUpdated.subscribe(observer)
    }

    updateCover(cover: Option<ArrayBuffer>): void {
        this.#cover = cover
        this.#hasChanges = true
    }

    updateMetaData<KEY extends keyof ProjectMeta>(key: KEY, value: ProjectMeta[KEY]): void {
        if (this.meta[key] === value) {return}
        this.meta[key] = value
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

    static async #writeFiles({uuid, project, meta, cover}: ProjectProfile): Promise<void> {
        // Encode one revision before waiting for another storage owner.
        const projectBytes = new Uint8Array(project.toArrayBuffer())
        const metaBytes = new TextEncoder().encode(JSON.stringify(meta))
        const coverBytes = cover.map(bytes => new Uint8Array(bytes.slice(0)))
        return navigator.locks.request(`opendaw:storage:${ProjectPaths.Folder}`, async () => {
            const results = await Promise.allSettled([
                Workers.Opfs.write(ProjectPaths.projectFile(uuid), projectBytes),
                Workers.Opfs.write(ProjectPaths.projectMeta(uuid), metaBytes),
                coverBytes.match({
                    none: () => Promise.resolve(),
                    some: bytes => Workers.Opfs.write(ProjectPaths.projectCover(uuid), bytes)
                })
            ])
            const failed = results.find(result => result.status === "rejected")
            if (failed?.status === "rejected") {throw failed.reason}
        })
    }
}
