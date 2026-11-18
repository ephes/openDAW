import css from "./StretchSelector.sass?inline"
import {Html} from "@opendaw/lib-dom"
import {DefaultObservableValue, Lifecycle, panic, RuntimeNotifier} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {IconSymbol} from "@opendaw/studio-enums"
import {RadioGroup} from "@/ui/components/RadioGroup"
import {Icon} from "@/ui/components/Icon"
import {AudioContentModifier, Project} from "@opendaw/studio-core"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader"
import {TimeStretchEditor} from "@/ui/timeline/editors/audio/TimeStretchEditor"

const className = Html.adoptStyleSheet(css, "StretchSelector")

type Construct = {
    lifecycle: Lifecycle
    project: Project
    reader: AudioEventOwnerReader
}

export const StretchSelector = ({lifecycle, project, reader}: Construct) => {
    const enum PlayModeEnum {NoWarp, Pitch, TimeStretch}

    const {editing} = project
    const {audioContent} = reader
    const toPlayModeEnum = (): PlayModeEnum => {
        if (audioContent.isPlayModeNoStretch) {return PlayModeEnum.NoWarp}
        if (audioContent.asPlayModePitchStretch.nonEmpty()) {return PlayModeEnum.Pitch}
        if (audioContent.asPlayModeTimeStretch.nonEmpty()) {return PlayModeEnum.TimeStretch}
        return panic("Unknown PlayMode")
    }
    const playModeEnumValue = new DefaultObservableValue(toPlayModeEnum())
    let generation = 0
    let reflecting = false
    const reflectMode = () => {
        generation++
        element.removeAttribute("aria-busy")
        reflecting = true
        try {
            playModeEnumValue.setValue(toPlayModeEnum())
        } finally {
            reflecting = false
        }
    }
    const convert = (mode: PlayModeEnum) => {
        switch (mode) {
            case PlayModeEnum.NoWarp: return AudioContentModifier.toNotStretched([audioContent])
            case PlayModeEnum.Pitch: return AudioContentModifier.toPitchStretch([audioContent])
            case PlayModeEnum.TimeStretch: return AudioContentModifier.toTimeStretch([audioContent], {showProgress: false})
        }
    }
    lifecycle.ownAll(
        {terminate: () => {generation++; element.removeAttribute("aria-busy")}},
        playModeEnumValue.subscribe(async owner => {
            if (reflecting) {return}
            const choice = ++generation
            element.setAttribute("aria-busy", "true")
            try {
                const exec = await convert(owner.getValue())
                if (choice === generation && audioContent.box.isAttached()) {editing.modify(exec)}
            } catch (error) {
                if (choice !== generation || !audioContent.box.isAttached()) {return}
                reflectMode()
                void RuntimeNotifier.info({headline: "Could not change stretch mode", message: String(error)})
                    .catch(console.warn)
            } finally {
                if (choice === generation) {element.removeAttribute("aria-busy")}
            }
        }),
        audioContent.box.playMode.subscribe(reflectMode)
    )
    const element: HTMLElement = (
        <div className={className}>
            <RadioGroup lifecycle={lifecycle}
                        model={playModeEnumValue}
                        elements={[
                            {
                                value: PlayModeEnum.NoWarp,
                                element: (<span>No</span>),
                                tooltip: "No Warp"
                            },
                            {
                                value: PlayModeEnum.Pitch,
                                element: (<Icon symbol={IconSymbol.TapeReel}/>),
                                tooltip: "Pitch Stretch"
                            },
                            {
                                value: PlayModeEnum.TimeStretch,
                                element: (<Icon symbol={IconSymbol.Time}/>),
                                tooltip: "Time Stretch"
                            }
                        ]}/>
            <hr/>
            <TimeStretchEditor lifecycle={lifecycle}
                               project={project}
                               reader={reader}/>
        </div>
    )
    return element
}
