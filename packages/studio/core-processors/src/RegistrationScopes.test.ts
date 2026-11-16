import {expect, it, vi} from "vitest"
import {Terminable, tryCatch} from "@opendaw/lib-std"
import {RegistrationScopes} from "./RegistrationScopes"
import {Processor} from "./processing"

const fixture = () => {
    const scopes = new RegistrationScopes()
    let live = 0
    const register = (processor: Processor) => {live++; return scopes.processor(processor, {terminate: () => {live--}})}
    return {scopes, register, live: () => live}
}

it("keeps registrations of a completed construction and releases each lease once", () => {
    const {scopes, register, live} = fixture()
    const lease = scopes.run(() => register({} as Processor))
    expect(live()).toBe(1)
    lease.terminate(); lease.terminate()
    expect(live()).toBe(0)
})

it("releases leases and terminates processors registered by a failed construction", () => {
    const {scopes, register, live} = fixture()
    const terminate = vi.fn()
    const processor = {terminate} as unknown as Processor
    let lease: Terminable = {terminate: () => {}}
    expect(() => scopes.run(() => {lease = register(processor); throw new Error("synthetic")})).toThrow("synthetic")
    expect(live()).toBe(0)
    expect(terminate).toHaveBeenCalledOnce()
    lease.terminate()
    expect(live()).toBe(0)
    register({} as Processor)
    expect(live()).toBe(1)
})

it("hands a completed nested construction to its enclosing scope", () => {
    const {scopes, register, live} = fixture()
    expect(() => scopes.run(() => {
        scopes.run(() => register({} as Processor))
        register({} as Processor)
        throw new Error("outer")
    })).toThrow("outer")
    expect(live()).toBe(0)
})

it("reports construction and cleanup failures together", () => {
    const {scopes} = fixture()
    const processor = {terminate: () => {throw new Error("cleanup")}} as unknown as Processor
    const result = tryCatch(() => scopes.run(() => {scopes.processor(processor, {terminate: () => {}}); throw new Error("create")}))
    expect(result.status).toBe("failure")
    expect(result.error).toBeInstanceOf(AggregateError)
    expect((result.error as AggregateError).errors.map(error => (error as Error).message)).toEqual(["create", "cleanup"])
})
