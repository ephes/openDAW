import {SelectionListener, Subscription, Terminable, tryCatch} from "@opendaw/lib-std"
import {Address, Addressable} from "@opendaw/lib-box"

/**
 * The members listeners have been told about. Selection notifications can trail the
 * synchronous indexes, so catchup replays this delivered state, never the live index:
 * every replayed member is then balanced by a later live deselect.
 */
export type DeliveredSelection<T> = {
    delivered(): ReadonlyArray<T>
    isDelivered(value: T): boolean
    subscribe(listener: SelectionListener<T>): Terminable
}

export const catchupSelection = <T extends Addressable>(selection: DeliveredSelection<T>,
                                                        listener: SelectionListener<T>): Subscription => {
    const snapshot = selection.delivered().slice()
    const delivered = Address.newSet((value: T) => value.address)
    const observer: SelectionListener<T> = {
        onSelected: value => {
            if (selection.isDelivered(value) && delivered.add(value)) {listener.onSelected(value)}
        },
        onDeselected: value => {
            if (!selection.isDelivered(value) && delivered.hasKey(value.address)) {
                delivered.removeByKey(value.address)
                listener.onDeselected(value)
            }
        }
    }
    const subscription = selection.subscribe(observer)
    const replay = tryCatch(() => snapshot.forEach(value => observer.onSelected(value)))
    if (replay.status === "failure") {subscription.terminate(); throw replay.error}
    return subscription
}
