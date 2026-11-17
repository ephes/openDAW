import {OpfsProtocol} from "@opendaw/lib-fusion"
import {Errors, Optional, RuntimeNotifier, Terminable, Terminator, TimeSpan, UUID} from "@opendaw/lib-std"
import {Promises, Wait} from "@opendaw/lib-runtime"
import {SampleStorage, SoundfontStorage, Workers, YService} from "@opendaw/studio-core"
import {P2PSession, type SignalingSocket} from "@opendaw/studio-p2p"
import {StudioService} from "@/service/StudioService"
import {showConnectRoomDialog} from "@/service/StudioLiveRoomDialog.tsx"
import {RoomAwareness, writeIdentity} from "@/service/RoomAwareness"
import {newRoomSessionId, reportRoomResult, RoomResultStatus, startRoomDurationHeartbeat} from "@/service/RoomStatsReporter"
import {ChatService} from "@/chat/ChatService"
import {Events} from "@opendaw/lib-dom"
import {RouteLocation} from "@opendaw/lib-jsx"

const classifyConnectError = (error: unknown): RoomResultStatus => {
    if (Errors.isAbort(error)) {return "abort"}
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Timeout")) {return "sync_timeout"}
    return "unknown"
}

let connectionGeneration = 0

export const connectRoom = async (service: StudioService, prefillRoomName?: Optional<string>): Promise<void> => {
    const generation = ++connectionGeneration
    const profileService = service.projectProfileService
    const initialProject = profileService.getValue().map(profile => profile.project).unwrapOrNull()
    const pending = initialProject?.own(new Terminator()) ?? new Terminator()
    let active = true
    pending.own({terminate: () => {active = false}})
    pending.own(profileService.subscribe(profile => {
        if (profile.map(value => value.project).unwrapOrNull() !== initialProject) {pending.terminate()}
    }))
    const isCurrent = () => active && connectionGeneration === generation
    let progressDialog: Optional<Terminable>
    let unpublished: Optional<Terminable>
    try {
        const result = await showConnectRoomDialog(prefillRoomName).catch(() => null)
        if (result === null || !isCurrent()) {return}
        const {roomName, userName, userColor} = result
        writeIdentity(userName, userColor)
        progressDialog = RuntimeNotifier.progress({
            headline: "Connecting to Room...",
            message: "Please wait while we connect to the room..."
        })
        const sessionId = newRoomSessionId()
        const {status, value: roomResult, error} = await Promises.tryCatch(
            YService.getOrCreateRoom(service.projectProfileService.getValue()
                .map(profile => profile.project), service, roomName))
        if (!isCurrent()) {
            if (status === "resolved") {roomResult.project.terminate()}
            return
        }
        if (status === "resolved") {
            const {project, provider} = roomResult
            unpublished = project
            const terminator = project.own(new Terminator())
            reportRoomResult(sessionId, "success")
            const heartbeat = startRoomDurationHeartbeat(sessionId)
            let ended = false
            const finalize = () => {
                if (ended) {return}
                ended = true
                heartbeat.finalize()
            }
            terminator.ownAll(
                {terminate: finalize},
                Events.subscribe(window, "pagehide", (event: PageTransitionEvent) => {
                    if (ended) {return}
                    if (event.persisted) {heartbeat.pause()} else {finalize()}
                }),
                Events.subscribe(window, "pageshow", (event: PageTransitionEvent) => {
                    if (!ended && event.persisted && profileService.getValue()
                        .map(profile => profile.project).unwrapOrNull() === project) {heartbeat.resume()}
                })
            )
            const p2pSession = new P2PSession({
                chainedSampleProvider: service.chainedSampleProvider,
                chainedSoundfontProvider: service.chainedSoundfontProvider,
                createSocket: url => new WebSocket(url) as SignalingSocket,
                localPeerId: UUID.toString(UUID.generate()),
                assetReader: {
                    hasSample: uuid => SampleStorage.get().exists(uuid),
                    hasSoundfont: uuid => Workers.Opfs.exists(`${SoundfontStorage.Folder}/${UUID.toString(uuid)}`),
                    readSample: async uuid => {
                        const path = `${SampleStorage.Folder}/${UUID.toString(uuid)}`
                        const [wavBytes, metaBytes] = await Promise.all([
                            Workers.Opfs.read(`${path}/audio.wav`, OpfsProtocol.ReadLimits.Media),
                            Workers.Opfs.read(`${path}/meta.json`, OpfsProtocol.ReadLimits.Metadata)
                        ])
                        return [wavBytes.buffer as ArrayBuffer, JSON.parse(new TextDecoder().decode(metaBytes))]
                    },
                    readSoundfont: uuid => SoundfontStorage.get().load(uuid)
                }
            }, roomName, "wss://live.opendaw.studio")
            project.own(p2pSession)
            const roomAwareness = new RoomAwareness(provider.awareness, roomName, userName, userColor)
            terminator.own(roomAwareness)
            terminator.own(Events.subscribe(window, "pointermove", (event: PointerEvent) => {
                const target = event.target
                if (target instanceof Element) {
                    const panel = target.closest("[data-panel-type]")
                    roomAwareness.panel.setValue(panel?.getAttribute("data-panel-type") ?? null)
                } else {
                    roomAwareness.panel.setValue(null)
                }
            }))
            service.factoryFooterLabel().ifSome(factory => {
                const label = factory()
                terminator.own(label)
                const awareness = provider.awareness
                const update = () => label.setValue(String(awareness.getStates().size))
                awareness.on("update", update)
                terminator.own({terminate: () => awareness.off("update", update)})
                label.setTitle("Room Users")
                update()
            })
            RouteLocation.get().navigateTo("/")
            if (!isCurrent()) {return}
            pending.terminate()
            service.projectProfileService.setProject(project, roomName)
            unpublished = undefined
            service.setRoomAwareness(roomAwareness)
            terminator.own({terminate: () => {if (service.roomAwareness.getValue() === roomAwareness) {service.setRoomAwareness(null)}}})
            service.setTrafficMeter(p2pSession.trafficMeter)
            terminator.own({terminate: () => {if (service.trafficMeter.getValue() === p2pSession.trafficMeter) {service.setTrafficMeter(null)}}})
            const chatService = new ChatService(provider.doc, userName, userColor)
            terminator.own(chatService)
            service.chatService.wrap(chatService)
            terminator.own({terminate: () => {if (service.chatService.unwrapOrNull() === chatService) {service.chatService.clear()}}})
            await Wait.timeSpan(TimeSpan.seconds(1))
        } else {
            reportRoomResult(sessionId, classifyConnectError(error))
            await RuntimeNotifier.info({
                headline: "Failed Connecting Room",
                message: String(error)
            })
        }
    } finally {
        pending.terminate()
        try {unpublished?.terminate()} finally {progressDialog?.terminate()}
    }
}
