import {Client, Option, Subscription, Terminable} from "@opendaw/lib-std"
import {Clipboard, Events, ReservedShortcuts} from "@opendaw/lib-dom"
import {CLIPBOARD_MAX_BYTES, CLIPBOARD_MAX_TEXT_LENGTH} from "./ClipboardLimits"
import {ContextMenu} from "./ContextMenu"
import {MenuItem} from "../menu/MenuItems"
import {StudioPreferences} from "../../StudioPreferences"

const CLIPBOARD_HEADER = "OPENDAW"
const CLIPBOARD_VERSION = 2

export type ClipboardEntry<T extends string = string> = {
    readonly type: T
    readonly data: ArrayBufferLike
}

export interface ClipboardHandler<E extends ClipboardEntry> {
    canCopy(client: Client): boolean
    canCut(client: Client): boolean
    canPaste(entry: ClipboardEntry, client: Client): boolean
    copy(): Option<E>
    cut(): Option<E>
    paste(entry: ClipboardEntry): void
}

export namespace ClipboardManager {
    type AnyEntry = ClipboardEntry

    let fallbackEntry: Option<AnyEntry> = Option.None

    const encode = (entry: AnyEntry): string => {
        const bytes = new Uint8Array(entry.data)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) {binary += String.fromCharCode(bytes[i])}
        return `${CLIPBOARD_HEADER}:${CLIPBOARD_VERSION}:${entry.type}:${btoa(binary)}`
    }

    const decode = (text: string): Option<AnyEntry> => {
        // Check the total encoded size before slicing or invoking the decoder.
        const prefix = `${CLIPBOARD_HEADER}:${CLIPBOARD_VERSION}:`
        if (text.length > CLIPBOARD_MAX_TEXT_LENGTH || !text.startsWith(prefix)) {
            return Option.None
        }
        const typeStart = prefix.length
        const separator = text.indexOf(":", typeStart)
        if (separator <= typeStart || separator - typeStart > 64) {return Option.None}
        const base64 = text.slice(separator + 1)
        const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
        const decodedLength = base64.length / 4 * 3 - padding
        if (base64.length % 4 !== 0 || decodedLength > CLIPBOARD_MAX_BYTES ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {return Option.None}
        return Option.tryCatch(() => {
            const type = text.slice(typeStart, separator)
            const binary = atob(base64)
            if (binary.length !== decodedLength) {throw new Error("Invalid clipboard size")}
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {bytes[i] = binary.charCodeAt(i)}
            return {type, data: bytes.buffer} as AnyEntry
        })
    }

    // Invalid native envelopes must not replay an unrelated fallback.
    const readEntry = (text: string): Option<AnyEntry> => {
        const entry = decode(text)
        if (entry.nonEmpty() || text.length > CLIPBOARD_MAX_TEXT_LENGTH || text.startsWith(CLIPBOARD_HEADER + ":")) {
            return entry
        }
        return fallbackEntry
    }

    export const install = <E extends AnyEntry>(element: HTMLElement, handler: ClipboardHandler<E>): Subscription => {
        const noClient: Client = {clientX: 0, clientY: 0}
        let installed = true
        const writeEntry = (entry: E): void => {
            fallbackEntry = Option.wrap(entry)
            Clipboard.writeText(encode(entry))
        }
        const performCopy = (): boolean => {
            if (!installed || !handler.canCopy(noClient)) {return false}
            const entry = handler.copy()
            entry.ifSome(writeEntry)
            return entry.nonEmpty()
        }
        const performCut = (): boolean => {
            if (!installed || !handler.canCut(noClient)) {return false}
            const entry = handler.cut()
            entry.ifSome(writeEntry)
            return entry.nonEmpty()
        }
        const performPaste = async () => {
            if (!installed) {return}
            let entry: Option<AnyEntry>
            try {
                const rawText = await Clipboard.readText()
                entry = Option.wrap(rawText).flatMap(readEntry)
            } catch (_error) {
                entry = fallbackEntry
            }
            // The owner may have been uninstalled while the clipboard read was pending.
            if (!installed) {return}
            // Handler failures propagate to the existing unhandled-rejection error path.
            entry.ifSome(entry => {
                if (handler.canPaste(entry, noClient)) {handler.paste(entry)}
            })
        }
        return Terminable.many(
            Terminable.create(() => installed = false),
            Events.subscribe(element, "copy", (event: ClipboardEvent) => {
                if (Events.isTextInput(document.activeElement)) {return}
                if (!handler.canCopy(noClient)) {return}
                handler.copy().ifSome(entry => {
                    event.preventDefault()
                    event.stopPropagation()
                    const encoded = encode(entry)
                    fallbackEntry = Option.wrap(entry)
                    event.clipboardData?.setData("text/plain", encoded)
                })
            }),
            Events.subscribe(element, "cut", (event: ClipboardEvent) => {
                if (Events.isTextInput(document.activeElement)) {return}
                if (!handler.canCut(noClient)) {return}
                handler.cut().ifSome(entry => {
                    event.preventDefault()
                    event.stopPropagation()
                    const encoded = encode(entry)
                    fallbackEntry = Option.wrap(entry)
                    event.clipboardData?.setData("text/plain", encoded)
                })
            }),
            Events.subscribe(document, "paste", (event: ClipboardEvent) => {
                if (Events.isTextInput(document.activeElement)) {return}
                if (!element.contains(document.activeElement) && document.activeElement !== document.body) {return}
                const text = event.clipboardData?.getData("text/plain") ?? ""
                const entry = readEntry(text)
                if (entry.nonEmpty()) {
                    if (!handler.canPaste(entry.unwrap(), noClient)) {return}
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    handler.paste(entry.unwrap())
                }
            }),
            Events.subscribe(document, "keydown", (event: KeyboardEvent) => {
                if (Events.isTextInput(document.activeElement)) {return}
                if (!element.contains(document.activeElement) && document.activeElement !== document.body) {return}
                const isMod = event.metaKey || event.ctrlKey
                if (!isMod || event.shiftKey || event.altKey) {return}
                if (event.key === "c") {
                    if (performCopy()) {
                        event.preventDefault()
                        event.stopImmediatePropagation()
                    }
                } else if (event.key === "x") {
                    if (performCut()) {
                        event.preventDefault()
                        event.stopImmediatePropagation()
                    }
                }
            }),
            ContextMenu.subscribe(element, async collector => {
                if (!StudioPreferences.settings.editing["show-clipboard-menu"]) {return}
                const {client} = collector
                const text = await Option.async(Clipboard.readText())
                if (!installed) {return}
                const entry = text.match({some: readEntry, none: () => fallbackEntry})
                const canPaste = entry.map(entry => handler.canPaste(entry, client)).unwrapOrElse(false)
                collector.addItems(
                    MenuItem.default({
                        label: "Cut",
                        shortcut: ReservedShortcuts.Cut.format(),
                        selectable: handler.canCut(client)
                    }).setTriggerProcedure(performCut),
                    MenuItem.default({
                        label: "Copy",
                        shortcut: ReservedShortcuts.Copy.format(),
                        selectable: handler.canCopy(client)
                    }).setTriggerProcedure(performCopy),
                    MenuItem.default({
                        label: "Paste",
                        shortcut: ReservedShortcuts.Paste.format(),
                        selectable: canPaste
                    }).setTriggerProcedure(performPaste)
                )
            }))
    }
}