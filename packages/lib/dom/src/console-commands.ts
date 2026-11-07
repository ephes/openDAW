import {AnyFunc, DefaultObservableValue, EmptyProcedure, ObservableValue, Procedure, Provider} from "@opendaw/lib-std"

export type DotPath = string

export namespace ConsoleCommands {
    export const exportMethod = (path: DotPath, callback: AnyFunc): void =>
        store(path, {value: callback})

    export const exportBoolean = (path: DotPath, init: boolean = false): ObservableValue<boolean> => {
        const observableValue = new DefaultObservableValue(init)
        exportAccessor(path, () => observableValue.getValue(), input => {
            const value = Boolean(input)
            console.debug(`set to ${value}`)
            observableValue.setValue(value)
        })
        return observableValue
    }

    export const exportAccessor = <T>(path: DotPath, getter: Provider<T>, setter: Procedure<T> = EmptyProcedure): void =>
        store(path, {
            get: () => {
                try {
                    console.debug(getter())
                    return 0
                } catch (error) {
                    console.error(error)
                    return 1
                }
            },
            set: (value) => {
                try {
                    setter(value)
                    return getter()
                } catch (error) {
                    console.error(error)
                    return 1
                }
            },
            enumerable: false,
            configurable: false
        })

    const global: Record<string, unknown> = (() => {try {return self as unknown as Record<string, unknown>} catch (_: unknown) {return {}}})()
    const scope = (global["opendaw"] ??= {}) as Record<string, unknown>
    const store = (path: string, attributes: PropertyDescriptor & ThisType<unknown>) => {
        const levels = path.split(".")
        const name = levels.splice(-1)[0]
        let current = scope
        for (const level of levels) {
            current = (current[level] ??= {}) as Record<string, unknown>
        }
        Object.defineProperty(current, name, attributes)
        console.debug(`Console command 'opendaw.${path}' exported`)
    }
}