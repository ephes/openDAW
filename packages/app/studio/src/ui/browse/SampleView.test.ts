import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {SampleView} from "./SampleView"
import {AssetLocation} from "./AssetLocation"
const mocks = vi.hoisted(() => ({update: vi.fn(), dialog: vi.fn()}))
vi.mock("@opendaw/lib-dom", async original => {
    const actual = await original<typeof import("@opendaw/lib-dom")>()
    return {...actual, Html: {...actual.Html, adoptStyleSheet: () => "sample"}}
})
vi.mock("@opendaw/studio-core", () => ({ContextMenu: {subscribe: () => ({terminate() {}})}, MenuItem: {}, SampleStorage: {get: () => ({updateSampleMeta: mocks.update})}}))
vi.mock("@/ui/DragAndDrop", () => ({DragAndDrop: {installSource: () => ({terminate() {}})}}))
vi.mock("@/ui/browse/SampleDialogs", () => ({SampleDialogs: {showEditSampleDialog: mocks.dialog}}))
vi.mock("@/ui/components/Icon", () => ({Icon: (props: {className: string, onInit: (element: SVGSVGElement) => void}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    element.classList.add(props.className)
    props.onInit(element)
    return element
}}))
const sample = {uuid: "00000000-0000-4000-8000-000000000001" as UUID.String, name: "Synthetic", bpm: 120, duration: 1, sample_rate: 44100, origin: "import"}
beforeEach(() => {vi.spyOn(console, "warn").mockImplementation(() => {}); mocks.dialog.mockResolvedValue(sample); vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const fail of [false, true]) {
    it(`handles the actual edit icon completion and refreshes (failure=${fail})`, async () => {
        if (fail) {mocks.update.mockRejectedValue(new Error("stale target"))} else {mocks.update.mockResolvedValue(undefined)}
        const refresh = vi.fn()
        const node = SampleView({sample, location: AssetLocation.Local, refresh,
            lifecycle: {own: vi.fn(), ownAll: vi.fn()}, service: {hasProfile: false},
            playback: {subscribe: () => ({terminate() {}})}} as unknown as Parameters<typeof SampleView>[0]) as HTMLElement
        const icon = node.querySelector<SVGSVGElement>(".edit-icon")!
        await expect(Promise.resolve(icon.onclick!.call(icon, new MouseEvent("click") as PointerEvent))).resolves.toBeUndefined()
        expect(mocks.update).toHaveBeenCalledOnce()
        expect(refresh).toHaveBeenCalledOnce()
        expect(RuntimeNotifier.info).toHaveBeenCalledTimes(fail ? 1 : 0)
        expect(console.warn).toHaveBeenCalledTimes(fail ? 1 : 0)
    })
}
