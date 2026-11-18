import css from "./NumberInput.sass?inline"
import {Events, Html} from "@opendaw/lib-dom"
import {
    int,
    isDefined,
    isInstanceOf,
    isRecord,
    Lifecycle,
    MutableObservableValue,
    StringMapping,
    tryCatch,
    ValueGuard
} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"

const defaultClassName = Html.adoptStyleSheet(css, "NumberInput")

type Construct = {
    lifecycle: Lifecycle
    model: MutableObservableValue<number>
    mapper?: StringMapping<number>
    negativeWarning?: boolean
    className?: string
    maxChars?: int
    step?: number
    guard?: ValueGuard<number>
}

export const NumberInput = ({
                                lifecycle, model, negativeWarning, className, maxChars, mapper, step, guard
                            }: Construct) => {
    const increment = step ?? 1.0
    maxChars ??= 3
    mapper ??= StringMapping.numeric({})
    const input: HTMLElement = (
        <div contentEditable="true"
             style={{width: `calc(0.5em + ${maxChars * 6 + 1}px)`}}/>)
    const element: HTMLElement = (
        <div className={Html.buildClassList(defaultClassName, className)}>
            {input}
        </div>
    )
    const updateDigits = () => {
        const value = model.getValue()
        element.classList.toggle("negative", negativeWarning === true && value < 0)
        input.textContent = mapper.x(value).value
    }
    const commit = (value: number) => {
        if (!Number.isFinite(value)) {return}
        const guarded = guard?.guard(value) ?? value
        if (Number.isFinite(guarded) && guarded !== model.getValue()) {model.setValue(guarded)}
    }
    const stepDraft = (delta: number) => {
        const result = mapper.y(input.textContent ?? "")
        if (result.type === "explicit") {commit(result.value + delta)}
        updateDigits()
        Html.selectContent(input)
    }
    lifecycle.ownAll(
        model.subscribe(updateDigits),
        Events.subscribe(element, "focusin", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            Html.selectContent(event.target)
        }),
        Events.subscribe(element, "focusout", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            if (input.textContent !== mapper.x(model.getValue()).value) {
                const result = mapper.y(input.textContent ?? "")
                if (result.type === "explicit") {commit(result.value)}
            }
            updateDigits()
            Html.unselectContent(event.target)
        }),
        Events.subscribe(element, "copy", (event: ClipboardEvent) => {
            event.preventDefault()
            event.clipboardData?.setData("application/json", JSON.stringify({
                app: "openDAW",
                content: "number",
                value: model.getValue()
            }))
        }),
        Events.subscribe(element, "paste", (event: ClipboardEvent) => {
            const data = event.clipboardData?.getData("application/json")
            if (isDefined(data)) {
                const {status, value: json} = tryCatch<unknown>(() => JSON.parse(data))
                if (status === "success" && isRecord(json) && Object.getPrototypeOf(json) === Object.prototype
                    && json.app === "openDAW" && json.content === "number"
                    && typeof json.value === "number" && Number.isFinite(json.value)) {
                    event.preventDefault()
                    commit(json.value)
                    updateDigits()
                }
            }
        }),
        Events.subscribe(element, "keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                event.stopPropagation()
                return
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {return}
            const target = event.target
            if (!isInstanceOf(target, HTMLElement)) {return}
            switch (event.code) {
                case "ArrowUp": {
                    event.preventDefault()
                    event.stopPropagation()
                    stepDraft(increment)
                    break
                }
                case "ArrowDown": {
                    event.preventDefault()
                    event.stopPropagation()
                    stepDraft(-increment)
                    break
                }
                case "Enter": {
                    event.preventDefault()
                    event.stopPropagation()
                    target.blur()
                    break
                }
                case "Digit0": case "Digit1": case "Digit2": case "Digit3": case "Digit4":
                case "Digit5": case "Digit6": case "Digit7": case "Digit8": case "Digit9":
                case "Numpad0": case "Numpad1": case "Numpad2": case "Numpad3": case "Numpad4":
                case "Numpad5": case "Numpad6": case "Numpad7": case "Numpad8": case "Numpad9":
                case "ArrowLeft":
                case "ArrowRight":
                case "Minus":
                case "NumpadSubtract":
                case "Period":
                case "NumpadDecimal":
                case "Home":
                case "End":
                case "Delete":
                case "Backspace": {
                    event.stopPropagation()
                    break
                }
                case "Tab": break
                default: {
                    event.preventDefault()
                }
            }
        })
    )
    updateDigits()
    return element
}