import {BoxGraph} from "@opendaw/lib-box"
import {clamp, UUID} from "@opendaw/lib-std"
import {BoxIO, DelayDeviceBox, TrackBox, ValueClipBox, ValueEventBox, ValueEventCollectionBox, ValueEventCurveBox, ValueRegionBox} from "@opendaw/studio-boxes"

import {migrateValueEventBox} from "./MigrateValueEventBox"
import {migrateValueEventCollection} from "./MigrateValueEventCollection"

export const migrateDelayDeviceBox = (boxGraph: BoxGraph<BoxIO.TypeMap>, box: DelayDeviceBox): void => {
    if (box.version.getValue() !== 0) {return}
    // Old descending: 1/1, 1/2, 1/3, 1/4, 3/16, 1/6, 1/8, 3/32, 1/12, 1/16, 3/64, 1/24, 1/32, 1/48, 1/64, 1/96, 1/128
    // New ascending: off, 1/128, 1/96, 1/64, 1/48, 1/32, 1/24, 3/64, 1/16, 1/12, 3/32, 1/8, 1/6, 3/16, 1/4, 5/16, 1/3, 3/8, 7/16, 1/2, 1/1
    const oldToNewIndex = [20, 19, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    const oldMaxIndex = 16
    const newMaxIndex = 20
    const oldIndex = box.delayMusical.getValue()
    const newIndex = oldToNewIndex[Math.round(clamp(oldIndex, 0, oldMaxIndex))]
    console.debug(`Migrate 'DelayDeviceBox' delay index from ${oldIndex} to ${newIndex}`)
    boxGraph.beginTransaction()
    box.delayMusical.setValue(newIndex)
    box.delayMillis.setValue(0)
    box.preSyncTimeLeft.setValue(0)
    box.preMillisTimeLeft.setValue(0)
    box.preSyncTimeRight.setValue(0)
    box.preMillisTimeRight.setValue(0)
    box.version.setValue(1)
    const copiedCollections: Array<ValueEventCollectionBox> = []
    const collections = new Map<ValueEventCollectionBox, Array<ValueRegionBox | ValueClipBox>>()
    for (const {box: source} of box.delayMusical.pointerHub.incoming()) {
        if (!(source instanceof TrackBox)) continue
        for (const field of [source.regions, source.clips]) {
            for (const {box: content} of field.pointerHub.incoming()) {
                if (!(content instanceof ValueRegionBox || content instanceof ValueClipBox)) continue
                const collection = content.events.targetVertex.unwrapOrNull()?.box
                if (!(collection instanceof ValueEventCollectionBox)) continue
                const owners = collections.get(collection) ?? []
                owners.push(content)
                collections.set(collection, owners)
            }
        }
    }
    for (const [collection, owners] of collections) {
        let target = collection
        // Mirrored automation may also drive another parameter. Isolate this
        // delay's owners before remapping so each parameter keeps its meaning.
        if (collection.owners.pointerHub.incoming().some(pointer => !owners.some(owner => owner === pointer.box))) {
            target = ValueEventCollectionBox.create(boxGraph, UUID.generate())
            copiedCollections.push(target)
            for (const {box: event} of collection.events.pointerHub.incoming()) {
                if (!(event instanceof ValueEventBox)) continue
                const copy = ValueEventBox.create(boxGraph, UUID.generate(), copy => {
                    copy.events.refer(target.events)
                    copy.position.setValue(event.position.getValue())
                    copy.index.setValue(event.index.getValue())
                    copy.value.setValue(event.value.getValue())
                    copy.interpolation.setValue(event.interpolation.getValue())
                    copy.slope.setValue(event.slope.getValue())
                })
                for (const {box: curve} of event.interpolation.pointerHub.incoming()) {
                    if (curve instanceof ValueEventCurveBox) ValueEventCurveBox.create(boxGraph, UUID.generate(), box => {
                        box.event.refer(copy.interpolation)
                        box.slope.setValue(curve.slope.getValue())
                    })
                }
            }
            owners.forEach(owner => owner.events.refer(target.owners))
        }
        for (const {box: event} of target.events.pointerHub.incoming()) {
            if (!(event instanceof ValueEventBox)) continue
            const oldEventIndex = Math.round(event.value.getValue() * oldMaxIndex)
            event.value.setValue(oldToNewIndex[clamp(oldEventIndex, 0, oldMaxIndex)] / newMaxIndex)
        }
    }
    boxGraph.endTransaction()
    // New copies are absent from ProjectMigration's second-pass snapshot.
    for (const collection of copiedCollections) {
        migrateValueEventCollection(boxGraph, collection)
        for (const {box: event} of collection.events.pointerHub.incoming()) {
            if (event instanceof ValueEventBox) migrateValueEventBox(boxGraph, event)
        }
    }
}
