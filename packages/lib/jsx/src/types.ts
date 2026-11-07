import {Procedure} from "@opendaw/lib-std"
import {Inject} from "./inject"

export type DomElement = HTMLElement | SVGElement
export type JsxValue = null | undefined | boolean | string | number | DomElement | Array<JsxValue>
export type CSSVars = Record<`--${string}`, string>

// These are all utility type to let jsx understand usual HTML and SVG elements.
//
type AttributeMap = {
    className?: string | Inject.ClassList
    style?: Partial<CSSStyleDeclaration> | CSSVars
}

type ExtractProperties<T extends Element> = Partial<{
    [K in keyof T]:
    K extends keyof AttributeMap ? AttributeMap[K] :
        K extends keyof GlobalEventHandlers ? GlobalEventHandlers[K] :
            T[K] extends (...args: never[]) => unknown ? never :
                (T[K] extends SVGAnimatedBoolean ? boolean | string :
                    T[K] extends SVGAnimatedAngle ? number | string :
                        T[K] extends SVGAnimatedLength ? number | string :
                            T[K] extends number ? number | string :
                                T[K] extends boolean ? boolean | string :
                                    string) | Inject.Attribute
}> & {
    ref?: Inject.Ref<T>
    onInit?: Procedure<T> // runs immediately after the element is created
    onConnect?: Procedure<T> // runs immediately after the element is connected to the DOM (caution, it waits forever!)
} & Record<string, unknown>

declare global {
    namespace JSX {
        // noinspection JSUnusedGlobalSymbols
        type IntrinsicElements =
            & { [K in keyof Omit<SVGElementTagNameMap, "a">]: ExtractProperties<Omit<SVGElementTagNameMap, "a">[K]> }
            & { [K in keyof Omit<HTMLElementTagNameMap, "a">]: ExtractProperties<Omit<HTMLElementTagNameMap, "a">[K]> }
            // HTML and SVG anchors share a tag; accept either element's properties.
            & { a: ExtractProperties<HTMLAnchorElement | SVGAElement> }
    }
}