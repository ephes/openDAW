import {Errors, isDefined, Option, panic, RuntimeNotifier, tryCatch} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {Files} from "@opendaw/lib-dom"
import {Xml} from "@opendaw/lib-xml"
import {MetaDataSchema} from "@opendaw/lib-dawproject"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {DawProject} from "./DawProject"
import {FilePickerAcceptTypes} from "../FilePickerAcceptTypes"
import {DawProjectImport} from "./DawProjectImporter"
import {ProjectProfile} from "../project"
import {SampleService} from "../samples"

export class DawProjectService {
    static readonly MaxCompressedBytes = 536_870_912
    static readonly SampleImportConcurrency = 2

    static async importDawproject(sampleService: SampleService): Promise<Option<ProjectSkeleton>> {
        const {status, value, error} =
            await Promises.tryCatch(Files.open({types: [FilePickerAcceptTypes.DawprojectFileType]}))
        if (status === "rejected") {
            if (Errors.isAbort(error)) {return Option.None}
            return panic(String(error))
        }
        const file = value.at(0)
        if (!isDefined(file)) {return Option.None}
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > this.MaxCompressedBytes) {
            throw new RangeError("DAWproject compressed input limit exceeded (512 MiB)")
        }
        const arrayBuffer = await file.arrayBuffer()
        const {project: projectSchema, resources} = await DawProject.decode(arrayBuffer)
        const importResult = await Promises.tryCatch(DawProjectImport.read(projectSchema, resources))
        if (importResult.status === "rejected") {
            await RuntimeNotifier.info({headline: "Import Error", message: String(importResult.error)})
            return Option.None
        }
        const {skeleton, audioIds} = importResult.value
        const imported: Array<Awaited<ReturnType<SampleService["importOwnedFile"]>>> = []
        const failures: unknown[] = []
        await Promises.allWithLimit(audioIds
            .map(uuid => resources.fromUUID(uuid))
            .map(resource => async () => {
                if (failures.length > 0) {return}
                const result = await Promises.tryCatch(sampleService.importOwnedFile({
                    uuid: resource.uuid, name: resource.name, arrayBuffer: resource.buffer
                }))
                if (result.status === "rejected") {failures.push(result.error)}
                else {imported.push(result.value)}
            }), this.SampleImportConcurrency)
        if (failures.length === 0) {
            const publication = tryCatch(() => imported.forEach(resource => resource.publish()))
            if (publication.status === "failure") {failures.push(publication.error)}
        }
        if (failures.length > 0) {
            for (const resource of imported.toReversed()) {
                const cleanup = await Promises.tryCatch(resource.rollback())
                if (cleanup.status === "rejected") {console.warn("DAWproject asset cleanup failed", cleanup.error)}
            }
            throw failures[0]
        }
        return Option.wrap(skeleton)
    }

    static async exportDawproject(profile: ProjectProfile): Promise<void> {
        const dialog = RuntimeNotifier.progress({headline: "Exporting DawProject..."})
        const {project, meta} = profile
        const {status, error, value: zip} = await Promises.tryCatch(
            DawProject.encode(project.skeleton, project.sampleManager, Xml.element({
                title: meta.name,
                year: new Date().getFullYear().toString(),
                website: "https://opendaw.studio"
            }, MetaDataSchema)))
        dialog.terminate()
        if (status === "rejected") {
            return RuntimeNotifier.info({headline: "Export Error", message: String(error)})
        }
        const saveResult = await Promises.tryCatch(Files.save(zip,
            {types: [FilePickerAcceptTypes.DawprojectFileType]}))
        if (saveResult.status === "rejected" && !Errors.isAbort(saveResult.error)) {
            throw saveResult.error
        }
    }
}
