import {Editing, Exec, Subscription, tryCatch} from "@opendaw/lib-std"
import {PrimitiveField} from "@opendaw/lib-box"

/**
 * Owns the live writes of one drag gesture to one primitive field.
 * Writes stop once the field is detached or changed by anyone else. Approval marks one history step.
 * Cancellation restores the original value only while the field still holds this gesture's last write:
 * without interleaved editing it drops the gesture's pending modifications, otherwise (or if they were already
 * marked) it records a compensating step.
 */
export class ProvisionalFieldEdit {
    readonly #editing: Editing
    readonly #field: PrimitiveField<number>
    readonly #original: number
    readonly #subscription: Subscription

    #expected: number
    #written: boolean = false
    #writing: boolean = false
    #interleaved: boolean = false
    #lost: boolean = false
    #settled: boolean = false

    constructor(editing: Editing, field: PrimitiveField<number>) {
        this.#editing = editing
        this.#field = field
        this.#original = field.getValue()
        this.#expected = this.#original
        this.#subscription = editing.subscribe(() => {if (!this.#writing) {this.#interleaved = true}})
    }

    get owned(): boolean {
        return !this.#lost && !this.#settled && this.#field.isAttached() && this.#field.getValue() === this.#expected
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
        this.#expected = this.#field.getValue()
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
        if (this.#field.isAttached() && this.#field.getValue() !== this.#original) {
            this.#editing.modify(() => this.#field.setValue(this.#original))
        }
    }

    #settle(): void {
        this.#settled = true
        this.#subscription.terminate()
    }
}
