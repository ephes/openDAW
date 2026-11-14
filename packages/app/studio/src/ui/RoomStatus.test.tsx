import {afterEach, expect, it, vi} from "vitest"
import {RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import {RoomStatus} from "./RoomStatus"
import type {StudioService} from "@/service/StudioService"

vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "synthetic-room-status"}}
})
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("span")}))
vi.mock("@/ui/TrafficWatch", () => ({TrafficWatch: () => document.createElement("span")}))

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

it.each([true, false])("RoomStatus acknowledges only successful writes (reject=%s)", async reject => {
    const notices: string[] = []
    vi.spyOn(RuntimeNotifier, "info").mockImplementation(async request => {notices.push(request.headline ?? "")})
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {
        writeText: vi.fn(async () => {if (reject) {throw new DOMException("synthetic denial", "NotAllowedError")}})
    }})
    const lifecycle = new Terminator()
    const service = {
        roomAwareness: {catchupAndSubscribe: (observer: (value: unknown) => void) => {
            observer({getValue: () => ({roomName: "synthetic", clientID: 1,
                awareness: {getStates: () => new Map(), on() {}, off() {}}})})
            return Terminable.Empty
        }},
        trafficMeter: {getValue: () => null}
    } as unknown as StudioService
    const element = RoomStatus({lifecycle, service})
    element.querySelector<HTMLElement>(".room-name")!.click()
    for (let i = 0; i < 15; i++) {await Promise.resolve()}
    expect(notices).toEqual([reject ? "Clipboard Error" : "Clipboard"])
    lifecycle.terminate()
})
