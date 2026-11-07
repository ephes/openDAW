import {asDefined, assert, Class, int, isDefined, Maybe, panic, WeakMaps} from "@opendaw/lib-std"

export namespace Xml {
    type Meta =
        | { type: "class", name: string, clazz: Class<unknown> }
        | { type: "element", name: string, clazz: Class<unknown> }
        | { type: "element-ref", clazz: Class<unknown>, name: string | null }
        | { type: "attribute", name: string, validator?: AttributeValidator<unknown> }
    type MetaMap = Map<PropertyKey, Meta>

    const ClassMap = new Map<string, Class<unknown>>()
    const MetaClassMap = new WeakMap<Class<unknown>, MetaMap>()

    export const Declaration = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"

    export interface AttributeValidator<T> {
        required: boolean
        parse(value: string | T): T
    }

    export const StringRequired: AttributeValidator<string> = {required: true, parse: value => value}
    export const StringOptional: AttributeValidator<string> = {required: false, parse: value => value}

    const parseBoolean = (value: string | boolean): boolean => {
        if (typeof value === "boolean") {return value}
        switch (value.trim().toLowerCase()) {
            case "true":
            case "1": return true
            case "false":
            case "0": return false
            default: return panic("Expected an XML boolean literal")
        }
    }

    const parseNumber = (value: string | number): number => {
        if (typeof value === "string" && value.trim().length === 0) {
            return panic("Expected a nonblank XML number")
        }
        const number = Number(value)
        return Number.isFinite(number) ? number : panic("Expected a finite XML number")
    }

    export const BoolRequired: AttributeValidator<boolean> = {required: true, parse: parseBoolean}
    export const BoolOptional: AttributeValidator<boolean> = {required: false, parse: parseBoolean}
    export const NumberRequired: AttributeValidator<number> = {required: true, parse: parseNumber}
    export const NumberOptional: AttributeValidator<number> = {required: false, parse: parseNumber}

    export const Attribute = (name: string, validator?: AttributeValidator<unknown>): PropertyDecorator =>
        (target: object, propertyKey: PropertyKey) =>
            WeakMaps.createIfAbsent(MetaClassMap, target.constructor, () => new Map<PropertyKey, Meta>())
                .set(propertyKey, {type: "attribute", name, validator})

    export const Element = (name: string, clazz: Class<unknown>): PropertyDecorator =>
        (target: object, propertyKey: PropertyKey) =>
            WeakMaps.createIfAbsent(MetaClassMap, target.constructor, () => new Map<PropertyKey, Meta>())
                .set(propertyKey, {type: "element", name, clazz})

    export const ElementRef = (clazz: Class<unknown>, nodeName?: string): PropertyDecorator =>
        (target: object, propertyKey: PropertyKey) =>
            WeakMaps.createIfAbsent(MetaClassMap, target.constructor, () => new Map<PropertyKey, Meta>())
                .set(propertyKey, {type: "element-ref", clazz, name: nodeName ?? null})

    export const Class = (tagName: string): ClassDecorator => {
        return (constructor: Class<unknown>): void => {
            assert(!ClassMap.has(tagName), `${tagName} is already registered as a class.`)
            ClassMap.set(tagName, constructor)
            WeakMaps.createIfAbsent(MetaClassMap, constructor, () => new Map<PropertyKey, Meta>())
                .set("class", {type: "class", name: tagName, clazz: constructor})
        }
    }

    export const element = <T extends NonNullable<unknown>>(object: T, clazz: Class<T>): T => {
        assert(clazz.length === 0, "constructor cannot have arguments")
        return Object.freeze(Object.create(clazz.prototype, Object.fromEntries(
            Object.entries(object).map(([key, value]) => [key, {value, enumerable: true}]))))
    }

