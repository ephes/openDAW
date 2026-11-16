import {ElementCapturing, TimelineRange} from "@opendaw/studio-core"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader"
import {EventCollection, ppqn} from "@opendaw/lib-dsp"
import {TransientMarkerBoxAdapter, WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {BinarySearch, isNotNull, Nullable, NumberComparator} from "@opendaw/lib-std"

export namespace TransientMarkerUtils {
    const MARKER_RADIUS = 4

    type Marker = Readonly<{position: number, seconds: number}>

    export const isValidWarpMarkers = (markers: ReadonlyArray<Marker>): boolean =>
        markers.length >= 2 && markers.every((marker, index) =>
            Number.isFinite(marker.position) && Number.isFinite(marker.seconds)
            && (index === 0 || (marker.position > markers[index - 1].position
                && marker.seconds > markers[index - 1].seconds)))

    const snapshot = (warpMarkers: EventCollection<WarpMarkerBoxAdapter>): ReadonlyArray<Marker> =>
        warpMarkers.asArray().map(({position, seconds}) => ({position, seconds}))

    export const secondsToUnits = (seconds: number,
                                   warpMarkers: EventCollection<WarpMarkerBoxAdapter>): Nullable<ppqn> => {
        const markers = snapshot(warpMarkers)
        if (!isValidWarpMarkers(markers) || !Number.isFinite(seconds)) {return null}
        return mapSeconds(seconds, markers)
    }

    const mapSeconds = (seconds: number, markers: ReadonlyArray<Marker>): Nullable<ppqn> => {
        if (!Number.isFinite(seconds)) {return null}
        const first = markers[0]
        const second = markers[1]
        const secondLast = markers[markers.length - 2]
        const last = markers[markers.length - 1]
        const firstRate = (second.position - first.position) / (second.seconds - first.seconds)
        const lastRate = (last.position - secondLast.position) / (last.seconds - secondLast.seconds)
        if (seconds < first.seconds) {
            const result = first.position + (seconds - first.seconds) * firstRate
            return Number.isFinite(result) ? result : null
        }
        if (seconds >= last.seconds) {
            const result = last.position + (seconds - last.seconds) * lastRate
            return Number.isFinite(result) ? result : null
        }
        const index = Math.min(markers.length - 2, BinarySearch
            .rightMostMapped(markers, seconds, NumberComparator, ({seconds}) => seconds))
        const left = markers[index]
        const right = markers[index + 1]
        const t = (seconds - left.seconds) / (right.seconds - left.seconds)
        const result = left.position + t * (right.position - left.position)
        return Number.isFinite(result) ? result : null
    }

    export const createCapturing = (element: Element,
                                    range: TimelineRange,
                                    reader: AudioEventOwnerReader,
                                    warpMarkers: EventCollection<WarpMarkerBoxAdapter>,
                                    transientMarkers: EventCollection<TransientMarkerBoxAdapter>) =>
        new ElementCapturing<TransientMarkerBoxAdapter>(element, {
            capture: (x: number, _y: number): Nullable<TransientMarkerBoxAdapter> => {
                const {audioContent} = reader
                const waveformOffset = audioContent.waveformOffset.getValue()
                const markers = snapshot(warpMarkers)
                if (!isValidWarpMarkers(markers) || !Number.isFinite(waveformOffset)) {return null}
                const first = markers[0]
                const second = markers[1]
                const secondLast = markers[markers.length - 2]
                const last = markers[markers.length - 1]
                const firstRate = (second.position - first.position) / (second.seconds - first.seconds)
                const lastRate = (last.position - secondLast.position) / (last.seconds - secondLast.seconds)
                const localUnitToSeconds = (localUnit: number): number => {
                    if (localUnit < first.position) {
                        return first.seconds + (localUnit - first.position) / firstRate
                    }
                    if (localUnit >= last.position) {
                        return last.seconds + (localUnit - last.position) / lastRate
                    }
                    const index = Math.min(markers.length - 2, Math.max(0, BinarySearch.rightMostMapped(markers, localUnit, NumberComparator, ({position}) => position)))
                    const left = markers[index]
                    const right = markers[index + 1]
                    const t = (localUnit - left.position) / (right.position - left.position)
                    return left.seconds + t * (right.seconds - left.seconds)
                }
                // Convert x position to seconds for searching
                const unit = range.xToUnit(x)
                const localUnit = unit - reader.offset
                const targetSeconds = localUnitToSeconds(localUnit) + waveformOffset
                if (!Number.isFinite(targetSeconds)) {return null}
                // Search nearby transients using binary search
                const transients = transientMarkers.asArray()
                const centerIndex = Math.max(0, transientMarkers.floorLastIndex(targetSeconds))
                let closest: Nullable<{ transient: TransientMarkerBoxAdapter, distance: number }> = null
                // Check transients around the target position
                for (let i = Math.max(0, centerIndex - 1); i < transients.length; i++) {
                    const transient = transients[i]
                    const adjustedSeconds = transient.position - waveformOffset
                    const transientLocalUnit = mapSeconds(adjustedSeconds, markers)
                    if (transientLocalUnit === null) {continue}
                    const transientUnit = reader.offset + transientLocalUnit
                    const transientX = range.unitToX(transientUnit)
                    const distance = Math.abs(transientX - x)
                    if (distance <= MARKER_RADIUS) {
                        if (closest === null || distance < closest.distance) {
                            closest = {transient, distance}
                        }
                    } else if (transientX > x + MARKER_RADIUS) {
                        break // Past the capture zone, stop searching
                    }
                }
                return isNotNull(closest) ? closest.transient : null
            }
        })
}