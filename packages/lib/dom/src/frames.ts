import {Exec, int, Nullable, Terminable} from "@opendaw/lib-std"

export namespace AnimationFrame {
    const nonrecurring = new Set<Exec>()
    const recurring = new Set<Exec>()

    let id: int = -1
    let driver: Nullable<WindowProxy> = null
    let generation: int = 0
    let lastTimestamp: number = Number.NEGATIVE_INFINITY

    export const add = (exec: Exec): Terminable => {
        recurring.add(exec)
        return {terminate: (): unknown => recurring.delete(exec)}
    }

    export const once = (exec: Exec): void => {nonrecurring.add(exec)}

    export const start = (owner: WindowProxy): void => {
        if (driver === owner) {return}
        stop()
        driver = owner
        const currentGeneration = generation
        id = owner.requestAnimationFrame(timestamp => exe(timestamp, owner, currentGeneration))
    }

    export const stop = (): void => {
        generation++
        lastTimestamp = Number.NEGATIVE_INFINITY
        driver?.cancelAnimationFrame(id)
        driver = null
        id = -1
    }

    export const terminate = (): void => {
        stop()
        recurring.clear()
        nonrecurring.clear()
    }

    const exe = (timestamp: DOMHighResTimeStamp, owner: WindowProxy, currentGeneration: int): void => {
        if (driver !== owner || generation !== currentGeneration) {return}
        id = owner.requestAnimationFrame(time => exe(time, owner, currentGeneration))
        if (timestamp - lastTimestamp < 16.0) {return}
        lastTimestamp = timestamp
        // Detach one-shot work before calling clients, including those that throw
        // or enqueue more work. This snapshot belongs only to this generation.
        const queue = [...recurring, ...nonrecurring]
        nonrecurring.clear()
        for (const exec of queue) {
            if (generation !== currentGeneration) {break}
            try {exec()} catch (error) {console.error(error)}
        }
    }

}

export const deferNextFrame = (exec: Exec): DeferExec => new DeferExec(exec)

export class DeferExec implements Terminable {
    readonly #exec: Exec

    #requested: boolean = false
    #disabled: boolean = false

    constructor(exec: Exec) {this.#exec = exec}

    readonly request = (): void => {
        if (this.#requested || this.#disabled) {return}
        this.#requested = true
        AnimationFrame.once(this.#fire)
    }

    readonly immediate = (): void => {
        if (this.#disabled) {return}
        this.#requested = true
        this.#fire()
    }

    cancel(): void {this.#requested = false}
    terminate(): void {this.#disabled = true }

    readonly #fire = (): void => {
        if (this.#disabled || !this.#requested) {return}
        this.#requested = false
        this.#exec()
    }
}