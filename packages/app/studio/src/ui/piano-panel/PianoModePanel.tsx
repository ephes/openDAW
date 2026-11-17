import css from "./PianoModePanel.sass?inline"
import {createElement, Group, replaceChildren} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService.ts"
import {deferNextFrame, Html, ShortcutManager} from "@opendaw/lib-dom"
import {PianoRoll} from "@/ui/piano-panel/PianoRoll.tsx"
import {NoteFall} from "@/ui/piano-panel/NoteFall.tsx"
import {
    Lifecycle,
    MutableObservableValue,
    Notifier,
    Predicates,
    Terminator
} from "@opendaw/lib-std"
import {NumberInput} from "@/ui/components/NumberInput.tsx"
import {Checkbox} from "@/ui/components/Checkbox.tsx"
import {Icon} from "@/ui/components/Icon.tsx"
import {AudioUnitBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {RadioGroup} from "@/ui/components/RadioGroup.tsx"
import {EditWrapper} from "@/ui/wrapper/EditWrapper.ts"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {PPQN} from "@opendaw/lib-dsp"
import {PianoPanelShortcuts} from "@/ui/shortcuts/PianoPanelShortcuts"

const className = Html.adoptStyleSheet(css, "PianoModePanel")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const PianoModePanel = ({lifecycle, service}: Construct) => {
    if (!service.hasProfile) {return "No project profile."}
    const {project} = service
    const {rootBoxAdapter, engine: {position}, editing} = project
    const pianoMode = rootBoxAdapter.pianoMode
    const {keyboard, timeRangeInQuarters, noteScale, noteLabels, transpose} = pianoMode
    const updateNotifier = lifecycle.own(new Notifier<void>())
    const notify = lifecycle.own(deferNextFrame(() => updateNotifier.notify()))
    const tracksHeader: HTMLElement = (
        <Group>
            <span style={{color: Colors.blue.toString()}}>Tracks:</span>
            <div style={{height: "1.5em"}}/>
        </Group>
    )
    const noMidiTrackMessage: HTMLElement = (
        <div className="no-midi-track-label">No midi track available</div>
    )
    const trackControls: HTMLElement = <Group/>
    const rosterOwner = lifecycle.own(new Terminator())
    const refreshRoster = () => {
        rosterOwner.terminate()
        let anyAvailable = false
        let anyEnabled = false
        const controls = rootBoxAdapter.audioUnits.adapters().flatMap(audioUnit => {
            return audioUnit.tracks.values().filter(track => track.type === TrackType.Notes)
                .map((track, index, array) => {
                    anyAvailable = true
                    if (!track.box.excludePianoMode.getValue()) {anyEnabled = true}
                    rosterOwner.own(track.box.excludePianoMode.subscribe(refreshRoster))
                    return <Group>
                        <span>{array.length === 1 ? audioUnit.label : `${audioUnit.label} (${index + 1})`}</span>
                        <Checkbox lifecycle={rosterOwner}
                                  model={EditWrapper.forValue(editing,
                                      MutableObservableValue.inverseBoolean(track.box.excludePianoMode))}>
                            <Icon symbol={IconSymbol.Checkbox}/>
                        </Checkbox>
                    </Group>
                })
        })
        replaceChildren(trackControls, controls)
        tracksHeader.classList.toggle("hidden", !anyAvailable)
        noMidiTrackMessage.classList.toggle("hidden", anyEnabled)
        notify.request()
    }
    const membershipOwner = lifecycle.own(new Terminator())
    const unitOwners = new Map<AudioUnitBoxAdapter, Terminator>()
    lifecycle.own(rootBoxAdapter.audioUnits.catchupAndSubscribe({
        onAdd: audioUnit => {
            const owner = membershipOwner.spawn()
            unitOwners.set(audioUnit, owner)
            owner.own(audioUnit.tracks.collection.subscribe({
                onAdd: refreshRoster, onRemove: refreshRoster, onReorder: refreshRoster
            }))
            refreshRoster()
        },
        onRemove: audioUnit => {
            unitOwners.get(audioUnit)?.terminate()
            unitOwners.delete(audioUnit)
            refreshRoster()
        },
        onReorder: refreshRoster
    }))
    refreshRoster()
    const shortcuts = ShortcutManager.get().createContext(Predicates.alwaysTrue, "PianoPanel")
    const engine = project.engine
    lifecycle.ownAll(
        position.subscribe(notify.request),
        pianoMode.subscribe(notify.request),
        shortcuts,
        shortcuts.register(PianoPanelShortcuts["position-increment"].shortcut, () => {
            if (!engine.isPlaying.getValue()) {
                const ppqn = position.getValue() + PPQN.Quarter
                engine.setPosition(Math.max(0, ppqn))
            }
        }, {allowRepeat: true}),
        shortcuts.register(PianoPanelShortcuts["position-decrement"].shortcut, () => {
            if (!engine.isPlaying.getValue()) {
                const ppqn = position.getValue() - PPQN.Quarter
                engine.setPosition(Math.max(0, ppqn))
            }
        }, {allowRepeat: true})
    )
    return (
        <div className={className}>
            <NoteFall lifecycle={lifecycle} service={service} updateNotifier={updateNotifier}/>
            <PianoRoll lifecycle={lifecycle} service={service} updateNotifier={updateNotifier}/>
            <div className="controls">
                <Group>
                    <span>Keyboard</span>
                    <RadioGroup lifecycle={lifecycle}
                                model={EditWrapper.forValue(editing, keyboard)}
                                elements={[
                                    {element: <span>88</span>, value: 0},
                                    {element: <span>76</span>, value: 1},
                                    {element: <span>61</span>, value: 2},
                                    {element: <span>49</span>, value: 3}
                                ]}/>
                    <span>Time Scale</span>
                    <NumberInput lifecycle={lifecycle}
                                 model={EditWrapper.forValue(editing, timeRangeInQuarters)}/>
                    <span>Note Width</span>
                    <NumberInput lifecycle={lifecycle}
                                 model={EditWrapper.forValue(editing, noteScale)} step={0.1}
                                 mapper={noteScale.stringMapping}/>
                    <span>Transpose</span>
                    <NumberInput lifecycle={lifecycle}
                                 model={EditWrapper.forValue(editing, transpose)} step={1}
                                 mapper={transpose.stringMapping}/>
                    <span>Note Labels</span>
                    <Checkbox lifecycle={lifecycle}
                              model={EditWrapper.forValue(editing, noteLabels)}>
                        <Icon symbol={IconSymbol.Checkbox}/>
                    </Checkbox>
                    {tracksHeader}
                    {trackControls}
                </Group>
            </div>
            {noMidiTrackMessage}
        </div>
    )
}