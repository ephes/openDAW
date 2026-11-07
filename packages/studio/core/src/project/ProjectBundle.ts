import {z} from "zod"
import {WavFile} from "@opendaw/lib-dsp"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {readZipEntry, ZIP_LIMITS} from "@opendaw/lib-runtime"
import {ProjectMigration} from "./ProjectMigration"
import {ProjectMeta} from "./ProjectMeta"
import {ByteArrayInput, asDefined, Exec, Option, Progress, RuntimeNotifier, Terminable, UUID} from "@opendaw/lib-std"
import {AudioFileBox, SoundfontFileBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton, SampleLoaderManager, SampleMetaData, SoundfontMetaData, SampleLoader, SoundfontLoader} from "@opendaw/studio-adapters"
import {Project} from "./Project"
import {ProjectEnv} from "./ProjectEnv"
import {ProjectPaths} from "./ProjectPaths"
import {ProjectProfile} from "./ProjectProfile"
import {Workers} from "../Workers"
import {DefaultSampleLoader, SampleStorage} from "../samples"
import type JSZip from "jszip"
import {SoundfontStorage} from "../soundfont"
import {ExternalLib} from "../ExternalLib"

export namespace ProjectBundle {
    export const encode = async ({uuid, project, meta, cover}: ProjectProfile,
                                 progress: Progress.Handler): Promise<ArrayBuffer> => {
        const {status, value: JSZip, error} = await ExternalLib.JSZip()
        if (status === "rejected") {
            await RuntimeNotifier.info({
                headline: "Error",
                message: `Could not load JSZip: ${String(error)}`
            })
            return Promise.reject(error)
        }
        const zip = new JSZip()
        zip.file("version", "1")
        zip.file("uuid", uuid, {binary: true})
        zip.file(ProjectPaths.ProjectFile, project.toArrayBuffer() as ArrayBuffer, {binary: true})
        zip.file(ProjectPaths.ProjectMetaFile, JSON.stringify(meta, null, 2))
        cover.ifSome(buffer => zip.file(ProjectPaths.ProjectCoverFile, buffer, {binary: true}))
        const samples = asDefined(zip.folder("samples"), "Could not create folder samples")
        const soundfonts = asDefined(zip.folder("soundfonts"), "Could not create folder soundfonts")
        const audioFileBoxes = project.boxGraph.boxes().filter(box => box instanceof AudioFileBox)
        const soundfontFileBoxes = project.boxGraph.boxes().filter(box => box instanceof SoundfontFileBox)
        const blob = await Promise.all([
            ...audioFileBoxes
                .map(async ({address: {uuid}}, index) => {
                    const loader: SampleLoader = project.sampleManager.getOrCreate(uuid)
                    const folder = asDefined(samples.folder(UUID.toString(uuid)),
                        "Could not create folder for sample")
                    return pipeSampleLoaderInto(loader, folder)
                        .then(() => progress(index / audioFileBoxes.length * 0.75))
                }),
            ...soundfontFileBoxes
                .map(async ({address: {uuid}}, index) => {
                    const loader: SoundfontLoader = project.soundfontManager.getOrCreate(uuid)
                    const folder = asDefined(soundfonts.folder(UUID.toString(uuid)),
                        "Could not create folder for soundfont")
                    return pipeSoundfontLoaderInto(loader, folder)
                        .then(() => progress(index / soundfontFileBoxes.length * 0.75))
                })
        ]).then(() => zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: {level: 6}
        }))
        progress(1.0)
        return blob.arrayBuffer()
    }

    type BundleAsset = {folder: string, id: UUID.Bytes, name: string, files: Map<string, Uint8Array>, sample?: DefaultSampleLoader}
    const bundleMeta = z.object({
        name: z.string(), artist: z.string(), description: z.string(), tags: z.array(z.string()),
        created: z.string(), modified: z.string(),
        notepad: z.string().optional(), radioToken: z.string().optional()
    }).passthrough()
    const requiredFiles = (asset: BundleAsset) => asset.folder === SampleStorage.Folder
        ? ["audio.wav", "peaks.bin", "meta.json"] : ["soundfont.sf2", "meta.json"]
    const exact = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const validateAsset = (asset: BundleAsset, files = asset.files): DefaultSampleLoader | undefined => {
        if (requiredFiles(asset).some(name => !files.has(name))) {throw new Error("Incomplete bundled asset")}
        const meta = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(files.get("meta.json")!))
        if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {throw new Error("Invalid bundled asset metadata")}
        if (Object.hasOwn(meta, "uuid") && (typeof meta.uuid !== "string" || !UUID.validateString(meta.uuid)
            || meta.uuid.toLowerCase() !== asset.name)) {throw new Error("Bundle metadata UUID does not match its directory")}
        if (asset.folder !== SampleStorage.Folder) {
            SoundfontMetaData.parse(meta)
            if (files.get("soundfont.sf2")!.byteLength === 0) {throw new Error("Empty soundfont asset")}
            return
        }
        const audio = WavFile.decodeFloats(exact(files.get("audio.wav")!))
        const peaks = SamplePeaks.from(new ByteArrayInput(exact(files.get("peaks.bin")!)))
        if (peaks.numFrames !== audio.numberOfFrames || peaks.numChannels !== audio.numberOfChannels) {throw new Error("Bundled peak/audio shape mismatch")}
        const loader = new DefaultSampleLoader(asset.id)
        loader.setLoaded(audio, peaks, SampleMetaData.parse(meta))
        return loader
    }

    export const decode = async (env: ProjectEnv, arrayBuffer: ArrayBuffer, openProfileUUID?: UUID.Bytes): Promise<ProjectProfile> => {
        const library = await ExternalLib.JSZip()
        if (library.status === "rejected") {throw library.error}
        const zip = await library.value.loadAsync(arrayBuffer)
        if (Object.keys(zip.files).length > ZIP_LIMITS.entries) {throw new Error("Bundle entry limit exceeded")}
        for (const file of Object.values(zip.files)) {
            if (!file.dir && file.unsafeOriginalName !== undefined && file.unsafeOriginalName !== file.name) {throw new Error("Noncanonical bundle entry")}
        }
        const budget = {remaining: ZIP_LIMITS.total}
        const read = (name: string, limit: number) => readZipEntry(zip.file(name), limit, budget)
        if (new TextDecoder().decode(await read("version", 8)) !== "1") {throw new Error("Unknown bundle version")}
        const bundleUUID = UUID.validateBytes(await read("uuid", 16))
        if (openProfileUUID && UUID.equals(openProfileUUID, bundleUUID)) {throw new Error("Project is already open")}
        const projectData = exact(await read(ProjectPaths.ProjectFile, ZIP_LIMITS.project!))
        const meta = bundleMeta.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(await read(ProjectPaths.ProjectMetaFile, ZIP_LIMITS.metadata)))) as ProjectMeta
        const skeleton = ProjectSkeleton.decode(projectData)
        const cover = zip.file(ProjectPaths.ProjectCoverFile)
        const coverData = cover ? Option.wrap(exact(await read(ProjectPaths.ProjectCoverFile, ZIP_LIMITS.media))) : Option.None
        const assets = new Map<string, BundleAsset>()
        for (const file of Object.values(zip.files)) {
            if (file.dir) {continue}
            if (!file.name.startsWith("samples/") && !file.name.startsWith("soundfonts/")) {
                continue
            }
            const [root, name, leaf, extra] = file.name.split("/")
            if (extra !== undefined || !name || !leaf) {throw new Error("Invalid bundle asset path")}
            const id = UUID.parse(name)
            if (UUID.toString(id) !== name) {throw new Error("Noncanonical bundle asset UUID")}
            const folder = root === "samples" ? SampleStorage.Folder : SoundfontStorage.Folder
            const key = `${folder}/${name}`
            const asset = assets.get(key) ?? {folder, id, name, files: new Map<string, Uint8Array>()}
            if (!requiredFiles(asset).includes(leaf)) {throw new Error("Unsupported bundle asset entry")}
            asset.files.set(leaf, await readZipEntry(file, leaf === "meta.json" ? ZIP_LIMITS.metadata : ZIP_LIMITS.media, budget))
            assets.set(key, asset)
        }
        for (const asset of assets.values()) {validateAsset(asset)}
        // Migration only needs sample reads. Stage those via the existing loaded loader;
        // do not hold non-reentrant storage locks across asynchronous migration.
        const stagedManager: SampleLoaderManager = {
            getOrCreate: id => {
                const asset = assets.get(`${SampleStorage.Folder}/${UUID.toString(id)}`)
                if (!asset) {throw new Error("Missing bundled sample required for migration")}
                return asset.sample ??= validateAsset(asset)!
            },
            record: loader => env.sampleManager.record(loader), invalidate: id => env.sampleManager.invalidate(id),
            remove: id => env.sampleManager.remove(id), register: id => env.sampleManager.register(id)
        }
        await ProjectMigration.migrate({...env, sampleManager: stagedManager}, skeleton)
        for (const asset of assets.values()) {asset.sample = undefined}
        return navigator.locks.request(`opendaw:storage:${SampleStorage.Folder}`, () =>
            navigator.locks.request(`opendaw:storage:${SoundfontStorage.Folder}`, async () => {
                const fresh: BundleAsset[] = []
                for (const asset of assets.values()) {
                    let entries: ReadonlyArray<{name: string}>
                    try {entries = await Workers.Opfs.list(asset.folder)} catch (error) {
                        if (!(error instanceof DOMException) || error.name !== "NotFoundError") {throw error}
                        entries = []
                    }
                    if (!entries.some(entry => entry.name === asset.name)) {fresh.push(asset); continue}
                    const existing = new Map<string, Uint8Array>()
                    try {
                        for (const leaf of requiredFiles(asset)) {existing.set(leaf, await Workers.Opfs.read(`${asset.folder}/${asset.name}/${leaf}`))}
                    } catch (cause) {throw new Error("Incomplete existing bundle asset; repair it before importing", {cause})}
                    const media = asset.folder === SampleStorage.Folder ? "audio.wav" : "soundfont.sf2"
                    const before = existing.get(media)!, incoming = asset.files.get(media)!
                    if (before.length !== incoming.length || before.some((byte, index) => byte !== incoming[index])) {throw new Error("Conflicting existing bundle asset")}
                    try {validateAsset(asset, existing)}
                    catch (cause) {throw new Error("Invalid existing bundle asset; repair it before importing", {cause})}
                }
                const owned: BundleAsset[] = []
                let project: Project | undefined
                try {
                    for (const asset of fresh) {
                        owned.push(asset)
                        for (const leaf of requiredFiles(asset)) {await Workers.Opfs.write(`${asset.folder}/${asset.name}/${leaf}`, asset.files.get(leaf)!)}
                    }
                    // fromSkeleton is synchronous; no nested asynchronous storage locks.
                    project = Project.fromSkeleton(env, skeleton)
                    return new ProjectProfile(bundleUUID, project, meta, coverData)
                } catch (error) {
                    try {project?.terminate()} catch {console.warn("Could not finish failed bundle project cleanup")}
                    for (const asset of owned.reverse()) {
                        try {await Workers.Opfs.delete(`${asset.folder}/${asset.name}`)}
                        catch {console.warn("Could not remove newly owned bundle asset after import failure")}
                    }
                    throw error
                }
            }))
    }

    const pipeSampleLoaderInto = async (loader: SampleLoader, zip: JSZip): Promise<void> => {
        const exec: Exec = async () => {
            const path = `${SampleStorage.Folder}/${UUID.toString(loader.uuid)}`
            zip.file("audio.wav", await Workers.Opfs.read(`${path}/audio.wav`), {binary: true})
            zip.file("peaks.bin", await Workers.Opfs.read(`${path}/peaks.bin`), {binary: true})
            zip.file("meta.json", await Workers.Opfs.read(`${path}/meta.json`))
        }
        if (loader.state.type === "loaded") {
            return exec()
        } else {
            return new Promise<void>((resolve, reject) => {
                let subscription = Terminable.Empty
                let settled = false
                subscription = loader.subscribe(state => {
                    if (state.type === "loaded") {
                        settled = true
                        resolve()
                        subscription.terminate()
                    } else if (state.type === "error") {
                        settled = true
                        reject(new Error(state.reason))
                        subscription.terminate()
                    }
                })
                if (settled) {subscription.terminate()}
            }).then(() => exec())
        }
    }

    const pipeSoundfontLoaderInto = async (loader: SoundfontLoader, zip: JSZip): Promise<void> => {
        const exec: Exec = async () => {
            const path = `${SoundfontStorage.Folder}/${UUID.toString(loader.uuid)}`
            zip.file("soundfont.sf2", await Workers.Opfs.read(`${path}/soundfont.sf2`), {binary: true})
            zip.file("meta.json", await Workers.Opfs.read(`${path}/meta.json`))
        }
        if (loader.state.type === "loaded") {
            return exec()
        } else {
            return new Promise<void>((resolve, reject) => {
                let subscription = Terminable.Empty
                let settled = false
                subscription = loader.subscribe(state => {
                    if (state.type === "loaded") {
                        settled = true
                        resolve()
                        subscription.terminate()
                    } else if (state.type === "error") {
                        settled = true
                        reject(new Error(state.reason))
                        subscription.terminate()
                    }
                })
                if (settled) {subscription.terminate()}
            }).then(() => exec())
        }
    }
}