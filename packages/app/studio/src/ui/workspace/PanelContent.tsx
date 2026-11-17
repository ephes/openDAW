import {PanelContentFactory} from "@/ui/workspace/PanelContents.tsx"
import {DomElement, replaceChildren} from "@opendaw/lib-jsx"
import {assert, Option, Terminable, Terminator, tryCatch, UUID} from "@opendaw/lib-std"
import {PanelType} from "@/ui/workspace/PanelType.ts"
import {PanelState} from "@/ui/workspace/PanelState.ts"
import {Surface} from "../surface/Surface"
import {Dialogs} from "@/ui/components/dialogs.tsx"
import {Html} from "@opendaw/lib-dom"

export type PlaceHolder = {
    panelState: PanelState
    container: DomElement
    listener: PanelContentListener
}

export interface PanelContentListener {
    onEmbed(): void
    onPopout(): void
    onMinimized(): void
}

export interface PanelContentHandler extends Terminable {
    togglePopout(): void
    toggleMinimize(): void
    isPopout(): boolean
}

export class PanelContent {
    readonly #factory: PanelContentFactory
    readonly #panelType: PanelType

    #terminator: Terminator
    readonly #id: string

    #placeholder: Option<PlaceHolder> = Option.None

    constructor(factory: PanelContentFactory, panelType: PanelType) {
        this.#factory = factory
        this.#panelType = panelType

        this.#terminator = new Terminator()
        this.#id = UUID.toString(UUID.generate())
    }

    bind(panelState: PanelState, container: DomElement, listener: PanelContentListener): PanelContentHandler {
        assert(this.#placeholder.isEmpty(),
            `Cannot have panel open in multiple location (${this.#placeholder.unwrapOrNull()?.panelState})`)
        const placeholder = {panelState, container, listener}
        this.#placeholder = Option.wrap(placeholder)
        const result = tryCatch(() => {
            if (this.isPopout) {
                listener.onPopout()
            } else if (panelState.isMinimized) {
                listener.onMinimized()
            } else {
                this.#replaceContent(container)
                listener.onEmbed()
            }
        })
        if (result.status === "failure") {
            this.#onPlaceholderLeaves()
            throw result.error
        }
        let active = true
        const ownsPlaceholder = () => active && this.#placeholder.unwrapOrNull() === placeholder
        return {
            togglePopout: () => {if (ownsPlaceholder()) {this.togglePopout()}},
            toggleMinimize: () => {if (ownsPlaceholder()) {this.toggleMinimize()}},
            terminate: () => {
                if (!ownsPlaceholder()) {return}
                active = false
                this.#onPlaceholderLeaves()
            },
            isPopout: (): boolean => ownsPlaceholder() && this.isPopout
        } satisfies PanelContentHandler
    }

    get isPopout(): boolean {return Surface.getById(this.#id).nonEmpty()}
    get panelState(): Option<PanelState> {return this.#placeholder.map(placeholder => placeholder.panelState)}
    // True when the panel is popped-out in its own window, or embedded and
    // not minimized.
    get isVisible(): boolean {
        if (this.isPopout) {return true}
        return this.panelState.mapOr(state => !state.isMinimized, false)
    }

    togglePopout(): void {
        if (this.#placeholder.isEmpty()) {
            console.debug("Cannot togglePopout. No Placeholder available.")
            return
        }
        const {panelState, container, listener} = this.#placeholder.unwrap()
        if (!panelState.popoutable) {return}
        if (this.isPopout) {
            this.#closePopout()
        } else {
            Surface.get()
                .new(640, 480, this.#id, panelState.name)
                .match({
                    none: () => {
                        Dialogs.info({message: "Could not open window. Check popup blocker?"}).finally()
                    },
                    some: surface => {
                        const result = tryCatch(() => this.#replaceContent(surface.ground))
                        if (result.status === "failure") {
                            surface.close()
                            this.#restoreEmbedded(panelState, container, listener)
                            throw result.error
                        }
                        Html.empty(container)
                        surface.own({
                            terminate: () => {
                                this.#terminator.terminate()
                                Html.empty(surface.ground)
                                this.#onSurfaceCloses()
                            }
                        })
                        listener.onPopout()
                    }
                })
        }
    }

    focusPopout(): void {Surface.getById(this.#id).ifSome(surface => surface.owner.focus())}

    toggleMinimize(): void {
        if (this.#placeholder.isEmpty()) {
            console.debug("Cannot toggleMinimize. No Placeholder available.")
            return
        }
        const {panelState, container, listener} = this.#placeholder.unwrap()
        if (!panelState.minimizable) {return}
        if (this.isPopout) {
            this.#closePopout()
        } else if (panelState.isMinimized) {
            this.#replaceContent(container)
            panelState.isMinimized = false
            listener.onEmbed()
        } else {
            this.#terminator.terminate()
            Html.empty(container)
            panelState.isMinimized = true
            listener.onMinimized()
        }
    }

    #onPlaceholderLeaves(): void {
        const {container} = this.#placeholder.unwrap("Illegal State Error (no placeholder)")
        this.#placeholder = Option.None
        if (!this.isPopout) {
            this.#terminator.terminate()
            Html.empty(container)
        }
    }

    #onSurfaceCloses(): void {
        if (this.#placeholder.isEmpty()) {
            // No placeholder available, so we do not care
            return
        }
        const {panelState, container, listener} = this.#placeholder.unwrap()
        if (panelState.isMinimized) {
            listener.onMinimized()
        } else {
            const result = tryCatch(() => this.#replaceContent(container))
            if (result.status === "failure") {
                panelState.isMinimized = true
                listener.onMinimized()
                throw result.error
            }
            panelState.isMinimized = false
            listener.onEmbed()
        }
    }

    #restoreEmbedded(panelState: PanelState, container: DomElement, listener: PanelContentListener): void {
        if (tryCatch(() => this.#replaceContent(container)).status === "success") {return}
        Html.empty(container)
        panelState.isMinimized = true
        listener.onMinimized()
    }

    #replaceContent(container: DomElement): void {
        this.#terminator.terminate()
        const candidate = new Terminator()
        const result = tryCatch(() => replaceChildren(container, this.#factory.create(candidate, this.#panelType)))
        if (result.status === "failure") {
            candidate.terminate()
            throw result.error
        }
        this.#terminator = candidate
    }

    #closePopout(): void {Surface.getById(this.#id).ifSome(surface => surface.close())}
}