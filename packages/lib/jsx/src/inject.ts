import {isDefined, Option, Stringifiable, Terminable} from "@opendaw/lib-std"
import {WeakRefSet} from "./weak"

export namespace Inject {
    export const ref = <T>() => new Ref<T>()
    export const value = <T extends Stringifiable>(initialValue: T) => new Value<T>(initialValue)
    export const classList = (...initialClassNames: Array<string>) => new ClassList(initialClassNames)
    export const attribute = (initialAttributeValue: string) => new Attribute(initialAttributeValue)

    interface Injector<T> extends Terminable {addTarget(target: T, ...args: Array<unknown>): void}

    export class Ref<T> implements Injector<T> {
        #target: Option<T> = Option.None
        get(): T {return this.#target.unwrap("No target provided")}
        addTarget(target: T): void {this.#target = Option.wrap(target)}
        hasTarget(): boolean {return this.#target.nonEmpty()}
        terminate(): void {this.#target = Option.None}
    }

    export class Value<T extends Stringifiable = Stringifiable> implements Injector<Text> {
        readonly #targets = new WeakRefSet<Text>()

        #value: T

        constructor(value: T) {this.#value = value}

        get value(): T {return this.#value}
        set value(value: T) {
            if (this.#value === value) {return}
            this.#value = value
            this.#targets.forEach(text => {text.nodeValue = String(value)})
        }
        addTarget(text: Text): void {this.#targets.add(text)}
        terminate(): void {this.#targets.clear()}
    }

    export class ClassList implements Injector<Element> {
        readonly #targets: WeakRefSet<Element>
        readonly #classes: Set<string>

        constructor(classes: Array<string>) {
            this.#targets = new WeakRefSet<Element>()
            this.#classes = new Set<string>(classes)
        }

        add(className: string): void {
            this.#classes.add(className)
            this.#updateElements()
        }

        remove(className: string): void {
            this.#classes.delete(className)
            this.#updateElements()
        }

        toggle(className: string, force?: boolean): void {
            if (isDefined(force)) {
                if (force) {
                    this.#classes.add(className)
                } else {
                    this.#classes.delete(className)
                }
            } else {
                if (this.#classes.has(className)) {
                    this.#classes.delete(className)
                } else {
                    this.#classes.add(className)
                }
            }
            this.#updateElements()
        }

        addTarget(target: Element): void {
            this.#targets.add(target)
            this.#updateElement(target)
        }

        terminate(): void {this.#targets.clear()}

        #updateElements(): void {this.#targets.forEach(this.#updateElement)}

        readonly #updateElement: (element: Element) => void =
            (element: Element) => {element.setAttribute("class", Array.from(this.#classes).join(" "))}
    }

    export class Attribute implements Injector<Element> {
        readonly #targets: WeakRefSet<Element>
        #keys: WeakMap<Element, Set<string>>

        #value: string

        constructor(value: string) {
            this.#targets = new WeakRefSet<Element>()
            this.#keys = new WeakMap<Element, Set<string>>()
            this.#value = value
        }

        get value(): string {return this.#value}
        set value(value: string) {
            if (this.#value === value) {return}
            this.#value = value
            this.#updateElements()
        }

        toggle(expected: string, alternative: string): void {
            this.value = this.value === expected ? alternative : expected
        }

        addTarget(target: Element, key: string): void {
            let keys = this.#keys.get(target)
            if (keys === undefined) {
                keys = new Set<string>()
                this.#keys.set(target, keys)
                this.#targets.add(target)
            }
            keys.add(key)
            this.#updateElement(target)
        }

        terminate(): void {
            this.#targets.clear()
            this.#keys = new WeakMap<Element, Set<string>>()
        }

        #updateElements(): void {this.#targets.forEach(this.#updateElement)}

        readonly #updateElement: (element: Element) => void = (element: Element) => {
            this.#keys.get(element)?.forEach(key => element.setAttribute(key, this.#value))
        }
    }
}