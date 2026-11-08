import {describe, expect, it} from "vitest"
import {asInstanceOf, UUID} from "@opendaw/lib-std"
import {
    AudioFileBoxAdapter, AudioPitchStretchBoxAdapter, AudioTimeStretchBoxAdapter,
    ProjectSkeleton, ValueEventCollectionBoxAdapter
} from "@opendaw/studio-adapters"
import {
    AudioFileBox, AudioPitchStretchBox, AudioRegionBox, AudioTimeStretchBox, AudioUnitBox,
    SelectionBox, TapeDeviceBox, TrackBox, TransientMarkerBox, ValueEventBox, ValueEventCollectionBox,
    ValueEventCurveBox, WarpMarkerBox
} from "@opendaw/studio-boxes"
import {ProjectMigration} from "../ProjectMigration"
import type {ProjectEnv} from "../ProjectEnv"
import {adapterContext, legacyBytes} from "./LegacyFixture"

const env = {sampleManager: {getOrCreate: () => { throw new Error("Synthetic fixture must not load audio") }}} as unknown as ProjectEnv
const empty = () => ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: true})
const id = (prefix: string, index: number) => UUID.parse(`${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`)

describe("two-pass value event graph migration", () => {
    it.each([true, false])("retains endpoint curves and removes dependents (collection first: %s)", async collectionFirst => {
        const original = empty(), graph = original.boxGraph
        graph.beginTransaction()
        const collection = ValueEventCollectionBox.create(graph, id(collectionFirst ? "00000000" : "ffffffff", 1))
        const previousCollection = original.mandatoryBoxes.timelineBox.tempoTrack.events.targetVertex.unwrap().box
        original.mandatoryBoxes.timelineBox.tempoTrack.events.refer(collection.owners)
        previousCollection.delete()
        const values = [0, 0.25, 0.5, 0.75, 1], slopes = [0.25, 0.2, 0.4, 0.8, 0.75]
        const events = values.map((value, index) => ValueEventBox.create(graph, id("88888888", index + 1), box => {
            box.events.refer(collection.events); box.position.setValue([0, 960, 960, 960, 1920][index])
            box.index.setValue([0, 0, 1, 2, 0][index]); box.value.setValue(value)
            box.interpolation.setValue(1); box.slope.setValue(slopes[index])
        }))
        const links = events.map(event => SelectionBox.create(graph, UUID.generate(), box => {
            box.selection.refer(original.mandatoryBoxes.userInterfaceBoxes[0].selection)
            box.selectable.refer(event)
        }).address.uuid)
        graph.endTransaction()
        let project = ProjectSkeleton.decode(legacyBytes(original, events.map(event => event.slope)))
        let previous: string | undefined
        for (let round = 0; round < 2; round++) {
            await ProjectMigration.migrate(env, project)
            const surviving = [0, 1, 3, 4]
            expect(project.boxGraph.findBox(events[2].address.uuid).isEmpty()).toBe(true)
            expect(project.boxGraph.findBox(links[2]).isEmpty()).toBe(true)
            const curves = project.boxGraph.boxes().filter(box => box instanceof ValueEventCurveBox)
            expect(curves).toHaveLength(4)
            for (const index of surviving) {
                const event = asInstanceOf(project.boxGraph.findBox(events[index].address.uuid).unwrap(), ValueEventBox)
                expect(event.index.getValue()).toBe(index === 3 ? 1 : 0)
                const curve = asInstanceOf(event.interpolation.pointerHub.incoming()[0].box, ValueEventCurveBox)
                expect(curve.slope.getValue()).toBeCloseTo(slopes[index], 6)
                expect(curve.event.targetAddress.unwrap().equals(event.interpolation.address)).toBe(true)
                expect(project.boxGraph.findBox(links[index]).nonEmpty()).toBe(true)
            }
            expect(project.boxGraph.findOrphans(project.mandatoryBoxes.rootBox)).toHaveLength(0)
            const context = adapterContext(project)
            const adapter = context.boxAdapters.adapterFor(
                asInstanceOf(project.boxGraph.findBox(collection.address.uuid).unwrap(), ValueEventCollectionBox), ValueEventCollectionBoxAdapter)
            // A curve's slope is its normalized midpoint height: independent endpoint oracle.
            expect(adapter.valueAt(480, -1)).toBeCloseTo(0 + 0.25 * (0.25 - 0), 6)
            expect(adapter.valueAt(1440, -1)).toBeCloseTo(0.75 + 0.8 * (1 - 0.75), 6)
            context.boxAdapters.terminate()
            const bytes = ProjectSkeleton.encode(project.boxGraph)
            const snapshot = JSON.stringify(project.boxGraph.toJSON())
            if (previous) expect(snapshot).toBe(previous)
            previous = snapshot
            project = ProjectSkeleton.decode(bytes)
        }
    })
})

