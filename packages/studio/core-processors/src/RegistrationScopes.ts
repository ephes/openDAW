import {isDefined, Provider, Terminable, Terminator, tryCatch} from "@opendaw/lib-std"
import {Processor} from "./processing"

// Construction can register processors and edges before throwing. The innermost scope keeps
// those leases until the constructed object completes and takes ownership of them.
export class RegistrationScopes {
    readonly #scopes: Array<Terminator> = []

    run<T>(create: Provider<T>): T {
        const scope = new Terminator()
        this.#scopes.push(scope)
        const result = tryCatch(create)
        this.#scopes.pop()
        if (result.status === "success") {
            this.#scopes.at(-1)?.own(scope)
            return result.value
        }
        const cleanup = tryCatch(() => scope.terminate())
        if (cleanup.status === "failure") {
            throw new AggregateError([result.error, cleanup.error], "Construction and cleanup failed", {cause: result.error})
        }
        throw result.error
    }

    processor(processor: Processor, lease: Terminable): Terminable {
        const once = this.edge(lease)
        const terminate = (processor as Processor & Partial<Terminable>).terminate
        const scope = this.#scopes.at(-1)
        if (isDefined(scope) && typeof terminate === "function") {
            scope.own({terminate: () => terminate.call(processor)})
        }
        return once
    }

    edge(lease: Terminable): Terminable {
        let attached = true
        const once = {
            terminate: () => {
                if (!attached) {return}
                attached = false
                lease.terminate()
            }
        }
        this.#scopes.at(-1)?.own(once)
        return once
    }
}
