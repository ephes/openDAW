import {asDefined, isDefined, panic, RuntimeNotifier, Subscription, UUID} from "@opendaw/lib-std"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, MetaDataSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {ProjectSkeleton, SampleLoader, SampleLoaderManager} from "@opendaw/studio-adapters"
import {AudioFileBox, BoxVisitor} from "@opendaw/studio-boxes"
import {DawProjectExporter} from "./DawProjectExporter"
import {ExternalLib} from "../ExternalLib"

export namespace DawProject {
    export type Resource = { uuid: UUID.Bytes, path: string, name: string, buffer: ArrayBuffer }

    export interface ResourceProvider {
        fromPath(path: string): Resource
        fromUUID(uuid: UUID.Bytes): Resource
    }

    const waitForLoaderTerminal = (loader: SampleLoader): Promise<void> =>
        new Promise(resolve => {
            if (loader.data.nonEmpty() || loader.state.type === "error") {resolve(); return}
            let subscription: Subscription
            subscription = loader.subscribe(state => {
                if (state.type === "loaded" || state.type === "error") {
                    queueMicrotask(() => subscription.terminate())
                    resolve()
                }
            })
            loader.requestData()
        })

    export const decode = async (buffer: ArrayBuffer | Buffer<ArrayBuffer>): Promise<{
        metaData: MetaDataSchema,
        project: ProjectSchema,
        resources: ResourceProvider
    }> => {
        const {status, value: JSZip, error} = await ExternalLib.JSZip()
        if (status === "rejected") {
            await RuntimeNotifier.info({
                headline: "Error",
                message: `Could not load JSZip: ${String(error)}`
            })
            return Promise.reject(error)
        }
        const zip = await JSZip.loadAsync(buffer)
        const metaDataXml = await zip.file("metadata.xml")?.async("string")
        const metaData = isDefined(metaDataXml) ? Xml.parse(metaDataXml, MetaDataSchema) : Xml.element({}, MetaDataSchema)
        const projectXml = asDefined(await zip.file("project.xml")?.async("string"), "No project.xml found")
        console.debug(projectXml)
        const project = Xml.parse(projectXml, ProjectSchema)
        const resourceFiles = Object.entries(zip.files).filter(([_, file]) =>
            !file.dir && !file.name.endsWith(".xml"))
        const resources: ReadonlyArray<Resource> =
            await Promise.all(resourceFiles.map(async ([path, file]) => {
                const name = path.substring(path.lastIndexOf("/") + 1)
                const buffer = await file.async("arraybuffer")
                const uuid = await UUID.sha256(new Uint8Array(buffer).buffer)
                return {uuid, path, name, buffer}
            }))
        return {
            metaData, project, resources: {
                fromPath: (path: string): Resource => resources
                    .find(resource => resource.path === path) ?? panic("Resource not found"),
                fromUUID: (uuid: UUID.Bytes): Resource => resources
                    .find(resource => UUID.equals(resource.uuid, uuid)) ?? panic("Resource not found")
            }
        }
    }

    export const encode = async (skeleton: ProjectSkeleton,
                                 sampleManager: SampleLoaderManager,
                                 metaData: MetaDataSchema): Promise<ArrayBuffer> => {
        const {status, value: JSZip, error} = await ExternalLib.JSZip()
        if (status === "rejected") {
            await RuntimeNotifier.info({
                headline: "Error",
                message: `Could not load JSZip: ${String(error)}`
            })
            return Promise.reject(error)
        }
        const zip = new JSZip()
        // The exporter reads each AudioFileBox loader's `data` synchronously. Long-recording loaders
        // are lazy (peaks ready, PCM materialized only on demand), so materialize every referenced
        // AudioFileBox here before the synchronous export runs; otherwise a never-played long recording
        // would be omitted from the .dawproject. Errored/unloadable samples are left for the exporter's
        // existing `.data` gating to skip (preserving prior lenient behavior).
        const audioFileBoxes: Array<AudioFileBox> = []
        skeleton.boxGraph.boxes().forEach(box => box.accept<BoxVisitor>({
            visitAudioFileBox: (audioFileBox: AudioFileBox): void => {audioFileBoxes.push(audioFileBox)}
        }))
        await Promise.all(audioFileBoxes.map(box =>
            waitForLoaderTerminal(sampleManager.getOrCreate(box.address.uuid))))
        const projectSchema = DawProjectExporter.write(skeleton, sampleManager, {
            write: (path: string, buffer: ArrayBuffer): FileReferenceSchema => {
                zip.file(path, buffer)
                return Xml.element({path, external: false}, FileReferenceSchema)
            }
        })
        const metaDataXml = Xml.pretty(Xml.toElement("MetaData", metaData))
        const projectXml = Xml.pretty(Xml.toElement("Project", projectSchema))
        console.debug("encode")
        console.debug(metaDataXml)
        console.debug(projectXml)
        zip.file("metadata.xml", metaDataXml)
        zip.file("project.xml", projectXml)
        return zip.generateAsync({type: "arraybuffer"})
    }
}