import {Exec, Subscription} from "@opendaw/lib-std"

export namespace Runtime {
    export const debounce = (() => (exec: Exec, timeout: number = 1000) => {
        let id: ReturnType<typeof setTimeout> | undefined = undefined
        return () => {
            clearTimeout(id)
            id = setTimeout(exec, timeout)
        }
    })()

    export const scheduleInterval = (exec: Exec, time: number, ...args: Array<unknown>): Subscription => {
        const id = setInterval(exec, time, ...args)
        return {terminate: () => clearInterval(id)}
    }

    export const scheduleTimeout = (exec: Exec, time: number, ...args: Array<unknown>): Subscription => {
        const id = setTimeout(exec, time, ...args)
        return {terminate: () => clearTimeout(id)}
    }
}