    export const toElement = (tagName: string, object: object): Element => {
        const doc = document.implementation.createDocument(null, null)
        const getClassTagName = (constructor: Class<unknown>): string => {
            const tagMeta = MetaClassMap.get(constructor)?.get("class")
            if (tagMeta?.type === "class") {
                return tagMeta.name
            }
            return panic(`Missing @Xml.Class decorator on ${constructor.name}`)
        }

        const visit = (tagName: string, object: object): Element => {
            const element = doc.createElement(tagName)
            Object.entries(object).forEach(([key, value]) => {
                if (!isDefined(value)) return
                const meta = resolveMeta(object.constructor, key)
                if (!isDefined(meta)) return
                if (meta.type === "attribute") {
                    assert(typeof value === "number" || typeof value === "string" || typeof value === "boolean",
                        `Attribute value must be a primitive for ${key} = ${value}`)
                    meta.validator?.parse?.call(null, value)
                    element.setAttribute(meta.name, String(value))
                } else if (meta.type === "element") {
                    if (Array.isArray(value)) {
                        if (value.length === 0) return
                        const wrapper = doc.createElement(meta.name)
                        value.forEach(item => {
                            if (!isDefined(item)) return
                            const itemTagName = getClassTagName(item.constructor)
                            wrapper.appendChild(visit(itemTagName, item))
                        })
                        element.appendChild(wrapper)
                    } else if (typeof value === "string") {
                        const child = doc.createElement(meta.name)
                        child.textContent = value
                        element.appendChild(child)
                    } else {
                        element.appendChild(visit(meta.name, value as Record<string, unknown>))
                    }
                } else if (meta.type === "element-ref") {
                    if (!Array.isArray(value)) return panic("ElementRef must be an array of items.")
                    if (value.length === 0) return
                    const validItems = value.filter(isDefined)
                    if (validItems.length === 0) return

                    if (meta.name) {
                        const firstItemTagName = getClassTagName(validItems[0].constructor)
                        if (meta.name === firstItemTagName) {
                            // Direct elements case
                            validItems.forEach(item => element.appendChild(visit(meta.name!, item)))
                        } else {
                            // Wrapper case
                            const wrapper = doc.createElement(meta.name)
                            validItems.forEach(item => wrapper.appendChild(visit(getClassTagName(item.constructor), item)))
                            element.appendChild(wrapper)
                        }
                    } else {
                        // No meta.name, use class tag names directly
                        validItems.forEach(item => element.appendChild(visit(getClassTagName(item.constructor), item)))
                    }
                }
            })
            return element
        }

        return visit(tagName, object)
    }

