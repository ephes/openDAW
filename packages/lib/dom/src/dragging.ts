import {EmptyExec, Exec, Func, int, Option, safeRead, Terminable, Terminator} from "@opendaw/lib-std"
import {Browser} from "./browser"
import {AnimationFrame} from "./frames"
import {Events, PointerCaptureTarget} from "./events"
import {Keyboard} from "./keyboard"

export namespace Dragging {
    const pendingPointerLocks = new WeakSet<Element>()

    export interface Process {
        update(event: Event): void
        cancel?(): void
        approve?(): void
        finally?(): void
        abortSignal?: AbortSignal
    }

    export interface Event {
        readonly clientX: number
        readonly clientY: number
        readonly altKey: boolean
        readonly shiftKey: boolean
        readonly ctrlKey: boolean
    }

    export interface ProcessOptions {
        multiTouch?: boolean
        immediate?: boolean
        permanentUpdates?: boolean
        pointerLock?: boolean
        pointerLockThreshold?: number
    }

    // Mutated by the studio preference subscriber in another package.
    // eslint-disable-next-line prefer-const
    export let usePointerLock = false

    export const attach = <T extends PointerCaptureTarget>(target: T,
                                                           factory: Func<PointerEvent, Option<Process>>,
                                                           options?: ProcessOptions): Terminable => {
        let cancelActive: Exec = EmptyExec
        let disposed = false
        // A retired request must finish before a replacement drag can request a
        // lock on the same target: browsers do not tag acquired locks by request.
        const subscription = Events.subscribe(target, "pointerdown", (event: PointerEvent) => {
            if (disposed || event.defaultPrevented) {return}
            if (options?.multiTouch !== true && !event.isPrimary) {return}
            if (event.buttons !== 1 || (Browser.isMacOS() && event.ctrlKey)) {return}
            cancelActive()
            const option: Option<Process> = factory(event)
            if (option.isEmpty()) {return}
            const process: Process = option.unwrap()
            const processCycle = new Terminator()
            const pointerId: int = event.pointerId
            const targetElement = target instanceof Element ? target : null
            const owner = safeRead(target, "ownerDocument", "defaultView") as WindowProxy ?? self
            const ownerDocument = targetElement?.ownerDocument ?? owner.document
            let captureOwned = false
            let pointerLockActive = false
            // This drag's own lock request; another drag's delayed grant never counts.
            let lockPending = false
            // Capture was given up to this drag's lock: losing the lock must end the drag.
            let captureYieldedToLock = false
            let settled = false
            const settle = (approve: boolean): void => {
                if (settled) {return}
                settled = true
                cancelActive = EmptyExec
                let failed = false
                let failure: unknown
                const attempt = (exec: Exec): void => {
                    try {exec()} catch (error) {
                        if (!failed) {failed = true; failure = error}
                    }
                }
                // Retire subscriptions before user hooks can start another drag.
                attempt(() => processCycle.terminate())
                attempt(() => {
                    if (pointerLockActive && targetElement !== null && ownerDocument.pointerLockElement === targetElement) {
                        ownerDocument.exitPointerLock()
                    }
                })
                attempt(() => {
                    if (captureOwned && target.hasPointerCapture(pointerId)) {target.releasePointerCapture(pointerId)}
                })
                attempt(() => approve ? process.approve?.call(process) : process.cancel?.call(process))
                attempt(() => process.finally?.call(process))
                if (failed) {throw failure}
            }
            const cancel = () => settle(false)
            cancelActive = cancel
            try {
                if (disposed || process.abortSignal?.aborted) {cancel(); return}
                event.preventDefault()
                if (target instanceof HTMLElement) {
                    if (!target.hasAttribute("tabindex")) {target.tabIndex = -1}
                    target.focus({preventScroll: true})
                }
                if (settled) {return}
                target.setPointerCapture(pointerId)
                captureOwned = true

                const usePointerLock = options?.pointerLock === true && Dragging.usePointerLock
                const threshold = options?.pointerLockThreshold ?? 16
                const requestPointerLockIfNeeded = (clientX: number, clientY: number): void => {
                    if (!usePointerLock || targetElement === null || pointerLockActive || pendingPointerLocks.has(targetElement)
                        || ownerDocument.pointerLockElement != null) {return}
                    if (clientX >= threshold && clientX <= owner.innerWidth - threshold
                        && clientY >= threshold && clientY <= owner.innerHeight - threshold) {return}
                    pendingPointerLocks.add(targetElement)
                    lockPending = true
                    const lockFailed = (): void => {
                        lockPending = false
                        // Without capture and without the lock nothing can settle the drag.
                        if (!settled && captureYieldedToLock) {
                            // Report hook failures like the event-listener settle paths do,
                            // not as an unhandled rejection of this promise chain.
                            try {cancel()} catch (error) {
                                if (typeof owner.reportError === "function") {owner.reportError(error)}
                                else {queueMicrotask(() => {throw error})}
                            }
                        }
                    }
                    try {
                        targetElement.requestPointerLock().then(() => {
                            pendingPointerLocks.delete(targetElement)
                            lockPending = false
                            if (settled) {
                                if (ownerDocument.pointerLockElement === targetElement) {ownerDocument.exitPointerLock()}
                            } else {
                                pointerLockActive = ownerDocument.pointerLockElement === targetElement
                                if (!pointerLockActive) {lockFailed()}
                            }
                        }, () => {
                            pendingPointerLocks.delete(targetElement)
                            lockFailed()
                        })
                    } catch (_) {
                        pendingPointerLocks.delete(targetElement)
                        lockPending = false
                    }
                }
                const moveEvent = {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    altKey: event.altKey,
                    shiftKey: event.shiftKey,
                    ctrlKey: Keyboard.isControlKey(event)
                } satisfies Event
                const update = (): void => {if (!settled) {process.update(moveEvent)}}
                if (options?.permanentUpdates === true) {processCycle.own(AnimationFrame.add(update))}
                processCycle.ownAll(
                    Events.subscribe(target, "pointermove", (event: PointerEvent) => {
                        if (settled || event.pointerId !== pointerId) {return}
                        if (pointerLockActive && ownerDocument.pointerLockElement === targetElement) {
                            moveEvent.clientX += event.movementX
                            moveEvent.clientY += event.movementY
                        } else {
                            moveEvent.clientX = event.clientX
                            moveEvent.clientY = event.clientY
                            requestPointerLockIfNeeded(event.clientX, event.clientY)
                        }
                        moveEvent.altKey = event.altKey
                        moveEvent.shiftKey = event.shiftKey
                        moveEvent.ctrlKey = Keyboard.isControlKey(event)
                        if (options?.permanentUpdates !== true) {update()}
                    }),
                    Events.subscribe(target, "pointerup", (event: PointerEvent) => {
                        if (event.pointerId === pointerId) {settle(true)}
                    }, {capture: true}),
                    Events.subscribe(target, "pointercancel", (event: PointerEvent) => {
                        if (event.pointerId === pointerId) {cancel()}
                    }, {capture: true}),
                    Events.subscribe(target, "lostpointercapture", (event: PointerEvent) => {
                        if (event.pointerId !== pointerId) {return}
                        // Granting pointer lock supersedes capture (Pointer Events, Chromium):
                        // this drag's pending or owned lock continues it on movementX/Y.
                        if (lockPending || pointerLockActive) {
                            captureYieldedToLock = true
                            return
                        }
                        cancel()
                    }),
                    Events.subscribeAny(ownerDocument, "pointerlockchange", () => {
                        if (settled || !pointerLockActive || ownerDocument.pointerLockElement === targetElement) {return}
                        // The lock ended before pointerup (Esc, focus loss): capture is gone too.
                        pointerLockActive = false
                        if (captureYieldedToLock || !target.hasPointerCapture(pointerId)) {cancel()}
                    }),
                    Events.subscribe(owner, "beforeunload", cancel, {capture: true}),
                    Events.subscribe(owner, "keydown", (event: KeyboardEvent) => {
                        moveEvent.altKey = event.altKey
                        moveEvent.shiftKey = event.shiftKey
                        moveEvent.ctrlKey = Keyboard.isControlKey(event)
                        if (event.key === "Escape") {cancel()} else {update()}
                    }),
                    Events.subscribe(owner, "keyup", (event: KeyboardEvent) => {
                        moveEvent.altKey = event.altKey
                        moveEvent.shiftKey = event.shiftKey
                        moveEvent.ctrlKey = Keyboard.isControlKey(event)
                        update()
                    })
                )
                if (process.abortSignal !== undefined) {
                    processCycle.own(Events.subscribe(process.abortSignal, "abort", cancel))
                    if (process.abortSignal.aborted) {cancel(); return}
                }
                if (options?.immediate === true) {update()}
            } catch (error) {
                // Compensation must not replace the failure which aborted setup.
                try {cancel()} catch (_) { /* The initiating error is rethrown below. */ }
                throw error
            }
        })
        return {terminate: (): void => {
            if (disposed) {return}
            disposed = true
            try {cancelActive()} finally {subscription.terminate()}
        }}
    }
}
