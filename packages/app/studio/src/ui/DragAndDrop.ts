import {
    Arrays,
    Client,
    InaccessibleProperty,
    int,
    isDefined,
    Nullable,
    Option,
    Provider,
    Terminable
} from "@opendaw/lib-std"
import {AnyDragData, DragFile} from "@/ui/AnyDragData"
import {Events} from "@opendaw/lib-dom"

export namespace DragAndDrop {
    let dragging: Option<AnyDragData> = Option.None
    let activeSource: Nullable<symbol> = null
    let retireActiveSource: Nullable<() => void> = null

    const hasFiles = (event: DragEvent): boolean => {
        const type = event.dataTransfer?.types?.at(0)
        return type === "Files" || type === "application/x-moz-file"
    }

    const extractFiles = (event: DragEvent): ReadonlyArray<File> => {
        const dataTransfer = event.dataTransfer
        if (!isDefined(dataTransfer)) {return Arrays.empty()}
        if (hasFiles(event)) {
            return Array.from(dataTransfer.files)
        }
        return Arrays.empty()
    }

    export const installSource = (element: HTMLElement,
                                  provider: Provider<AnyDragData>,
                                  classReceiver?: Element,
                                  dragImage?: Provider<HTMLElement>): Terminable => {
        classReceiver ??= element
        element.draggable = true
        let activeImage: Nullable<HTMLElement> = null
        let token: Nullable<symbol> = null
        let retired = false
        const cleanup = () => {
            if (token === null) {return}
            if (activeSource === token) {
                dragging = Option.None
                activeSource = null
                retireActiveSource = null
            }
            token = null
            classReceiver.classList.remove("dragging")
            activeImage?.remove()
            activeImage = null
        }
        const listeners = Terminable.many(
            Events.subscribe(element, "dragend", cleanup),
            Events.subscribe(element, "dragstart", (event: DragEvent) => {
                if (retired) {return}
                const dataTransfer = event.dataTransfer
                if (!isDefined(dataTransfer)) {return}
                retireActiveSource?.()
                token = Symbol("drag")
                activeSource = token
                retireActiveSource = cleanup
                try {
                    dataTransfer.setData("application/json", "{custom: true}")
                    dataTransfer.effectAllowed = "copyMove"
                    classReceiver.classList.add("dragging")
                    dragging = Option.wrap(provider())
                    if (isDefined(dragImage)) {
                        const ghost = dragImage()
                        activeImage = ghost
                        ghost.style.position = "fixed"
                        ghost.style.top = "-9999px"
                        ghost.style.left = "-9999px"
                        ghost.style.pointerEvents = "none"
                        element.ownerDocument.body.appendChild(ghost)
                        dataTransfer.setDragImage(ghost, 0, 0)
                    }
                } catch (error) {
                    cleanup()
                    event.preventDefault()
                    throw error
                }
            })
        )
        return {terminate: () => {
            if (retired) {return}
            retired = true
            listeners.terminate()
            cleanup()
        }}
    }

    export interface Process {
        drag(event: DragEvent, dragData: AnyDragData): boolean
        drop(event: DragEvent, dragData: AnyDragData): void
        enter(allowDrop: boolean): void
        leave(): void
    }

    export const installTarget = (element: HTMLElement, process: Process): Terminable => {
        let count: int = 0 | 0
        return Terminable.many(
            Events.subscribe(element, "dragenter", (event: DragEvent) => {
                if (count++ === 0) {
                    process.enter(dragging.match({
                        none: () => hasFiles(event) && process.drag(event, {
                            type: "file",
                            file: InaccessibleProperty("Cannot access file while dragging")
                        }),
                        some: data => process.drag(event, data)
                    }))
                }
            }),
            Events.subscribe(element, "dragover", (event: DragEvent) => {
                const dataTransfer = event.dataTransfer
                if (!isDefined(dataTransfer)) {return}
                dragging.match({
                    none: () => {
                        if (hasFiles(event) && process.drag(event, {
                            type: "file",
                            file: InaccessibleProperty("Cannot access file while dragging")
                        })) {
                            event.preventDefault()
                            dataTransfer.dropEffect = "copy"
                        }
                    },
                    some: data => {
                        if (process.drag(event, data)) {
                            event.preventDefault()
                            dataTransfer.dropEffect = event.altKey || data.copy === true ? "copy" : "move"
                        }
                    }
                })
            }),
            Events.subscribe(element, "dragleave", (_event: DragEvent) => {
                if (--count === 0) {process.leave()}
            }),
            Events.subscribe(element, "drop", (event: DragEvent) => {
                dragging.match({
                    none: () => {
                        const files = extractFiles(event)
                        if (files.length === 0) {return}
                        const data: DragFile = {type: "file", file: files[0]}
                        if (process.drag(event, data)) {
                            event.preventDefault()
                            process.drop(event, data)
                            dragging = Option.None
                        }
                    },
                    some: data => {
                        if (process.drag(event, data)) {
                            event.preventDefault()
                            process.drop(event, data)
                            dragging = Option.None
                        }
                    }
                })
                if (count > 0) {
                    process.leave()
                    count = 0
                }
            }),
            Events.subscribe(element, "dragend", (_event: DragEvent) => count = 0, {capture: true})
        )
    }

    export const findInsertLocation = ({clientX}: Client, parent: Element, limit?: [int, int]): [int, Nullable<Element>] => {
        const elements = Array.from(parent.querySelectorAll("[data-drag]"))
        const [minIndex, maxIndex] = limit ?? [0, elements.length]
        let index: int = minIndex
        for (;;) {
            const child = elements[index] ?? null
            if (index >= maxIndex) {return [index, child]}
            const rect = child.getBoundingClientRect()
            const center = (rect.left + rect.right) / 2
            if (clientX < center) {return [index, child]}
            index++
        }
    }
}