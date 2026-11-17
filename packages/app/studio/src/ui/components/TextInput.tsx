import {Events, Html} from "@opendaw/lib-dom"
import css from "./TextInput.sass?inline"
import {int, isDefined, isInstanceOf, isRecord, Lifecycle, MutableObservableValue, tryCatch} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"

const defaultClassName = Html.adoptStyleSheet(css, "TextInput")

type Construct = {
    lifecycle: Lifecycle
    model: MutableObservableValue<string>
    className?: string
    maxChars?: int
}

export const TextInput = ({lifecycle, model, className, maxChars}: Construct) => {
    maxChars ??= 127
    const input: HTMLElement = (<div contentEditable="true" style={{width: "100%"}}/>)
    const element: HTMLElement = (
        <div className={Html.buildClassList(defaultClassName, className)}>
            {input}
        </div>
    )
    const update = () => {
        const value = model.getValue()
        if (input.textContent !== value) {input.textContent = value}
    }
    lifecycle.ownAll(
        model.subscribe(update),
        Events.subscribe(element, "focusin", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            Html.selectContent(event.target)
        }),
        Events.subscribe(element, "focusout", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            update()
            Html.unselectContent(event.target)
        }),
        Events.subscribe(element, "copy", (event: ClipboardEvent) => {
            event.preventDefault()
            event.clipboardData?.setData("application/json", JSON.stringify({
                app: "openDAW",
                content: "text",
                value: model.getValue()
            }))
        }),
        Events.subscribe(element, "paste", (event: ClipboardEvent) => {
            const data = event.clipboardData?.getData("application/json")
            if (isDefined(data)) {
                const {status, value: json} = tryCatch<unknown>(() => JSON.parse(data))
                if (status === "success" && isRecord(json) && Object.getPrototypeOf(json) === Object.prototype
                    && json.app === "openDAW" && json.content === "text"
                    && typeof json.value === "string" && json.value.length <= maxChars) {
                    event.preventDefault()
                    model.setValue(json.value)
                }
            }
        }),
        Events.subscribe(element, "input", (event: Event) => {
            const target = event.target
            if (!isInstanceOf(target, HTMLElement)) {return}
            const newValue = target.textContent?.slice(0, maxChars) ?? ""
            model.setValue(newValue)
        })
    )
    update()
    return element
}