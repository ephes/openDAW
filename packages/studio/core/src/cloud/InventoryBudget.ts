import {CloudError} from "./CloudExchange"

// A partial inventory must never authorize backup cleanup or restore.
export class InventoryBudget {
    readonly #seen = new Set<string>()
    #pages = 0
    #names = 0

    admit(names: number, next?: string): void {
        this.#pages++
        this.#names += names
        if (this.#names > 100000 || (next !== undefined &&
            (this.#pages >= 1000 || next.length === 0 || this.#seen.has(next)))) {
            throw new CloudError("Cloud inventory incomplete: page/name budget or cursor progress refused")
        }
        if (next !== undefined) {this.#seen.add(next)}
    }
}
