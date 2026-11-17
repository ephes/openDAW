import {AABB, Client, Option, Padding, Provider, Terminable, Terminator} from "@opendaw/lib-std"
import {Surface} from "@/ui/surface/Surface.tsx"
import {AnimationFrame, Events} from "@opendaw/lib-dom"

export type AutoScroller = (deltaX: number, deltaY: number) => void

export type Options = {
    measure?: Provider<AABB>
    padding?: Padding
}

export const installAutoScroll = (target: Element, autoScroller: AutoScroller, options?: Options): Terminable => {
    const lifeTime = new Terminator()
    let retired = false
    let attempt = 0
    let active = false
    let activePointer = -1
    const measure: Provider<AABB> = options?.measure ?? (() => {
        const {bottom, left, right, top} = target.getBoundingClientRect()
        return {xMin: left, yMin: top, xMax: right, yMax: bottom}
    })
    const padding: Readonly<Padding> = options?.padding ?? Padding.Identity
    let scrolling: Option<Terminable> = Option.None
    let deltaX: number = 0.0
    let deltaY: number = 0.0
    const moveListener = ({clientX, clientY}: Client) => {
        if (retired || !active) {return}
        const {xMin, xMax, yMin, yMax} = AABB.padding(measure(), padding)
        deltaX = clientX < xMin ? clientX - xMin : clientX > xMax ? clientX - xMax : 0
        deltaY = clientY < yMin ? clientY - yMin : clientY > yMax ? clientY - yMax : 0
        const inside = deltaX === 0 && deltaY === 0
        if (scrolling.isEmpty()) {
            if (!inside) {
                const generation = attempt
                scrolling = Option.wrap(AnimationFrame.add(() => {
                    if (!retired && active && attempt === generation) {autoScroller(deltaX, deltaY)}
                }))
            }
        } else {
            if (inside) {
                scrolling.unwrap().terminate()
                scrolling = Option.None
            }
        }
    }
    const finish = () => {
        active = false
        attempt++
        scrolling.ifSome(terminable => terminable.terminate())
        scrolling = Option.None
        lifeTime.terminate()
    }
    const start = Events.subscribe(target, "pointerdown", (event: PointerEvent) => {
        if (retired) {return}
        if (active && event.pointerId !== activePointer && !event.isPrimary) {return}
        finish()
        active = true
        const pointerId = event.pointerId
        activePointer = pointerId
        let nativeDrag = false
        const owner = Surface.get(target).owner.document
        lifeTime.ownAll(
            Events.subscribe(owner, "dragstart", () => {nativeDrag = true}, {capture: true}),
            Events.subscribe(owner, "dragover", moveListener, {capture: true}),
            Events.subscribe(owner, "pointermove", (event: PointerEvent) => {
                if (event.pointerId === pointerId) {moveListener(event)}
            }, {capture: true}),
            Events.subscribe(owner, "pointerup", (event: PointerEvent) => {
                if (event.pointerId === pointerId) {finish()}
            }),
            Events.subscribe(owner, "pointercancel", (event: PointerEvent) => {
                if (event.pointerId === pointerId && !nativeDrag) {finish()}
            }),
            Events.subscribe(owner, "dragend", finish),
            Events.subscribe(owner.defaultView ?? window, "blur", finish)
        )
    }, {capture: true})
    return {terminate: () => {
        if (retired) {return}
        retired = true
        start.terminate()
        finish()
    }}
}
