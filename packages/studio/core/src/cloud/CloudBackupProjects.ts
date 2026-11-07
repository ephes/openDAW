import {parseProjectsCatalog, validateProjectsCatalog} from "./catalogs"
import {
    Arrays,
    Errors,
    isAbsent,
    Maybe,
    Objects,
    panic,
    Procedure,
    Progress,
    RuntimeNotifier,
    UUID
} from "@opendaw/lib-std"
import {network, Promises} from "@opendaw/lib-runtime"
import {ProjectMeta} from "../project/ProjectMeta"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectStorage} from "../project/ProjectStorage"
import {CloudHandler} from "./CloudHandler"
import {Workers} from "../Workers"
import {ProjectPaths} from "../project/ProjectPaths"

// these get indexed in the cloud with the uuid in the cloud's catalog
const catalogFields = ["name", "modified", "created", "tags", "description"] as const

type CatalogFields = typeof catalogFields[number]
type MetaFields = Pick<ProjectMeta, CatalogFields> & {generation?: UUID.String}
type Projects = Record<UUID.String, MetaFields>
type ProjectDomains = Record<"local" | "cloud", Projects>

export class CloudBackupProjects {
    static readonly RemotePath = "projects"
    static readonly RemoteCatalogPath = `${this.RemotePath}/index.json`

    static async start(cloudHandler: CloudHandler,
                       progress: Progress.Handler,
                       log: Procedure<string>) {
        log("Collecting all project domains...")
        const [local, cloud] = await Promise.all([
            ProjectStorage.listProjects({strict: true})
                .then(list => list.reduce((record: Projects, entry: ProjectStorage.ListEntry) => {
                    record[UUID.toString(entry.uuid)] = Objects.include(entry.meta, ...catalogFields)
                    return record
                }, {})).then(value => validateProjectsCatalog(value)),
            cloudHandler.download(CloudBackupProjects.RemoteCatalogPath)
                .then(json => parseProjectsCatalog(json))
                .catch(reason => reason instanceof Errors.FileNotFound ? {} : panic(reason))
        ])
        return new CloudBackupProjects(cloudHandler, {local, cloud}, log).#start(progress)
    }

    readonly #cloudHandler: CloudHandler
    readonly #projectDomains: ProjectDomains
    readonly #log: Procedure<string>

    private constructor(cloudHandler: CloudHandler, projectDomains: ProjectDomains, log: Procedure<string>) {
        this.#cloudHandler = cloudHandler
        this.#projectDomains = projectDomains
        this.#log = log
    }

