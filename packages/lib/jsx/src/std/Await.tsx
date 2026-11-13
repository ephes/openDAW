import {Exec, Func, Procedure, Provider, safeExecute} from "@opendaw/lib-std"
import {createElement, replaceChildren} from "../create-element"
import {DomElement, JsxValue} from "../types"

export type AwaitProps<T> = {
    factory: Provider<Promise<T>>,
    loading: Provider<JsxValue>,
    success: Func<T, JsxValue>,
    failure: Func<{ reason: unknown, retry: Exec }, JsxValue>
    repeat?: Procedure<Exec>
}

export const Await = <T, >({factory, loading, success, failure, repeat}: AwaitProps<T>) => {
    const contents: DomElement = <div style={{display: "contents"}}/>
    let generation = 0
    const start = () => {
        const attempt = ++generation
        const current = () => attempt === generation
        const show = (value: JsxValue) => {
            if (current()) {replaceChildren(contents, value)}
        }
        const run = async (): Promise<void> => {
            try {
                show(loading())
                if (!current()) {return}
                const result = await factory()
                if (current()) {show(success(result))}
            } catch (reason) {
                if (!current()) {return}
                try {
                    show(failure({
                        reason: reason instanceof Error ? `${reason.name} (${reason.message})` : reason,
                        retry: () => {if (current()) {start()}}
                    }))
                } catch (reason) {
                    if (current()) {
                        console.warn(reason)
                        replaceChildren(contents, "Could not load content.")
                    }
                }
            }
        }
        void run()
    }
    start()
    safeExecute(repeat, start)
    return contents
}