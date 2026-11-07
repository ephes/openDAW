import {readZipEntry, ZIP_LIMITS, ZipLimits} from "@opendaw/lib-runtime"
import {asDefined, isDefined, panic, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, MetaDataSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {ProjectSkeleton, SampleLoaderManager} from "@opendaw/studio-adapters"
import {DawProjectExporter} from "./DawProjectExporter"
import {ExternalLib} from "../ExternalLib"

export namespace DawProject {
    export type Resource = { uuid: UUID.Bytes, path: string, name: string, buffer: ArrayBuffer }

    export interface ResourceProvider {
        fromPath(path: string): Resource
        fromUUID(uuid: UUID.Bytes): Resource
    }

    export const decode = async (buffer: ArrayBuffer | Buffer<ArrayBuffer>, limits: ZipLimits = ZIP_LIMITS): Promise<{
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
        if (Object.keys(zip.files).length > limits.entries) {throw new Error("Archive entry limit exceeded")}
        const budget = {remaining: limits.total}
        const metadataFile = zip.file("metadata.xml")
        const metaDataXml = metadataFile ? new TextDecoder().decode(await readZipEntry(metadataFile, limits.metadata, budget)) : undefined
        const metaData = isDefined(metaDataXml) ? Xml.parse(metaDataXml, MetaDataSchema) : Xml.element({}, MetaDataSchema)
        const projectXml = new TextDecoder().decode(await readZipEntry(asDefined(zip.file("project.xml"), "No project.xml found"), limits.project ?? Math.min(limits.media, 33_554_432), budget))
        console.debug(projectXml)
        const project = Xml.parse(projectXml, ProjectSchema)
        const resourceFiles = Object.entries(zip.files).filter(([_, file]) =>
            !file.dir && !file.name.endsWith(".xml"))
        const resources: Resource[] = []
        for (const [path, file] of resourceFiles) {
            const name = path.substring(path.lastIndexOf("/") + 1)
            const buffer = (await readZipEntry(file, limits.media, budget)).buffer as ArrayBuffer
            const uuid = await UUID.sha256(new Uint8Array(buffer).buffer)
            resources.push({uuid, path, name, buffer})
        }
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