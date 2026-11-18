import css from "./TimeCodeInput.sass?inline"
import {
    checkIndex,
    int,
    isDefined,
    isInstanceOf,
    isRecord,
    Lifecycle,
    MutableObservableValue,
    Observable,
    tryCatch
} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {ppqn, PPQN} from "@opendaw/lib-dsp"
import {Events, Html} from "@opendaw/lib-dom"

const defaultClassName = Html.adoptStyleSheet(css, "TimeCodeInput")

type Construct = {
    lifecycle: Lifecycle
    model: MutableObservableValue<ppqn>
    className?: string
    negativeWarning?: boolean
    signature?: [int, int]
    oneBased?: boolean
    accepts?: (value: ppqn) => boolean
    resetDraft?: Observable<void>
}

export const TimeCodeInput = ({lifecycle, model, className, negativeWarning, signature, oneBased, accepts, resetDraft}: Construct) => {
    const upper = signature?.at(0) ?? 4
    const lower = signature?.at(1) ?? 4
    const units = [
        {amount: PPQN.fromSignature(upper, lower), maxChars: 3},
        {amount: PPQN.fromSignature(1, lower), maxChars: 1},
        {amount: PPQN.SemiQuaver, maxChars: 1},
        {amount: 1, maxChars: 3}
    ]
    const unitOffset = oneBased === true ? 1 : 0
    const inputs: ReadonlyArray<HTMLElement> = units.map(({maxChars}) => (
        <div contentEditable="true" style={{width: `calc(0.5em + ${maxChars * 6 + 1}px)`}}/>
    ))
    const element: HTMLElement = (
        <div className={Html.buildClassList(defaultClassName, className)}>
            {inputs}
        </div>
    )
    const updateDigits = () => {
        const value = model.getValue()
        const negative = value < 0
        element.classList.toggle("negative", negativeWarning === true && negative)
        const {bars, beats, semiquavers, ticks} = PPQN.toParts(value, upper, lower)
        inputs[0].textContent = negative ? String(bars) : String(bars + unitOffset).padStart(3, "0")
        inputs[1].textContent = String(beats + unitOffset)
        inputs[2].textContent = String(semiquavers + unitOffset)
        inputs[3].textContent = String(ticks).padStart(3, "0")
    }
    const canCommit = (value: ppqn) => Number.isSafeInteger(value) && (accepts?.(value) ?? true)
    const commit = (value: ppqn) => {
        if (canCommit(value) && value !== model.getValue()) {model.setValue(value)}
        updateDigits()
    }
    const commitDraft = (index: number, text: string) => {
        const draft = text.trim()
        const unit = /^[+-]?\d+$/.test(draft) ? Number(draft) : NaN
        const value = model.getValue()
        const {bars, beats, semiquavers, ticks} = PPQN.toParts(value, upper, lower)
        const parts = [value < 0 ? bars : bars + unitOffset, beats + unitOffset, semiquavers + unitOffset, ticks]
        const delta = (unit - parts[index]) * units[index].amount
        if (Number.isSafeInteger(unit) && Number.isSafeInteger(delta)) {
            commit(value + delta)
        } else {
            updateDigits()
        }
    }
    if (isDefined(resetDraft)) {lifecycle.own(resetDraft.subscribe(updateDigits))}
    lifecycle.ownAll(
        model.subscribe(updateDigits),
        Events.subscribe(element, "focusin", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            Html.selectContent(event.target)
        }),
        Events.subscribe(element, "focusout", (event: Event) => {
            if (!isInstanceOf(event.target, HTMLElement)) {return}
            const index = inputs.indexOf(event.target)
            if (index < 0) {return}
            commitDraft(index, event.target.textContent ?? "")
            Html.unselectContent(event.target)
        }),
        Events.subscribe(element, "copy", (event: ClipboardEvent) => {
            event.preventDefault()
            event.clipboardData?.setData("application/json", JSON.stringify({
                app: "openDAW",
                content: "timecode",
                value: model.getValue()
            }))
        }),
        Events.subscribe(element, "paste", (event: ClipboardEvent) => {
            const data = event.clipboardData?.getData("application/json")
            if (isDefined(data)) {
                const {status, value: json} = tryCatch<unknown>(() => JSON.parse(data))
                if (status === "success" && isRecord(json) && Object.getPrototypeOf(json) === Object.prototype
                    && json.app === "openDAW" && json.content === "timecode"
                    && typeof json.value === "number" && canCommit(json.value)) {
                    event.preventDefault()
                    commit(json.value)
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
            const index = checkIndex(inputs.indexOf(target), inputs)
            switch (event.code) {
                case "ArrowUp": {
                    event.preventDefault()
                    commit(model.getValue() + units[index].amount)
                    Html.selectContent(target)
                    break
                }
                case "ArrowDown": {
                    event.preventDefault()
                    commit(model.getValue() - units[index].amount)
                    Html.selectContent(target)
                    break
                }
                case "Enter": {
                    event.preventDefault()
                    event.stopPropagation()
                    commitDraft(index, target.textContent ?? "")
                    Html.selectContent(target)
                    break
                }
                case "Digit1":
                case "Digit2":
                case "Digit3":
                case "Digit4":
                case "Digit5":
                case "Digit6":
                case "Digit7":
                case "Digit8":
                case "Digit9":
                case "Digit0":
                case "Tab":
                case "ArrowLeft":
                case "ArrowRight":
                case "Minus":
                case "Backspace": {
                    break // Allow
                }
                default: {
                    console.debug("ignore", event.code)
                    event.preventDefault()
                }
            }
        })
    )
    updateDigits()
    return element
}