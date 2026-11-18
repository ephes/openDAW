import {assert, EmptyExec, Exec, isDefined, isInstanceOf, isNotNull, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {EventCollection, ppqn, seconds, TimeBase} from "@opendaw/lib-dsp"
import {
    AudioPitchStretchBox,
    AudioTimeStretchBox,
    TransientMarkerBox,
    WarpMarkerBox
} from "@opendaw/studio-boxes"
import {AudioContentBoxAdapter, AudioRegionBoxAdapter, WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {AudioContentHelpers} from "./AudioContentHelpers"
import {Workers} from "../../Workers"
import {Pointers} from "@opendaw/studio-enums"

export namespace AudioContentModifier {
    export const toNotStretched = async (adapters: ReadonlyArray<AudioContentBoxAdapter>): Promise<Exec> => {
        const audioAdapters = adapters.filter(adapter => !adapter.isPlayModeNoStretch)
        if (audioAdapters.length === 0) {return EmptyExec}
        const conversions = audioAdapters.map(adapter => {
            const {box} = adapter
            if (adapter.timeBase === TimeBase.Seconds) {return {adapter, applyExtent: EmptyExec}}
            const warpMarkers = adapter.optWarpMarkers.unwrap("No Warp requires warp markers")
            if (isInstanceOf(adapter, AudioRegionBoxAdapter)) {
                return {adapter, applyExtent: toNativeRegionExtent(adapter, warpMarkers)}
            }
            const duration = warpMarkers.last()?.seconds ?? 0
            return {adapter, applyExtent: () => {
                box.duration.setValue(duration)
                box.timeBase.setValue(TimeBase.Seconds)
            }}
        })
        return () => conversions.forEach(({adapter, applyExtent}) => {
            if (!adapter.box.isAttached() || adapter.isPlayModeNoStretch) {return}
            adapter.box.playMode.defer()
            adapter.asPlayModeTimeStretch.ifSome(({box}) => {
                if (box.pointerHub.filter(Pointers.AudioPlayMode).length === 0) {box.delete()}
            })
            adapter.asPlayModePitchStretch.ifSome(({box}) => {
                if (box.pointerHub.filter(Pointers.AudioPlayMode).length === 0) {box.delete()}
            })
            applyExtent()
        })
    }

    export const toPitchStretch = async (adapters: ReadonlyArray<AudioContentBoxAdapter>): Promise<Exec> => {
        const audioAdapters = adapters.filter(adapter => adapter.asPlayModePitchStretch.isEmpty())
        if (audioAdapters.length === 0) {return EmptyExec}
        return () => audioAdapters.forEach((adapter) => {
            const optTimeStretch = adapter.asPlayModeTimeStretch
            const boxGraph = adapter.box.graph
            const pitchStretch = AudioPitchStretchBox.create(boxGraph, UUID.generate())
            adapter.box.playMode.refer(pitchStretch)
            if (optTimeStretch.nonEmpty()) {
                const timeStretch = optTimeStretch.unwrap()
                const numPointers = timeStretch.box.pointerHub.filter(Pointers.AudioPlayMode).length
                if (numPointers === 0) {
                    timeStretch.warpMarkers.asArray()
                        .forEach(({box: {owner}}) => owner.refer(pitchStretch.warpMarkers))
                    timeStretch.box.delete()
                } else {
                    timeStretch.warpMarkers.asArray()
                        .forEach(({box: source}) => WarpMarkerBox.create(boxGraph, UUID.generate(), box => {
                            box.position.setValue(source.position.getValue())
                            box.seconds.setValue(source.seconds.getValue())
                            box.owner.refer(pitchStretch.warpMarkers)
                        }))
                }
            } else {
                const {ppqn, seconds} = sampleExtent(adapter)
                AudioContentHelpers.addDefaultWarpMarkers(boxGraph, pitchStretch, ppqn, seconds)
            }
            switchTimeBaseToMusical(adapter)
        })
    }

    export const toTimeStretch = async (adapters: ReadonlyArray<AudioContentBoxAdapter>): Promise<Exec> => {
        const audioAdapters = adapters.filter(adapter => adapter.asPlayModeTimeStretch.isEmpty())
        if (audioAdapters.length === 0) {return EmptyExec}
        const handler = RuntimeNotifier.progress({headline: "Detecting Transients..."})
        const tasks = await Promise.all(audioAdapters.map(async adapter => {
            if (adapter.file.transients.length() === 0) {
                return {
                    adapter,
                    transients: await Workers.Transients.detect(await adapter.file.audioData)
                }
            }
            return {adapter}
        }))
        handler.terminate()
        return () => tasks.forEach(({adapter, transients}) => {
            const optPitchStretch = adapter.asPlayModePitchStretch
            const boxGraph = adapter.box.graph
            const timeStretch = AudioTimeStretchBox.create(boxGraph, UUID.generate())
            adapter.box.playMode.refer(timeStretch)
            if (optPitchStretch.nonEmpty()) {
                const pitchStretch = optPitchStretch.unwrap()
                const numPointers = pitchStretch.box.pointerHub.filter(Pointers.AudioPlayMode).length
                if (numPointers === 0) {
                    pitchStretch.warpMarkers.asArray()
                        .forEach(({box: {owner}}) => owner.refer(timeStretch.warpMarkers))
                    pitchStretch.box.delete()
                } else {
                    pitchStretch.warpMarkers.asArray()
                        .forEach(({box: source}) => WarpMarkerBox.create(boxGraph, UUID.generate(), box => {
                            box.position.setValue(source.position.getValue())
                            box.seconds.setValue(source.seconds.getValue())
                            box.owner.refer(timeStretch.warpMarkers)
                        }))
                }
            } else {
                const {ppqn, seconds} = sampleExtent(adapter)
                AudioContentHelpers.addDefaultWarpMarkers(boxGraph, timeStretch, ppqn, seconds)
            }
            if (isDefined(transients) && adapter.file.transients.length() === 0) {
                const markersField = adapter.file.box.transientMarkers
                transients.forEach(position => TransientMarkerBox.create(boxGraph, UUID.generate(), box => {
                    box.owner.refer(markersField)
                    box.position.setValue(position)
                }))
            }
            switchTimeBaseToMusical(adapter)
        })
    }

    const warpPositionToSeconds = (warpMarkers: EventCollection<WarpMarkerBoxAdapter>, position: ppqn): seconds => {
        const length = warpMarkers.length()
        if (length === 0) {return 0}
        const first = warpMarkers.first()
        const last = warpMarkers.last()
        if (!isNotNull(first) || !isNotNull(last)) {return 0}
        if (position <= first.position) {return first.seconds}
        if (position >= last.position) {return last.seconds}
        for (let i = 0; i < length - 1; i++) {
            const left = warpMarkers.optAt(i)
            const right = warpMarkers.optAt(i + 1)
            if (isNotNull(left) && isNotNull(right) && position >= left.position && position < right.position) {
                const alpha = (position - left.position) / (right.position - left.position)
                return left.seconds + alpha * (right.seconds - left.seconds)
            }
        }
        return last.seconds
    }

    const sampleExtent = (adapter: AudioContentBoxAdapter): {ppqn: number, seconds: number} => {
        if (isInstanceOf(adapter, AudioRegionBoxAdapter)) {
            return {ppqn: adapter.loopDuration, seconds: adapter.box.loopDuration.getValue()}
        }
        return {ppqn: adapter.duration, seconds: adapter.box.duration.getValue()}
    }

    const toNativeRegionExtent = (adapter: AudioRegionBoxAdapter,
                                  markers: EventCollection<WarpMarkerBoxAdapter>): Exec => {
        const {box, position, complete, duration, loopDuration, loopOffset, tempoMap} = adapter
        const first = markers.first()
        const last = markers.last()
        assert(first !== null && last !== null && first.position <= 0 && last.position >= loopDuration,
            "No Warp requires warp markers covering the loop")
        assert(Number.isFinite(loopOffset) && loopOffset >= 0 && loopOffset < loopDuration,
            "No Warp requires a valid loop phase")
        const sourceStart = warpPositionToSeconds(markers, 0)
        const loopSeconds = Math.fround(warpPositionToSeconds(markers, loopDuration) - sourceStart)
        // An untrimmed single pass still adopts the source's native length.
        const regionSeconds = duration === loopDuration && loopOffset === 0
            ? loopSeconds
            : Math.fround(tempoMap.intervalToSeconds(position, complete))
        const phaseSeconds = warpPositionToSeconds(markers, loopOffset) - sourceStart
        // Native regions store their loop phase in pulses, even in the seconds time base.
        const startSeconds = tempoMap.ppqnToSeconds(position)
        const rawStartSeconds = startSeconds - phaseSeconds
        // Match VaryingTempoMap's mirrored conversion for loop starts before zero.
        const rawStart = Math.sign(rawStartSeconds) * tempoMap.secondsToPPQN(Math.abs(rawStartSeconds))
        const nativeOffset = phaseSeconds === 0 ? 0 : Math.fround(position - rawStart)
        const nativeLoopPulses = tempoMap.intervalToPPQN(startSeconds, startSeconds + loopSeconds)
        const waveformOffset = Math.fround(adapter.waveformOffset.getValue() + sourceStart)
        assert(Number.isFinite(loopSeconds) && loopSeconds > 0 && Number.isFinite(regionSeconds) && regionSeconds > 0
            && Number.isFinite(nativeLoopPulses) && Number.isFinite(nativeOffset)
            && nativeOffset >= 0 && nativeOffset < nativeLoopPulses
            && Number.isFinite(phaseSeconds) && phaseSeconds >= 0 && phaseSeconds < loopSeconds
            && Number.isFinite(waveformOffset), "No Warp cannot represent this region's extent")
        return () => {
            box.duration.setValue(regionSeconds)
            box.loopDuration.setValue(loopSeconds)
            box.loopOffset.setValue(nativeOffset)
            box.waveformOffset.setValue(waveformOffset)
            box.timeBase.setValue(TimeBase.Seconds)
        }
    }

    const switchTimeBaseToMusical = (adapter: AudioContentBoxAdapter): void => {
        const {timeBase} = adapter
        if (timeBase === TimeBase.Musical) {return}
        const {box} = adapter
        box.duration.setValue(adapter.duration)
        if (isInstanceOf(adapter, AudioRegionBoxAdapter)) {
            const {box: {loopDuration, loopOffset}} = adapter
            loopOffset.setValue(adapter.loopOffset)
            loopDuration.setValue(adapter.loopDuration)
        }
        box.timeBase.setValue(TimeBase.Musical)
    }
}