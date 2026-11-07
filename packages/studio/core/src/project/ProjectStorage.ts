import {Class, Option, Progress, safeExecute, UUID} from "@opendaw/lib-std"
import {AudioFileBox, SoundfontFileBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectMeta} from "./ProjectMeta"
import {Workers} from "../Workers"
import {ProjectPaths} from "./ProjectPaths"
import {deleteWithJournal, readTrashedIds} from "../deletionJournal"

export namespace ProjectStorage {
    export type ListEntry = {
        uuid: UUID.Bytes
        meta: ProjectMeta
        cover?: ArrayBuffer
        project?: ArrayBuffer
    }

    export type List = ReadonlyArray<ListEntry>

    export const listProjects = async ({includeCover, includeProject, progress, strict = false}: {
        strict?: boolean
        includeCover?: boolean
        includeProject?: boolean
        progress?: Progress.Handler
    } = {}): Promise<List> => {
        const files = await Workers.Opfs.list(ProjectPaths.Folder)
        const entries = await Promise.all(files.filter(file => file.kind === "directory")
            .map(async ({name}, index, {length}): Promise<ListEntry | null> => {
                safeExecute(progress, (index + 1) / length)
                try {
                    const uuid = UUID.parse(name)
                    const meta = JSON.parse(new TextDecoder().decode(
                        await Workers.Opfs.read(ProjectPaths.projectMeta(uuid)))) as ProjectMeta
                    if (typeof meta?.name !== "string") {throw new Error("Invalid project metadata")}
                    return {
                        uuid, meta,
                        cover: includeCover ? (await loadCover(uuid)).unwrapOrUndefined() : undefined,
                        project: includeProject ? await loadProject(uuid) : undefined
                    }
                } catch (cause) {
                    if (strict) {throw new Error(`Cannot scan project '${name.slice(0, 80)}'; repair or restore it before backup.`, {cause})}
                    console.warn(`Skipping unreadable project directory '${name.slice(0, 80)}'; retained for recovery.`)
                    return null
                }
            }))
        return entries.filter((entry): entry is ListEntry => entry !== null)
    }

    export const loadProject = async (uuid: UUID.Bytes): Promise<ArrayBuffer> => {
        return Workers.Opfs.read(ProjectPaths.projectFile(uuid)).then(array => array.buffer as ArrayBuffer)
    }

    export const loadMeta = async (uuid: UUID.Bytes): Promise<ArrayBuffer> => {
        return Workers.Opfs.read(ProjectPaths.projectMeta(uuid)).then(array => array.buffer as ArrayBuffer)
    }

    export const loadCover = async (uuid: UUID.Bytes): Promise<Option<ArrayBuffer>> => {
        return Workers.Opfs.read(ProjectPaths.projectCover(uuid))
            .then(array => Option.wrap(array.buffer as ArrayBuffer), () => Option.None)
    }

    export const listUsedAssets = async (
        type: Class<AudioFileBox | SoundfontFileBox>
    ): Promise<Map<UUID.String, Array<string>>> => {
        console.debug("listUsedAssets", type.name)
        const result = new Map<UUID.String, Array<string>>()
        const exactBuffer = (bytes: Uint8Array): ArrayBuffer =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const files = await Workers.Opfs.list(ProjectPaths.Folder)
        for (const {name: folder} of files.filter(file => file.kind === "directory")) {
            let projectName = folder
            let decoded: ProjectSkeleton
            try {
                const uuid = UUID.parse(folder)
                const projectBytes = await Workers.Opfs.read(ProjectPaths.projectFile(uuid))
                const metaBytes = await Workers.Opfs.read(ProjectPaths.projectMeta(uuid))
                projectName = (JSON.parse(new TextDecoder().decode(metaBytes)) as ProjectMeta).name
                decoded = ProjectSkeleton.decode(exactBuffer(projectBytes))
            } catch (cause) {
                throw new Error(`Cannot check asset usage: repair or restore project '${folder.slice(0, 80)}' before deleting assets.`, {cause})
            }
            for (const box of decoded.boxGraph.boxes()) {
                if (!(box instanceof type)) {continue}
                const key = UUID.toString(box.address.uuid)
                const list = result.get(key) ?? []
                if (!list.includes(projectName)) {list.push(projectName)}
                result.set(key, list)
            }
        }
        return result
    }

    export const deleteProject = async (uuid: UUID.Bytes) => {
        await deleteWithJournal(ProjectPaths.Folder, uuid, ProjectPaths.projectFolder(uuid))
    }

    export const loadTrashedIds = async (): Promise<Array<UUID.String>> => {
        return readTrashedIds(ProjectPaths.Folder)
    }
}