    async #start(progress: Progress.Handler): Promise<void> {
        const trashed = await ProjectStorage.loadTrashedIds()
        const [uploadProgress, trashProgress, downloadProgress] = Progress.splitWithWeights(progress, [0.45, 0.10, 0.45])
        await this.#upload(uploadProgress)
        await this.#trash(trashed, trashProgress)
        await this.#download(trashed, downloadProgress)
    }

    async #upload(progress: Progress.Handler): Promise<void> {
        const {local, cloud} = this.#projectDomains
        const isUnsynced = (localProject: MetaFields, cloudProject: Maybe<MetaFields>) =>
            isAbsent(cloudProject)
            || new Date(cloudProject.modified).getTime() < new Date(localProject.modified).getTime()
        const unsyncedProjects: ReadonlyArray<[UUID.String, MetaFields]> = Object.entries(local)
            .filter(([uuid, localProject]) => isUnsynced(localProject, cloud[uuid as UUID.String]))
            .map(([uuid, localProject]) => ([UUID.asString(uuid), localProject]))
        if (unsyncedProjects.length === 0) {
            this.#log("No unsynced projects found.")
            progress(1.0)
            return
        }
        const uploaded = await Promises.sequentialAll(unsyncedProjects
            .map(([uuidAsString]: [UUID.String, MetaFields], index, {length}) => async () => {
                progress((index + 1) / length)
                const uuid = UUID.parse(uuidAsString)
                const {meta: metaFile, project: projectFile, cover: optCoverFile} = await ProjectStorage.readSnapshot(uuid)
                const captured = validateProjectsCatalog({[uuidAsString]: JSON.parse(new TextDecoder().decode(metaFile))})[uuidAsString]
                const meta = Objects.include(captured, ...catalogFields)
                if (!isUnsynced(meta, cloud[uuidAsString])) {return null}
                this.#log(`Uploading project '${meta.name}'`)
                const generation = await Promises.approvedRetry(async () => {
                    const generation = UUID.toString(UUID.generate())
                    const folder = `${CloudBackupProjects.RemotePath}/${uuidAsString}/generations/${generation}`
                    const files = [
                        {path: `${folder}/project.od`, data: projectFile},
                        {path: `${folder}/meta.json`, data: metaFile}
                    ]
                    optCoverFile.ifSome(data => {files.push({path: `${folder}/image.bin`, data})})
                    const controller = new AbortController()
                    let expired = false
                    const deadline = setTimeout(() => {
                        expired = true
                        controller.abort()
                    }, 10 * 60_000)
                    try {
                        // Keep backup ownership until the started operation settles, even
                        // if a transport ignores abort. Never overlap retry with old work.
                        for (const {path, data} of files) {
                            controller.signal.throwIfAborted()
                            await this.#cloudHandler.upload(path, data, controller.signal)
                        }
                        controller.signal.throwIfAborted()
                        return generation
                    } catch (error) {
                        if (expired) {throw new Error("Upload timeout (10 min).")}
                        throw error
                    } finally {
                        clearTimeout(deadline)
                    }
                }, error => ({
                    headline: "Upload failed",
                    message: `Failed to upload project '${meta.name}'. '${error}'`,
                    approveText: "Retry",
                    cancelText: "Cancel"
                }))
                return {uuidAsString, meta: {...meta, generation}}
            }))
        const complete = uploaded.filter(entry => entry !== null)
        if (complete.length === 0) {progress(1.0); return}
        const catalog = complete
            .reduce((projects, project) => {
                projects[UUID.asString(project.uuidAsString)] = project.meta
                return projects
            }, {...cloud})
        await this.#uploadCatalog(catalog)
        progress(1.0)
    }

    async #trash(trashed: ReadonlyArray<UUID.String>, progress: Progress.Handler): Promise<void> {
        const {cloud} = this.#projectDomains
        const obsolete: Array<[string, MetaFields]> =
            Arrays.intersect(Object.entries(cloud), trashed, ([uuid, _], trashed) => uuid === trashed)
        if (obsolete.length > 0) {
            const approved = await RuntimeNotifier.approve({
                headline: "Delete Projects?",
                message: `Found ${obsolete.length} locally deleted projects. Delete from cloud as well?`,
                approveText: "Yes",
                cancelText: "No"
            })
            if (approved) {
                const deleted: ReadonlyArray<UUID.String> = await Promises.sequentialAll(
                    obsolete.map(([uuid, meta], index, {length}) => async () => {
                        progress((index + 1) / length)
                        const path = `${CloudBackupProjects.RemotePath}/${uuid}`
                        this.#log(`Deleting '${meta.name}'`)
                        await this.#cloudHandler.delete(path)
                        return UUID.asString(uuid)
                    }))
                const catalog = {...cloud}
                deleted.forEach(uuid => delete catalog[uuid])
                await this.#uploadCatalog(catalog)
            }
        }
        progress(1.0)
    }

    async #download(trashed: ReadonlyArray<UUID.String>, progress: Progress.Handler): Promise<void> {
        const {cloud, local} = this.#projectDomains
        const compareFn = ([uuidA]: [string, MetaFields], [uuidB]: [string, MetaFields]) => uuidA === uuidB
        const missingLocally = Arrays.subtract(Object.entries(cloud), Object.entries(local), compareFn)
        const download = Arrays.subtract(missingLocally, trashed, ([projectUUID], uuid) => projectUUID === uuid)
        if (download.length === 0) {
            this.#log("No projects to download.")
            progress(1.0)
            return
        }
        await Promises.sequentialAll(
            download.map(([uuidAsString, meta], index, {length}) => async () => {
                progress((index + 1) / length)
                const uuid = UUID.parse(uuidAsString)
                const root = `${CloudBackupProjects.RemotePath}/${uuidAsString}`
                const path = meta.generation === undefined ? root : `${root}/generations/${meta.generation}`
                this.#log(`Downloading project '${meta.name}'`)
                const files = await Promises.guardedRetry(() =>
                    this.#cloudHandler.list(path), network.defaultRetry)
                const hasProjectFile = files.includes("project.od")
                const hasMetaFile = files.includes("meta.json")
                if (!hasProjectFile || !hasMetaFile) {
                    console.warn(`hasProjectFile: ${hasProjectFile}, hasMetaFile: ${hasMetaFile} for ${uuidAsString}`)
                    const approvedDeletion = await RuntimeNotifier.approve({
                        headline: "Download failed",
                        message: `Project '${meta.name}' is corrupted. Delete it from cloud?.`,
                        approveText: "Yes",
                        cancelText: "Ignore"
                    })
                    if (approvedDeletion) {
                        await this.#cloudHandler.delete(root)
                        const catalog = {...this.#projectDomains.cloud}
                        delete catalog[UUID.asString(uuidAsString)]
                        await this.#uploadCatalog(catalog)
                    }
                    return uuidAsString
                }
                const projectPath = `${path}/project.od`
                const metaPath = `${path}/meta.json`
                const coverPath = `${path}/image.bin`
                const projectArrayBuffer = await Promises.guardedRetry(() =>
                    this.#cloudHandler.download(projectPath), network.defaultRetry)
                const metaArrayBuffer = await Promises.guardedRetry(() =>
                    this.#cloudHandler.download(metaPath), network.defaultRetry)
                // Acquire the entire selected set before publishing any local bytes.
                ProjectSkeleton.decode(projectArrayBuffer)
                const restoredMeta = JSON.parse(new TextDecoder().decode(metaArrayBuffer)) as ProjectMeta
                if (typeof restoredMeta?.name !== "string") {throw new Error("Invalid restored project metadata")}
                const hasCover = files.includes("image.bin")
                const cover = hasCover ? await Promises.guardedRetry(() =>
                    this.#cloudHandler.download(coverPath), network.defaultRetry) : undefined
                await navigator.locks.request(`opendaw:storage:${ProjectPaths.Folder}`, async () => {
                    const existing = await Workers.Opfs.list(ProjectPaths.Folder)
                    if (existing.some(entry => entry.name === uuidAsString)) {
                        // A project may have been created since the initial backup scan.
                        // Never clean up or overwrite a directory this restore does not own.
                        const meta = JSON.parse(new TextDecoder().decode(await Workers.Opfs.read(ProjectPaths.projectMeta(uuid))))
                        if (typeof meta?.name !== "string") {throw new Error("Repair the existing local project before restoring")}
                        ProjectSkeleton.decode(await ProjectStorage.loadProject(uuid))
                        return
                    }
                    try {
                        await Workers.Opfs.write(ProjectPaths.projectFile(uuid), new Uint8Array(projectArrayBuffer))
                        if (cover !== undefined) {
                            await Workers.Opfs.write(ProjectPaths.projectCover(uuid), new Uint8Array(cover))
                        }
                        // Metadata makes a project visible, so it is always written last.
                        await Workers.Opfs.write(ProjectPaths.projectMeta(uuid), new Uint8Array(metaArrayBuffer))
                    } catch (error) {
                        await Workers.Opfs.delete(ProjectPaths.projectFolder(uuid))
                        throw error
                    }
                })
                return uuidAsString
            }))
        this.#log("Download projects complete.")
        progress(1.0)
    }

    async #uploadCatalog(catalog: Projects): Promise<void> {
        this.#log("Uploading project catalog...")
        const jsonString = JSON.stringify(catalog, null, 2)
        const buffer = new TextEncoder().encode(jsonString).buffer
        await this.#cloudHandler.upload(CloudBackupProjects.RemoteCatalogPath, buffer)
        this.#projectDomains.cloud = catalog
    }
}