import {Selection, SelectionListener, Subscription, tryCatch} from "@opendaw/lib-std"
import {Address, Addressable} from "@opendaw/lib-box"

export const catchupSelection = <T extends Addressable>(selection: Selection<T>, listener: SelectionListener<T>): Subscription => {
    const snapshot = selection.selected().slice()
    const delivered = Address.newSet((value: T) => value.address)
    const observer: SelectionListener<T> = {
        onSelected: value => {
            if (selection.isSelected(value) && delivered.add(value)) {listener.onSelected(value)}
        },
        onDeselected: value => {
            if (!selection.isSelected(value) && delivered.hasKey(value.address)) {
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
