import {Editing, Exec, Subscription, tryCatch} from "@opendaw/lib-std"
import {PrimitiveField} from "@opendaw/lib-box"

/**
 * Owns the live writes of one drag gesture to its primitive fields.
 * Writes stop once any field is detached or changed by anyone else. Approval marks one history step.
 * Cancellation restores the original values only while the fields still hold this gesture's last writes:
 * without interleaved editing it drops the gesture's pending modifications, otherwise (or if they were already
 * marked) it records a compensating step.
 */
export class ProvisionalFieldEdit {
    readonly #editing: Editing
    readonly #fields: ReadonlyArray<{field: PrimitiveField<number>, original: number, expected: number}>
    readonly #subscription: Subscription

    #written: boolean = false
    #writing: boolean = false
    #interleaved: boolean = false
    #lost: boolean = false
    #settled: boolean = false

    constructor(editing: Editing, field: PrimitiveField<number>, ...others: Array<PrimitiveField<number>>) {
        this.#editing = editing
        this.#fields = [field, ...others].map(field => {
            const original = field.getValue()
            return {field, original, expected: original}
        })
        this.#subscription = editing.subscribe(() => {if (!this.#writing) {this.#interleaved = true}})
    }

    get owned(): boolean {
        return !this.#lost && !this.#settled && this.#fields.every(({field, expected}) => field.isAttached() && field.getValue() === expected)
    }

    write(modifier: Exec): void {
        if (!this.owned) {
            this.#lost = true
            return
        }
        if (!this.#written) {this.#editing.mark()}
        this.#writing = true
        const result = tryCatch(() => this.#editing.modify(modifier, false))
        this.#writing = false
        this.#written = true
        if (result.status === "failure") {
            this.#lost = true
            throw result.error
        }
        this.#fields.forEach(entry => entry.expected = entry.field.getValue())
    }

    approve(): void {
        if (this.#settled) {return}
        const written = this.#written
        this.#settle()
        if (written) {this.#editing.mark()}
    }

    cancel(): void {
        if (this.#settled) {return}
        const restore = this.#written && this.owned
        this.#settle()
        if (!restore) {return}
        if (!this.#interleaved) {this.#editing.revertPending()}
        const changed = this.#fields.filter(({field, original}) => field.isAttached() && field.getValue() !== original)
        if (changed.length > 0) {
            this.#editing.modify(() => changed.forEach(({field, original}) => field.setValue(original)))
        }
    }

    #settle(): void {
        this.#settled = true
        this.#subscription.terminate()
    }
}
