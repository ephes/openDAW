import {Arrays, EmptyExec, panic, Terminable, Terminator} from "@opendaw/lib-std"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {BoxGraph} from "./graph"
import {Update} from "./updates"
import {Synchronization, UpdateTask} from "./sync"

export class SyncSource<M> implements Terminable {
    static readonly DEBUG_CHECKSUM = false

    readonly #terminator: Terminator
    readonly #caller: Synchronization<M>
    #failed: boolean = false

    constructor(graph: BoxGraph<M>, messenger: Messenger, initialize?: boolean) {
        this.#terminator = new Terminator()
        this.#caller = Communicator.sender(messenger, ({dispatchAndForget, dispatchAndReturn}) =>
            new class implements Synchronization<M> {
                sendUpdates(updates: ReadonlyArray<UpdateTask<M>>): void {
                    dispatchAndForget(this.sendUpdates, updates)
                }
                checksum(value: Int8Array): Promise<void> {
                    return dispatchAndReturn(this.checksum, value)
                }
            })

        if (initialize === true) {
            const boxes = graph.boxes()
            if (boxes.length > 0) {
                this.#caller.sendUpdates(boxes.map<UpdateTask<M>>(box =>
                    ({type: "new", name: box.name as keyof M, uuid: box.address.uuid, buffer: box.toArrayBuffer()})))
            }
        }

        const updates: Array<UpdateTask<M>> = []

        this.#terminator.own(graph.subscribeTransaction({
            onBeginTransaction: EmptyExec,
            onEndTransaction: (rolledBack) => {
                if (rolledBack) {
                    Arrays.clear(updates)
                    return
                }
                const batch = updates.splice(0)
                try {
                    this.#caller.sendUpdates(batch)
                } catch (error) {
                    // This transaction has committed. Delivery is ambiguous: never replay its batch.
                    this.#failed = true
                    this.#terminator.terminate()
                    throw error
                }
                if (SyncSource.DEBUG_CHECKSUM) {
                    this.#caller.checksum(graph.checksum()).then(EmptyExec, (reason) => panic(reason))
                }
            }
        }))

        this.#terminator.own(graph.subscribeToAllUpdatesImmediate({
            onUpdate: (update: Update): void => {
                if (update.type === "new") {
                    updates.push({
                        type: "new",
                        name: update.name as keyof M,
                        uuid: update.uuid,
                        buffer: update.settings
                    })
                } else if (update.type === "primitive") {
                    updates.push({
                        type: "update-primitive",
                        address: update.address.decompose(),
                        value: update.newValue
                    })
                } else if (update.type === "pointer") {
                    updates.push({
                        type: "update-pointer",
                        address: update.address.decompose(),
                        target: update.newAddress.unwrapOrNull()?.decompose()
                    })
                } else if (update.type === "delete") {
                    updates.push({
                        type: "delete",
                        uuid: update.uuid
                    })
                } else {
                    return panic(`Unknown ${update}`)
                }
            }
        }))
    }

    /** A failed transport requires a new sender and a fresh target snapshot. */
    get failed(): boolean {return this.#failed}
    checksum(value: Int8Array): Promise<void> {
        return this.#failed ? Promise.reject(new Error("Sync source failed; resynchronize from a fresh snapshot"))
            : this.#caller.checksum(value)
    }
    terminate() {this.#terminator.terminate()}
}