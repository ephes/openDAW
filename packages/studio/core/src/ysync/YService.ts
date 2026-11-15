import {Errors, Option, panic, RuntimeNotifier, Terminator, TimeSpan, UUID} from "@opendaw/lib-std"
import {BoxGraph} from "@opendaw/lib-box"
import {Promises} from "@opendaw/lib-runtime"
import {BoxIO, UserInterfaceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {Project, ProjectEnv, ProjectMigration} from "../project"
import {YSync} from "./YSync"
import * as Y from "yjs"
import {WebsocketProvider} from "y-websocket"

// https://inspector.yjs.dev/

export namespace YService {
    const USE_LOCAL_SERVER = false
    const LOCAL_SERVER_URL = "wss://localhost:1234"
    const ONLINE_SERVER_URL = "wss://live.opendaw.studio"
    const serverUrl = USE_LOCAL_SERVER ? LOCAL_SERVER_URL : ONLINE_SERVER_URL

    export type RoomResult = { project: Project, provider: WebsocketProvider }

    export const getOrCreateRoom = async (optProject: Option<Project>,
                                          env: ProjectEnv,
                                          roomName: string): Promise<RoomResult> => {
        if (roomName === "signaling") {return panic("Invalid room name: signaling")}
        const resources = new Terminator()
        const doc = new Y.Doc()
        resources.own({terminate: () => doc.destroy()})
        let project: Project | undefined
        try {
            const provider = new WebsocketProvider(serverUrl, roomName, doc)
            resources.own({terminate: () => provider.destroy()})
            if (!provider.synced) {
                const {resolve, promise} = Promise.withResolvers<void>()
                const onSync = (isSynced: boolean) => {if (isSynced) {resolve()}}
                provider.on("sync", onSync)
                try {
                    await Promises.timeout(promise, TimeSpan.seconds(10), "Timeout 'synced'")
                } finally {
                    provider.off("sync", onSync)
                }
            }
            const boxes = doc.getMap("boxes")
            if (boxes.size === 0) {
                project = optProject.match({none: () => Project.new(env), some: project => project.copy()})
                resources.own(await YSync.populateRoom({
                    boxGraph: project.boxGraph, boxes, conflict: () => project?.invalid() ?? false
                }))
            } else {
                if (optProject.nonEmpty() && !await RuntimeNotifier.approve({
                    headline: "Room Already Exists", message: "Do you want to join it?",
                    approveText: "Join", cancelText: "Cancel"
                })) {throw Errors.AbortError}
                const boxGraph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
                resources.own(await YSync.joinRoom({boxGraph, boxes, conflict: () => project?.invalid() ?? false}))
                const mandatoryBoxes = ProjectSkeleton.findMandatoryBoxes(boxGraph)
                const skeleton: ProjectSkeleton = {boxGraph, mandatoryBoxes}
                await ProjectMigration.migrate(env, skeleton)
                project = Project.fromSkeleton(env, skeleton, false)
                boxGraph.beginTransaction()
                try {
                    const userInterfaceBox = UserInterfaceBox.create(boxGraph, UUID.generate(),
                        box => box.root.refer(mandatoryBoxes.rootBox.users))
                    boxGraph.endTransaction()
                    project.follow(userInterfaceBox)
                } catch (error) {
                    if (boxGraph.inTransaction()) {boxGraph.abortTransaction()}
                    throw error
                }
            }
            // Transfer the complete room lifetime only after successful admission.
            project.own(resources)
            return {project, provider}
        } catch (error) {
            // Drain all resources even when a cleanup itself fails, preserving
            // the construction error as the caller's failure.
            try {project?.terminate()} catch (cleanupError) {console.warn("Room project cleanup failed", cleanupError)}
            try {resources.terminate()} catch (cleanupError) {console.warn("Room resource cleanup failed", cleanupError)}
            throw error
        }
    }
}
