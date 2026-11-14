import DOMPurify from "dompurify"
import {asDefined, assert, Color, int, isDefined, panic, Rect, RGBA, Subscription} from "@opendaw/lib-std"

export namespace Html {
    export const parse = (source: string): HTMLOrSVGElement & Element => {
        const template = document.createElement("div")
        template.innerHTML = source
        if (template.childElementCount !== 1) {
            return panic(`Source html has more than one root elements: '${source}'`)
        }
        const child = template.firstChild
        return child instanceof HTMLElement || child instanceof SVGSVGElement
            ? child
            : panic(`Cannot parse to HTMLOrSVGElement from '${source}'`)
    }

    export const empty = (element: Element): void => {while (element.firstChild !== null) {element.firstChild.remove()}}

    export const query = <E extends Element>(selectors: string, parent: ParentNode = document): E =>
        asDefined(parent.querySelector(selectors)) as E

    export const queryAll = <E extends Element>(selectors: string, parent: ParentNode = document): ReadonlyArray<E> =>
        Array.from(parent.querySelectorAll(selectors))

    // Documentation markup only: no styles, embedded documents, forms or executable SVG.
    const markupPolicy = {
        ALLOWED_TAGS: ["div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
            "a", "img", "strong", "em", "b", "i", "u", "s", "del", "sub", "sup", "code", "pre",
            "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot",
            "tr", "th", "td", "caption", "figure", "figcaption", "details", "summary",
            "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "title", "desc"],
        ALLOWED_ATTR: ["id", "class", "title", "href", "src", "alt", "width", "height", "colspan", "rowspan",
            "scope", "start", "reversed", "open", "viewBox", "d", "fill", "stroke", "stroke-width",
            "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "transform"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: true
    }

    /** Sanitize the root and descendants in place; unsupported root elements are refused. */
    export const sanitize = (element: Element): void => {
        DOMPurify.sanitize(element, {...markupPolicy, IN_PLACE: true})
    }

    /** Parse untrusted documentation without first assigning raw markup to a live DOM element. */
    export const sanitizeMarkup = (source: string): DocumentFragment =>
        DOMPurify.sanitize(source, {...markupPolicy, RETURN_DOM_FRAGMENT: true})

    export const nextID = (() => {
        let id: int = 0 | 0
        return (): string => (++id).toString(16).padStart(4, "0")
    })()

    export const adoptStyleSheet = (classDefinition: string, prefix?: string): string => {
        assert(classDefinition.includes("component"), `No 'component' found in: ${classDefinition}`)
        const className = `${prefix ?? "C"}${Html.nextID()}`
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(classDefinition.replaceAll("component", `.${className}`))
        if (sheet.cssRules.length === 0) {
            return panic(`No cssRules found in: ${classDefinition}`)
        }
        document.adoptedStyleSheets.push(sheet)
        return className
    }

    // Allows conditional accumulation of classNames
    export const buildClassList = (...input: Array<string | false | undefined>) =>
        input.filter(x => x !== false && x !== undefined).join(" ")

    export const readCssVarColor = (...cssValues: Array<string>): Array<RGBA> => {
        const element = document.createElement("div")
        document.body.appendChild(element)
        const colors: Array<RGBA> = cssValues.map(value => {
            element.style.color = value
            return Color.parseCssRgbOrRgba(getComputedStyle(element).color)
        })
        element.remove()
        return colors
    }

    export const watchResize = (target: Element,
                                callback: (entry: ResizeObserverEntry, observer: ResizeObserver) => void,
                                options?: ResizeObserverOptions): Subscription => {
        const observer = new ResizeObserver(([first], observer) => callback(first, observer))
        observer.observe(target, options)
        return {terminate: () => observer.disconnect()}
    }

    export const watchIntersection = (target: Element,
                                      callback: IntersectionObserverCallback,
                                      options?: IntersectionObserverInit): Subscription => {
        const observer = new IntersectionObserver(callback, options)
        observer.observe(target)
        return {terminate: () => observer.disconnect()}
    }

    // handles cases like 'display: contents', where the bounding box is always empty, although the children have dimensions
    export const secureBoundingBox = (element: Element): DOMRect => {
        const elemRect = element.getBoundingClientRect()
        if (!Rect.isEmpty(elemRect)) {
            return elemRect
        }
        for (const child of element.children) {
            Rect.union(elemRect, secureBoundingBox(child))
        }
        return elemRect
    }

    export const unfocus = (owner: Window = self) => {
        const element = owner.document.activeElement
        if (element !== null && "blur" in element && typeof element.blur === "function") {
            element.blur()
        }
    }

    export const selectContent = (element: HTMLElement) => {
        const range = document.createRange()
        const selection = window.getSelection()
        if (isDefined(selection)) {
            range.selectNodeContents(element)
            selection.removeAllRanges()
            selection.addRange(range)
        }
    }

    export const unselectContent = (element: HTMLElement) => {
        const selection = window.getSelection()
        if (!isDefined(selection) || selection.rangeCount === 0) {return}
        if (element.contains(selection.getRangeAt(0).commonAncestorContainer)) {
            selection.removeAllRanges()
        }
    }

    export const limitChars = <T extends HTMLElement, K extends keyof T & string>(element: T, property: K, limit: int) => {
        if (!(property in element)) return panic(`${property} not found in ${element}`)
        if (typeof element[property] !== "string") return panic(`${property} in ${element} is not a string`)
        if (element[property].length > limit) {
            element[property] = element[property].substring(0, limit) as T[K]
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                element.setSelectionRange(limit, limit)
            } else {
                const document = element.ownerDocument
                const range = document.createRange()
                const selection = document.defaultView?.getSelection()
                if (!isDefined(selection)) {return}
                range.selectNodeContents(element)
                range.collapse(false)
                selection.removeAllRanges()
                selection.addRange(range)
            }
        }
    }

    export const EmptyGif = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as const
}

