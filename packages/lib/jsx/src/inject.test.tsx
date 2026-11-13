import {describe, expect, it} from "vitest"
import {createElement} from "./create-element"
import {Inject} from "./inject"

describe("reusable injectors", () => {
    it("keeps every attribute key on every target until termination", () => {
        const attribute = Inject.attribute("initial")
        const first: HTMLDivElement = <div title={attribute} aria-label={attribute}/>
        const second: HTMLDivElement = <div title={attribute}/>
        expect(first.getAttribute("title")).toBe("initial")
        expect(first.getAttribute("aria-label")).toBe("initial")
        attribute.value = "updated"
        expect(first.getAttribute("title")).toBe("updated")
        expect(first.getAttribute("aria-label")).toBe("updated")
        expect(second.getAttribute("title")).toBe("updated")
        attribute.toggle("updated", "toggled")
        expect(first.getAttribute("title")).toBe("toggled")
        expect(first.getAttribute("aria-label")).toBe("toggled")
        attribute.terminate()
        attribute.terminate()
        attribute.value = "detached"
        expect(first.getAttribute("title")).toBe("toggled")
        expect(first.getAttribute("aria-label")).toBe("toggled")
        expect(second.getAttribute("title")).toBe("toggled")
        attribute.addTarget(first, "data-rebound")
        attribute.value = "rebound"
        expect(first.getAttribute("data-rebound")).toBe("rebound")
        expect(first.getAttribute("title")).toBe("toggled")
        expect(first.getAttribute("aria-label")).toBe("toggled")
    })

    it("owns equivalent class lists on actual HTML and SVG elements", () => {
        const classes = Inject.classList("initial", "shared")
        const html: HTMLDivElement = <div className={classes}/>
        const svg: SVGSVGElement = <svg className={classes}/>
        const expectClasses = (...expected: Array<string>) => {
            expect(Array.from(html.classList)).toEqual(expected)
            expect(Array.from(svg.classList)).toEqual(expected)
        }
        expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg")
        expectClasses("initial", "shared")
        classes.add("extra")
        classes.remove("initial")
        expectClasses("shared", "extra")
        classes.toggle("extra")
        classes.toggle("forced", true)
        classes.toggle("shared", false)
        expectClasses("forced")
        classes.terminate()
        classes.add("detached")
        classes.remove("forced")
        expectClasses("forced")
    })
})