const markerFixture = (kind: "pitch" | "time") => {
    const skeleton = empty(), graph = skeleton.boxGraph
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
        box.collection.refer(skeleton.mandatoryBoxes.rootBox.audioUnits); box.index.setValue(1)
    })
    TapeDeviceBox.create(graph, UUID.generate(), box => box.host.refer(unit.input))
    const track = TrackBox.create(graph, UUID.generate(), box => {
        box.tracks.refer(unit.tracks); box.target.refer(unit)
    })
    const file = AudioFileBox.create(graph, UUID.generate(), box => box.endInSeconds.setValue(1))
    const stretch = kind === "pitch" ? AudioPitchStretchBox.create(graph, UUID.generate())
        : AudioTimeStretchBox.create(graph, UUID.generate())
    const collection = ValueEventCollectionBox.create(graph, UUID.generate())
    AudioRegionBox.create(graph, UUID.generate(), box => {
        box.regions.refer(track.regions); box.file.refer(file); box.playMode.refer(stretch)
        box.duration.setValue(960); box.loopDuration.setValue(960)
        box.events.refer(collection.owners)
    })
    const transients = [0.25, 0.25, 0.75].map((position, index) => TransientMarkerBox.create(graph, id("11111111", index + 1), box => {
        box.owner.refer(file.transientMarkers); box.position.setValue(position)
    }).address.uuid)
    const warps = [0, 0, 960].map((position, index) => WarpMarkerBox.create(graph, id("22222222", index + 1), box => {
        box.owner.refer(stretch.warpMarkers); box.position.setValue(position); box.seconds.setValue(index / 2)
    }).address.uuid)
    graph.endTransaction()
    return {bytes: ProjectSkeleton.encode(graph), fileId: file.address.uuid, stretchId: stretch.address.uuid, transients, warps}
}

describe("audio marker repair reopen contract", () => {
    it.each(["pitch", "time"] as const)("repairs both marker types before %s adapters load, preserving identities", async kind => {
        const fixture = markerFixture(kind)
        let project = ProjectSkeleton.decode(fixture.bytes)
        let previous: string | undefined
        for (let round = 0; round < 2; round++) {
            await ProjectMigration.migrate(env, project)
            const context = adapterContext(project)
            const file = asInstanceOf(project.boxGraph.findBox(fixture.fileId).unwrap(), AudioFileBox)
            const fileAdapter = context.boxAdapters.adapterFor(file, AudioFileBoxAdapter)
            expect(fileAdapter.transients.asArray().map(marker => UUID.toString(marker.uuid)))
                .toEqual([fixture.transients[0], fixture.transients[2]].map(UUID.toString))
            const stretch = project.boxGraph.findBox(fixture.stretchId).unwrap()
            const markers = kind === "pitch"
                ? context.boxAdapters.adapterFor(asInstanceOf(stretch, AudioPitchStretchBox), AudioPitchStretchBoxAdapter).warpMarkers
                : context.boxAdapters.adapterFor(asInstanceOf(stretch, AudioTimeStretchBox), AudioTimeStretchBoxAdapter).warpMarkers
            expect(markers.asArray().map(marker => UUID.toString(marker.uuid)))
                .toEqual([fixture.warps[0], fixture.warps[2]].map(UUID.toString))
            expect(project.boxGraph.findBox(fixture.transients[1]).isEmpty()).toBe(true)
            expect(project.boxGraph.findBox(fixture.warps[1]).isEmpty()).toBe(true)
            context.boxAdapters.terminate()
            const bytes = ProjectSkeleton.encode(project.boxGraph)
            const snapshot = JSON.stringify(project.boxGraph.toJSON())
            if (previous) expect(snapshot).toBe(previous)
            previous = snapshot
            project = ProjectSkeleton.decode(bytes)
        }
    })
})
