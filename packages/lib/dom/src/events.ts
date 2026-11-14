import {isAbsent, Nullable, Procedure, Subscription} from "@opendaw/lib-std"

type KnownEventMap = WindowEventMap & MIDIInputEventMap & MIDIPortEventMap

export class Events {
    static subscribe<K extends keyof KnownEventMap>(eventTarget: EventTarget,
                                                    type: K,
                                                    listener: (ev: KnownEventMap[K]) => void,
                                                    options?: boolean | AddEventListenerOptions): Subscription {
        eventTarget.addEventListener(type, listener as EventListener, options)
        return {terminate: () => eventTarget.removeEventListener(type, listener as EventListener, options)}
    }

    static subscribeAny<E extends Event>(eventTarget: EventTarget,
                                         type: string,
                                         listener: (event: E) => void,
                                         options?: boolean | AddEventListenerOptions): Subscription {
        eventTarget.addEventListener(type, listener as EventListener, options)
        return {terminate: (): void => eventTarget.removeEventListener(type, listener as EventListener, options)}
    }

    static DOUBLE_DOWN_THRESHOLD = 200 as const

    /** Matching pointer gestures must be within 200 ms and 5 CSS pixels. */
    static subscribeDblDwn = (eventTarget: EventTarget, listener: (event: PointerEvent) => void): Subscription =>
        this.subscribeDoublePointer(eventTarget, "pointerdown", listener)

    static subscribeDblUp = (eventTarget: EventTarget, listener: (event: PointerEvent) => void): Subscription =>
        this.subscribeDoublePointer(eventTarget, "pointerup", listener)

    private static subscribeDoublePointer(eventTarget: EventTarget, type: "pointerdown" | "pointerup",
                                          listener: (event: PointerEvent) => void): Subscription {
        let previous: {time: number, button: number, kind: string, x: number, y: number} | undefined
        return this.subscribe(eventTarget, type, event => {
            const now = performance.now()
            const matches = previous !== undefined
                && now - previous.time >= 0 && now - previous.time < this.DOUBLE_DOWN_THRESHOLD
                && previous.button === event.button && previous.kind === event.pointerType
                && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) <= 5
            previous = matches ? undefined : {
                time: now, button: event.button, kind: event.pointerType, x: event.clientX, y: event.clientY
            }
            if (matches) {
                event.preventDefault()
                event.stopImmediatePropagation()
                listener(event)
            }
        }, {capture: true})
    }

    static readonly PreventDefault: Procedure<Event> = event => event.preventDefault()

    static readonly isTextInput = (target: Nullable<EventTarget>): boolean => {
        return target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || (target instanceof HTMLElement && target.isContentEditable)
    }

    /**
     * Detects keyboard events triggered by browser autofill (e.g., Safari).
     * Autofill events often have empty or missing key/code properties.
     */
    static isAutofillEvent(event: KeyboardEvent): boolean {
        return isAbsent(event.key) || event.key === ""
            || event.key === "Unidentified" || isAbsent(event.code) || event.code === ""
    }
}

export interface PointerCaptureTarget extends EventTarget {
    setPointerCapture(pointerId: number): void
    releasePointerCapture(pointerId: number): void
    hasPointerCapture(pointerId: number): boolean
}