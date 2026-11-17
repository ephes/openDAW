import {afterEach, expect, it, vi} from "vitest"
import {MenuItem} from "../../../../../studio/core/src/ui/menu/MenuItems"
import {Menu} from "./Menu"

vi.mock("@opendaw/studio-core", () => ({}))
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
vi.mock("@/ui/components/Icon.tsx", () => ({Icon: () => document.createElement("span")}))
vi.mock("@/ui/surface/Surface.tsx", () => ({Surface: {get: () => ({owner: window})}}))
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks()})

const fixture = () => {
    const action = vi.fn()
    const menu = Menu.create(MenuItem.root().addMenuItem(
        MenuItem.default({label: "Delete"}).setTriggerProcedure(action)))
    document.body.append(menu.element)
    const item = menu.element.querySelector<HTMLElement>(".item")!
    return {menu, action, release: (button = 0) => {
        const event = new MouseEvent("pointerup", {button, cancelable: true})
        item.onpointerup!(event as PointerEvent)
        return event
    }}
}

it.each([-10000, 10000])("uses elapsed time at 249/250ms despite wall clock jump %i", jump => {
    let elapsed = 1000
    vi.spyOn(performance, "now").mockImplementation(() => elapsed)
    const wall = vi.spyOn(Date, "now").mockReturnValue(1000)
    const f = fixture()
    wall.mockReturnValue(1000 + jump)
    elapsed = 1249; f.release(); expect(f.action).not.toHaveBeenCalled()
    elapsed = 1250; f.release(); expect(f.action).toHaveBeenCalledTimes(1)
})

it.each([1, 2])("ignores button %i without preventing or closing", button => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0)
    const wall = vi.spyOn(Date, "now").mockReturnValue(0)
    const f = fixture()
    now.mockReturnValue(250); wall.mockReturnValue(250)
    expect(f.release(button).defaultPrevented).toBe(false)
    expect(f.menu.element.isConnected).toBe(true)
    expect(f.action).not.toHaveBeenCalled()
    expect(f.release().defaultPrevented).toBe(true)
    expect(f.action).toHaveBeenCalledTimes(1)
})

it("gives a child menu its own elapsed guard and preserves parent navigation", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0)
    vi.spyOn(Date, "now").mockReturnValue(0)
    const action = vi.fn()
    const parentAction = vi.fn()
    const menu = Menu.create(MenuItem.root().addMenuItem(MenuItem.default({label: "More"})
        .setTriggerProcedure(parentAction).addMenuItem(MenuItem.default({label: "Delete"}).setTriggerProcedure(action))))
    document.body.append(menu.element)
    now.mockReturnValue(300)
    const parent = menu.element.querySelector<HTMLElement>(".item")!
    parent.onpointerenter!(new MouseEvent("pointerenter") as PointerEvent)
    parent.onpointerup!(new MouseEvent("pointerup", {button: 2}) as PointerEvent)
    const child = menu.element.querySelector("nav")!.querySelector<HTMLElement>(".item")!
    now.mockReturnValue(549); child.onpointerup!(new MouseEvent("pointerup") as PointerEvent)
    expect(action).not.toHaveBeenCalled()
    now.mockReturnValue(550); child.onpointerup!(new MouseEvent("pointerup") as PointerEvent)
    expect(action).toHaveBeenCalledTimes(1)
    expect(parentAction).not.toHaveBeenCalled()
})
