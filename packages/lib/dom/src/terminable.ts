import {Func, Terminable} from "@opendaw/lib-std"

export namespace TerminatorUtils {
    let timer: ReturnType<typeof setInterval> | undefined
    const weakRefs = new Array<[WeakRef<WeakKey>, Terminable]>()
    /**
     * Terminates if the key is no longer referenced to.
     * Make sure that the Terminable does not include other references
     * that would prevent the key from being gc collected.
     * That means the key must not appear in the Terminable!
     * @param key WeakKey
     * @param subscribe Sends a WeakRef to be able to be gc collected
     */
    export const watchWeak = <K extends WeakKey>(key: K, subscribe: Func<WeakRef<K>, Terminable>): K => {
        const weakRef = new WeakRef(key)
        const terminable = subscribe(weakRef)
        weakRefs.push([weakRef, terminable])
        if (timer === undefined) {
            startWatchWeak()
        }
        return key
    }

    const startWatchWeak = (): void => {
        console.debug("start weak watching")
        timer = setInterval(() => {
            let index = weakRefs.length
            while (--index >= 0) {
                const entry = weakRefs[index]
                if (entry[0].deref() === undefined) {
                    weakRefs.splice(index, 1)
                    try {entry[1].terminate()} catch (reason) {console.warn(reason)}
                }
            }
            if (weakRefs.length === 0) {
                clearInterval(timer)
                timer = undefined
            }
        }, 1000)
    }
}