import type * as InferenceLib from "@opendaw/lib-inference"
import {Workers} from "@opendaw/studio-core"

let cached: Promise<typeof InferenceLib.Inference> | undefined

/**
 * Lazy-load `@opendaw/lib-inference` and install it (once) on first use.
 * Keeps the lib-inference chunk out of the studio's boot bundle. Safe to
 * call from any feature that needs to run an inference task.
 */
export const ensureInference = (): Promise<typeof InferenceLib.Inference> => {
    if (cached === undefined) {
        const pending = import("@opendaw/lib-inference").then(module => {
            module.Inference.install({opfs: Workers.Opfs})
            return module.Inference
        }).catch(error => {
            if (cached === pending) {cached = undefined}
            throw error
        })
        cached = pending
    }
    return cached
}