    export const pretty = (element: Element): string => {
        const PADDING = "  " // 2 spaces
        const reg = /(>)(<)(\/*)/g
        const xml = new XMLSerializer()
            .serializeToString(element)
            .replace(reg, "$1\n$2$3")
        let pad: int = 0
        return xml.split("\n").map(line => {
            let indent: int = 0
            if (line.match(/.+<\/\w[^>]*>$/)) {
                indent = 0
            } else if (line.match(/^<\/\w/) && pad > 0) {
                pad -= 1
            } else if (line.match(/^<\w[^>]*[^/]>.*$/)) {
                indent = 1
            } else {
                indent = 0
            }
            const padding = PADDING.repeat(pad)
            pad += indent
            return padding + line
        }).join("\n")
    }

    export const resolveMeta = (target: Class<unknown>, propertyKey: PropertyKey): Maybe<Meta> =>
        collectMeta(target)?.get(propertyKey)

    export const collectMeta = (target: Class<unknown>): Maybe<MetaMap> => {
        const metaMap: MetaMap = new Map<PropertyKey, Meta>()
        while (isDefined(target)) {
            const meta = MetaClassMap.get(target)
            if (isDefined(meta)) {
                for (const [key, value] of meta.entries()) {
                    metaMap.set(key, value)
                }
            }
            target = Object.getPrototypeOf(target)
        }
        return metaMap.size > 0 ? metaMap : undefined
    }

    const findChildByName = (parent: Element, name: string): Element | null => {
        for (const child of parent.children) {
            if (child.nodeName === name) {
                return child
            }
        }
        return null
    }

    const findAllChildrenByName = (parent: Element, name: string): Element[] => {
        const result: Element[] = []
        for (const child of parent.children) {
            if (child.nodeName === name) {
                result.push(child)
            }
        }
        return result
    }

    export const parse = <T extends NonNullable<unknown>>(xml: string, clazz: Class<T>): T => {
        const deserialize = <T extends NonNullable<unknown>>(element: Element, clazz: Class<unknown>): T => {
            const instance = Object.create(clazz.prototype as object) as T
            const classMeta = asDefined(Xml.collectMeta(clazz))
            const classMetaDict = Array.from(classMeta).reduce((acc: Record<PropertyKey, Meta>, [key, metaInfo]) => {
                acc[key] = metaInfo
                return acc
            }, {}) as Record<keyof T, Meta>
            const keys = [...classMeta.keys()].filter(key => key !== "class") as Array<keyof T>

            for (const key of keys) {
                const meta: Meta = classMetaDict[key]

                if (meta.type === "attribute") {
                    const attribute = element.getAttribute(meta.name)
                    if (isDefined(attribute)) {
                        let value: unknown
                        try {
                            value = meta.validator?.parse?.call(null, attribute) ?? attribute
                        } catch (cause) {
                            throw new Error(`Invalid XML attribute '${meta.name}'`, {cause})
                        }
                        Object.defineProperty(instance, key, {value, enumerable: true})
                    } else {
                        meta.validator?.required && panic(`Missing attribute '${meta.name}'`)
                        Object.defineProperty(instance, key, {value: undefined, enumerable: true})
                    }
                } else if (meta.type === "element") {
                    const {name, clazz: elementClazz} = meta
                    if (elementClazz === Array) {
                        const wrapperElement = findChildByName(element, name)
                        if (wrapperElement) {
                            const items = Array.from(wrapperElement.children).map(child => {
                                const clazz = ClassMap.get(child.nodeName)
                                if (!clazz) {
                                    console.warn(`Could not find class for '${child.nodeName}', skipping`)
                                    return null
                                }
                                return deserialize(child, clazz)
                            }).filter(item => item !== null)
                            Object.defineProperty(instance, key, {value: items, enumerable: true})
                        } else {
                            Object.defineProperty(instance, key, {value: [], enumerable: true})
                        }
                    } else if (elementClazz === String) {
                        const textElement = findChildByName(element, name)
                        const textContent = textElement?.textContent
                        Object.defineProperty(instance, key, {value: textContent, enumerable: true})
                    } else {
                        const child = findChildByName(element, name)
                        if (child) {
                            Object.defineProperty(instance, key, {
                                value: deserialize(child, elementClazz),
                                enumerable: true
                            })
                        } else {
                            Object.defineProperty(instance, key, {value: undefined, enumerable: true})
                        }
                    }

                } else if (meta.type === "element-ref") {
                    if (meta.name) {
                        const directElements = findAllChildrenByName(element, meta.name)
                        if (directElements.length > 0 && directElements[0].children.length === 0) {
                            // Direct elements case
                            const items = directElements.map(child => {
                                const clazz = ClassMap.get(child.nodeName)
                                if (!clazz) return null
                                return deserialize(child, clazz)
                            }).filter(item => item !== null)
                            Object.defineProperty(instance, key, {value: items, enumerable: true})
                        } else {
                            // Wrapper case
                            const wrapperElement = findChildByName(element, meta.name)
                            if (wrapperElement && wrapperElement.children.length > 0) {
                                const items = Array.from(wrapperElement.children).map(child => {
                                    const clazz = ClassMap.get(child.nodeName)
                                    if (!clazz) return null
                                    if (!(clazz === meta.clazz || clazz.prototype instanceof meta.clazz)) {
                                        return null
                                    }
                                    return deserialize(child, clazz)
                                }).filter(item => item !== null)
                                Object.defineProperty(instance, key, {value: items, enumerable: true})
                            } else {
                                Object.defineProperty(instance, key, {value: [], enumerable: true})
                            }
                        }
                    } else {
                        // No meta.name, collect all matching children directly
                        const items = Array.from(element.children).map(child => {
                            const clazz = ClassMap.get(child.nodeName)
                            if (!clazz) return null
                            if (!(clazz === meta.clazz || clazz.prototype instanceof meta.clazz)) {
                                return null
                            }
                            return deserialize(child, clazz)
                        }).filter(item => item !== null)
                        Object.defineProperty(instance, key, {value: items, enumerable: true})
                    }
                }
            }
            return instance
        }
        const document = new DOMParser().parseFromString(xml.trimStart(), "application/xml")
        const root = document.documentElement
        // Chromium inserts an XHTML diagnostic under the partially parsed root.
        const parserErrorNamespaces = [
            "http://www.mozilla.org/newlayout/xml/parsererror.xml",
            "http://www.w3.org/1999/xhtml"
        ]
        if (!root || parserErrorNamespaces.some(namespace =>
            document.getElementsByTagNameNS(namespace, "parsererror").length > 0)) {
            return panic("Invalid XML document")
        }
        const rootMeta = MetaClassMap.get(clazz)?.get("class")
        if (rootMeta?.type !== "class") {return panic("Missing @Xml.Class decorator on root schema")}
        if (root.nodeName !== rootMeta.name) {return panic(`Expected XML root '${rootMeta.name}'`)}
        return deserialize(root, clazz)
    }
}