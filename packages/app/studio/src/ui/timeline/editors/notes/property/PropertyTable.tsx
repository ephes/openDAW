import css from "./PropertyTable.sass?inline"
import {Arrays, Editing, Lifecycle, Notifier, Nullable, Option, Selection, Terminator} from "@opendaw/lib-std"
import {deferNextFrame, Html} from "@opendaw/lib-dom"
import {TimeCodeInput} from "@/ui/components/TimeCodeInput.tsx"
import {PropertyParameters} from "@/ui/timeline/editors/notes/property/PropertyParameters.ts"
import {NumberInput} from "@/ui/components/NumberInput.tsx"
import {createElement, Inject} from "@opendaw/lib-jsx"
import {MidiKeys} from "@opendaw/lib-dsp"
import {NoteEventBoxAdapter} from "@opendaw/studio-adapters"
import {IconSymbol} from "@opendaw/studio-enums"
import {ObservableModifyContext} from "@/ui/timeline/ObservableModifyContext.ts"
import {NoteModifier} from "@/ui/timeline/editors/notes/NoteModifier.ts"
import {NoteModifyStrategies} from "@/ui/timeline/editors/notes/NoteModifyStrategies.ts"
import {Icon} from "@/ui/components/Icon.tsx"

const className = Html.adoptStyleSheet(css, "PropertyTable")

type Construct = {
    lifecycle: Lifecycle
    selection: Selection<NoteEventBoxAdapter>
    modifyContext: ObservableModifyContext<NoteModifier>
    editing: Editing
}

export const PropertyTable = ({lifecycle, selection, modifyContext, editing}: Construct) => {
    const {position, duration, pitch, velocity, cent, chance, playCount, playCurve} = PropertyParameters
    const resetTimingDraft = lifecycle.own(new Notifier<void>())
    const positionInput: Element = <TimeCodeInput lifecycle={lifecycle}
                                                  model={position.parameter}
                                                  resetDraft={resetTimingDraft}
                                                  accepts={value => position.parameter.valueMapping.clamp(value) === value}
                                                  negativeWarning
                                                  oneBased/>
    const durationInput: Element = <TimeCodeInput lifecycle={lifecycle}
                                                  model={duration.parameter}
                                                  resetDraft={resetTimingDraft}
                                                  accepts={value => duration.parameter.valueMapping.clamp(value) === value}
                                                  negativeWarning/>
    const pitchString = Inject.value(MidiKeys.toFullString(pitch.parameter.getValue()))
    const pitchInput: Element = <NumberInput lifecycle={lifecycle}
                                             model={pitch.parameter}/>
    const velocityInput: Element = <NumberInput lifecycle={lifecycle}
                                                model={velocity.parameter}
                                                mapper={velocity.parameter.stringMapping}
                                                step={0.01}/>
    const centInput: Element = <NumberInput lifecycle={lifecycle}
                                            model={cent.parameter}/>
    const chanceInput: Element = <NumberInput lifecycle={lifecycle}
                                              model={chance.parameter}/>
    const playCountInput: Element = <NumberInput lifecycle={lifecycle}
                                                 model={playCount.parameter}/>
    const playCurveInput: Element = <NumberInput lifecycle={lifecycle}
                                                 model={playCurve.parameter}
                                                 mapper={playCurve.parameter.stringMapping}
                                                 step={0.01}/>
    const element: HTMLElement = (
        <div className={className}>
            <Icon symbol={IconSymbol.Start}/>
            {positionInput}
            <div/>
            <Icon symbol={IconSymbol.Duration}/>
            {durationInput}
            <Icon symbol={IconSymbol.Piano}/>
            <div className="group">
                {pitchInput}
                <div className="unit">{pitchString}</div>
            </div>
            <div/>
            <Icon symbol={IconSymbol.Velocity}/>
            <div className="group">
                {velocityInput}
                <div className="unit">%</div>
            </div>
            <Icon symbol={IconSymbol.Dial}/>
            <div className="group">
                {centInput}
                <div className="unit">cents</div>
            </div>
            <div/>
            <Icon symbol={IconSymbol.Random}/>
            <div className="group">
                {chanceInput}
                <div className="unit">%</div>
            </div>
            <Icon symbol={IconSymbol.Divide}/>
            <div className="group connect">
                {playCountInput}
                <div className="unit">#</div>
                <hr/>
            </div>
            <Icon symbol={IconSymbol.Curve}/>
            <div className="group">
                {playCurveInput}
                <div className="unit">%</div>
            </div>
        </div>
    )

    let focus: Nullable<NoteEventBoxAdapter> = null

    const updateState = lifecycle.own(deferNextFrame(() => {
        if (selection.isEmpty()) {
            element.classList.add("disabled")
            positionInput.classList.remove("invalid")
            durationInput.classList.remove("invalid")
            pitchInput.classList.remove("invalid")
            velocityInput.classList.remove("invalid")
            centInput.classList.remove("invalid")
            chanceInput.classList.remove("invalid")
            playCountInput.classList.remove("invalid")
            playCurveInput.classList.remove("invalid")
        } else {
            element.classList.remove("disabled")
            const adapters = selection.selected()
            positionInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.position === b.position))
            durationInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.duration === b.duration))
            pitchInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.pitch === b.pitch))
            velocityInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.velocity === b.velocity))
            centInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.cent === b.cent))
            chanceInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.chance === b.chance))
            playCountInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.playCount === b.playCount))
            playCurveInput.classList.toggle("invalid", !Arrays.satisfy(adapters, (a, b) => a.playCurve === b.playCurve))

            if (focus !== null) {
                const modifier: Option<NoteModifyStrategies> = modifyContext.modifier
                const strategy = modifier.unwrapOrElse(NoteModifyStrategies.Identity).selectedModifyStrategy()
                ignore = true
                position.parameter.setValue(strategy.readPosition(focus))
                duration.parameter.setValue(strategy.readComplete(focus) - strategy.readPosition(focus))
                pitch.parameter.setValue(strategy.readPitch(focus))
                velocity.parameter.setValue(strategy.readVelocity(focus))
                cent.parameter.setValue(strategy.readCent(focus))
                chance.parameter.setValue(strategy.readChance(focus))
                playCount.parameter.setValue(focus.playCount)
                playCurve.parameter.setValue(focus.playCurve)
                ignore = false
            }
        }
    }))

    let ignore = false
    const timingSubscriptions = lifecycle.own(new Terminator())
    const selectionChanged = (adapter: Nullable<NoteEventBoxAdapter>) => {
        if (focus !== adapter) {
            timingSubscriptions.terminate()
            focus = adapter
            if (focus !== null) {
                timingSubscriptions.ownAll(
                    focus.box.position.subscribe(updateState.immediate),
                    focus.box.duration.subscribe(updateState.immediate)
                )
            }
        }
        updateState.immediate()
        resetTimingDraft.notify()
    }
    lifecycle.ownAll(...Object.values(PropertyParameters)
            .map(({parameter, fieldName}) => parameter.subscribe(owner => {
                if (ignore) {return}
                const value = owner.getValue()
                editing.modify(() =>
                    selection.selected()
                        .forEach(adapter => adapter.box[fieldName].setValue(value)))
            })),
        selection.catchupAndSubscribe({
            onSelected: selectionChanged,
            onDeselected: (adapter: NoteEventBoxAdapter) =>
                selectionChanged(focus === adapter ? selection.selected().at(-1) ?? null : focus)
        }),
        pitch.parameter.subscribe(owner => pitchString.value = MidiKeys.toFullString(owner.getValue())),
        modifyContext.subscribeUpdate(updateState.request)
    )
    updateState.immediate()
    return element
}