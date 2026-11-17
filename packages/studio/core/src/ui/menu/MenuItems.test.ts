import {expect, it} from "vitest"
import {MenuItem} from "./MenuItems"

it.each(["collector", "runtime"])("unwinds a failed %s generation and admits later permanent and runtime children", source => {
    const root = MenuItem.root()
    const permanent = MenuItem.default({label: "Permanent"})
    const partial = MenuItem.default({label: "Partial"})
    root.addMenuItem(permanent)
    const fail = () => {root.addMenuItem(partial); throw new Error("population failed")}
    const subscription = source === "collector" ? root.attach(collector => {
        collector.addItems(partial); throw new Error("population failed")
    }) : undefined
    if (source === "runtime") {root.setRuntimeChildrenProcedure(fail)}
    expect(() => root.collectChildren()).toThrow("population failed")
    subscription?.terminate()
    if (source === "runtime") {root.setRuntimeChildrenProcedure(() => {})}
    const later = MenuItem.default({label: "Later"})
    root.addMenuItem(later)
    expect(root.collectChildren()).toEqual([permanent, later])
    root.removeRuntimeChildren()
    const runtime = MenuItem.default({label: "Runtime"})
    root.setRuntimeChildrenProcedure(menu => menu.addMenuItem(runtime))
    expect(root.collectChildren()).toEqual([permanent, later, runtime])
    root.removeRuntimeChildren()
    root.clearRuntimeProcedure()
    expect(root.collectChildren()).toEqual([permanent, later])
})
