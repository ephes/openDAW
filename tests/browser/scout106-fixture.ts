import {Option, UUID} from "@opendaw/lib-std"
import {AudioUnitType} from "@opendaw/studio-enums"
import {Project, ProjectMeta, ProjectStorage} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {ProjectDialogs} from "@/project/ProjectDialogs"
import {Surface} from "@/ui/surface/Surface"

let outcome = "idle"
export const projectDialogOutcome = () => outcome
export const openProjectDialog = (kind: "browse" | "stems") => {
    const getSurface = Surface.get, listProjects = ProjectStorage.listProjects
    const mount = document.createElement("div")
    document.body.append(mount)
    Surface.get = () => ({flyout: mount}) as unknown as Surface
    Object.assign(ProjectStorage, {listProjects: async () => [{uuid: UUID.generate(), meta: ProjectMeta.init("Synthetic project")}]})
    const project = {rootBoxAdapter: {audioUnits: {adapters: () => [{uuid: UUID.generate(), type: AudioUnitType.Instrument,
        input: {label: Option.wrap("Synthetic stem")}, isOutput: false}]}}} as unknown as Project
    outcome = "pending"
    const pending = kind === "browse" ? ProjectDialogs.showBrowseDialog({} as StudioService)
        : ProjectDialogs.showExportStemsDialog(project)
    pending.then(() => {outcome = "resolved"}, () => {outcome = "rejected"}).finally(() => {
        Surface.get = getSurface; Object.assign(ProjectStorage, {listProjects}); mount.remove()
    })
}

export type ProjectDialogFixtures = {openProjectDialog: typeof openProjectDialog, projectDialogOutcome: typeof projectDialogOutcome}
