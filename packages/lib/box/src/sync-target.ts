import {Arrays, assert, ByteArrayInput, isDefined, isRecord, Option, Terminable, UUID} from "@opendaw/lib-std"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {BoxGraph} from "./graph"
import {Address} from "./address"
import {Synchronization, UpdateTask} from "./sync"
import {PointerField} from "./pointer"
import {PrimitiveField, PrimitiveType, PrimitiveValues} from "./primitive"

export const createSyncTarget = <M>(graph: BoxGraph<M>, messenger: Messenger): Terminable => {
    return Communicator.executor<Synchronization<M>>(messenger, new class implements Synchronization<M> {
        sendUpdates(updates: ReadonlyArray<UpdateTask<M>>): void {
            assert(Array.isArray(updates), "Invalid sync batch")
            updates.forEach(validateUpdate)
            graph.beginTransaction()
            try {
                updates.forEach(update => {
                    const type = update.type
                    if (type === "new") {
                        graph.createBox(update.name, update.uuid, box => box.read(new ByteArrayInput(update.buffer)))
                    } else if (type === "update-primitive") {
                        const field = graph.findVertex(Address.reconstruct(update.address)).unwrap("Missing sync primitive")
                        if (!(field instanceof PrimitiveField)) {throw new Error("Sync address is not a primitive field")}
                        assert(validPrimitive(field.type, update.value), "Invalid sync primitive value")
                        field.setValue(update.value as PrimitiveValues)
                    } else if (type === "update-pointer") {
                        const field = graph.findVertex(Address.reconstruct(update.address)).unwrap("Missing sync pointer")
                        if (!(field instanceof PointerField)) {throw new Error("Sync address is not a pointer field")}
                        field.targetAddress = isDefined(update.target)
                            ? Option.wrap(Address.reconstruct(update.target)) : Option.None
                    } else if (type === "delete") {
                        graph.unstageBox(graph.findBox(update.uuid).unwrap("Missing sync box"))
                    }
                })
                graph.endTransaction()
            } catch (error) {
                // Only an owned, still-open transaction may be aborted. Commit may already have closed it.
                if (graph.inTransaction()) {
                    try {graph.abortTransaction()} catch { /* Preserve the batch failure. */ }
                }
                throw error
            }
        }

        checksum(value: Int8Array): Promise<void> {
            if (Arrays.equals(graph.checksum(), value)) {
                return Promise.resolve()
            } else {
                return Promise.reject("Checksum mismatch")
            }
        }
    })
}
const validUuid = (value: unknown): boolean => value instanceof Uint8Array && value.length === UUID.length
const validAddress = (value: unknown): boolean => Array.isArray(value) && value.length === 2
    && validUuid(value[0]) && value[1] instanceof Int16Array && value[1].length <= 127

const validateUpdate = (update: unknown): void => {
    if (!isRecord(update)) {throw new Error("Invalid sync update")}
    switch (update.type) {
        case "new":
            assert(typeof update.name === "string" && validUuid(update.uuid)
                && (update.buffer instanceof ArrayBuffer
                    || (typeof SharedArrayBuffer !== "undefined" && update.buffer instanceof SharedArrayBuffer)), "Invalid new-box update")
            return
        case "delete":
            assert(validUuid(update.uuid), "Invalid delete update")
            return
        case "update-primitive":
            assert(validAddress(update.address), "Invalid primitive address")
            return
        case "update-pointer":
            assert(validAddress(update.address) && (update.target === null || update.target === undefined
                || validAddress(update.target)), "Invalid pointer address")
            return
        default:
            throw new Error("Unsupported sync update type")
    }
}

const validPrimitive = (type: PrimitiveType, value: unknown): boolean => {
    switch (type) {
        case PrimitiveType.Boolean: return typeof value === "boolean"
        case PrimitiveType.String: return typeof value === "string"
        case PrimitiveType.Bytes: return value instanceof Int8Array
        // Float32 fields legitimately hold -Infinity (e.g. decibel minimums) and other non-finite values.
        case PrimitiveType.Float32: return typeof value === "number"
        case PrimitiveType.Int32: return typeof value === "number" && Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff
    }
}
