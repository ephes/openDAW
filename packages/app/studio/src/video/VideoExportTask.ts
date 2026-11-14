/** Observe pending work after cancellation and retire any resource acquired late. */
export const waitForVideoTask = <T>(task: Promise<T>, signal?: AbortSignal, retire?: (value: T) => void): Promise<T> => {
    if (signal === undefined) {return task}
    return new Promise<T>((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener("abort", abort)
            reject(signal.reason)
        }
        signal.addEventListener("abort", abort, {once: true})
        if (signal.aborted) {abort()}
        task.then(value => {
            signal.removeEventListener("abort", abort)
            if (signal.aborted) {
                try {retire?.(value)} catch {console.warn("Late video resource cleanup failed")}
                reject(signal.reason)
            } else {resolve(value)}
        }, error => {
            signal.removeEventListener("abort", abort)
            reject(error)
        })
    })
}
