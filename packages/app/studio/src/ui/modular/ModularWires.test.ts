import {afterEach, expect, it, vi} from "vitest"
import {AnimationFrame} from "@opendaw/lib-dom"
import {ModuleAdapter, Modules} from "@opendaw/studio-adapters"
import {Terminable, Terminator} from "@opendaw/lib-std"
import {fixture, owners} from "./ModularTestFixture"
import {ModularWires} from "./ModularWires"
import type {Camera} from "./Camera"

vi.mock("@opendaw/lib-dom", async original => {
    const dom = await original<typeof import("@opendaw/lib-dom")>()
    return {...dom, Html: {...dom.Html, adoptStyleSheet: () => "wires", watchResize: () => ({terminate() {}})}}
})
const lifetimes: Terminator[] = []
afterEach(() => {lifetimes.splice(0).forEach(owner => owner.terminate()); owners.splice(0).forEach(owner => owner.terminate()); AnimationFrame.terminate(); vi.restoreAllMocks(); document.body.replaceChildren()})
const setup = () => {
    const f = fixture(), frames: Array<() => void> = []
    vi.spyOn(AnimationFrame, "once").mockImplementation(fn => {frames.push(fn)})
    const lifecycle = new Terminator(); lifetimes.push(lifecycle)
    const svg = ModularWires({lifecycle, environment: f.environment, camera: {} as Camera}) as SVGSVGElement
    const flush = () => frames.splice(0).forEach(fn => fn())
    return {...f, lifecycle, svg, flush, frames}
}
it.each(["edge", "endpoint", "view"])("ignores deferred drawing after removing %s", kind => {
    const f = setup(), edge = f.edge()
    if (kind === "edge") {f.editing.modify(() => edge.delete())}
    if (kind === "endpoint") {f.editing.modify(() => f.targets[0].delete())}
    if (kind === "view") {f.lifecycle.terminate()}
    expect(f.flush).not.toThrow()
    if (kind === "edge") {
        expect(f.svg.querySelectorAll("path")).toHaveLength(0)
        f.editing.undo(); f.flush()
        expect(f.svg.querySelector("path")?.getAttribute("d")).toMatch(/^M/)
    }
})
it("releases every module subscription and pending update when the view closes", () => {
    const f = fixture(), modules: ModuleAdapter[] = [Modules.adapterFor(f.adapters, f.targets[0])]
    const subscriptions: Array<ReturnType<typeof vi.fn>> = []
    const track = <T>(field: {subscribe(observer: (value: T) => void): Terminable}) => {
        const subscribe = field.subscribe.bind(field)
        vi.spyOn(field, "subscribe").mockImplementation(observer => {
            const subscription = subscribe(observer), terminate = vi.fn(() => subscription.terminate())
            subscriptions.push(terminate)
            return {terminate}
        })
    }
    modules.forEach(adapter => {track(adapter.attributes.x); track(adapter.attributes.y); track(adapter.attributes.collapsed)})
    const one = new Terminator(), two = new Terminator(); lifetimes.push(one, two)
    const svg1 = ModularWires({lifecycle: one, environment: f.environment, camera: {} as Camera}) as SVGSVGElement
    const svg2 = ModularWires({lifecycle: two, environment: f.environment, camera: {} as Camera}) as SVGSVGElement
    f.edge()
    one.terminate()
    expect(subscriptions.slice(0, 3).every(terminate => terminate.mock.calls.length === 1)).toBe(true)
    expect(subscriptions.slice(3).every(terminate => terminate.mock.calls.length === 0)).toBe(true)
    f.editing.modify(() => f.targets[0].attributes.x.setValue(42))
    two.terminate()
    expect(subscriptions.every(terminate => terminate.mock.calls.length === 1)).toBe(true)
    // Disposing an older view must not unregister a newer view's preview.
    expect(svg1).not.toBe(svg2)
})
