import {describe, expect, it} from "vitest"
import {asInstanceOf, UUID} from "@opendaw/lib-std"
import {ProjectSkeleton, DelayDeviceBoxAdapter, VaporisateurDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {
    AudioUnitBox, DelayDeviceBox, MIDIControllerBox, TrackBox, ValueClipBox, ValueEventBox,
    ValueEventCollectionBox, ValueEventCurveBox, ValueRegionBox, VaporisateurDeviceBox
} from "@opendaw/studio-boxes"
import {migrateDelayDeviceBox} from "./MigrateDelayDeviceBox"
import {migrateVaporisateurDeviceBox} from "./MigrateVaporisateurDeviceBox"
import {ProjectMigration} from "../ProjectMigration"
import type {ProjectEnv} from "../ProjectEnv"
import {adapterContext, legacyBytes} from "./LegacyFixture"

const empty = () => ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: true})
const oldDurations = [1, 1/2, 1/3, 1/4, 3/16, 1/6, 1/8, 3/32, 1/12, 1/16, 3/64, 1/24, 1/32, 1/48, 1/64, 1/96, 1/128]

describe("serialized delay compatibility", () => {
    it.each(["region", "clip"] as const)("preserves all 17 static/automated durations through %s migration and reopen", kind => {
        const original = empty(), graph = original.boxGraph
        graph.beginTransaction()
        const delays = oldDurations.map((_duration, index) => {
            const delay = DelayDeviceBox.create(graph, UUID.generate(), box => {
                box.host.refer(original.mandatoryBoxes.primaryAudioUnitBox.audioEffects)
                box.index.setValue(index); box.version.setValue(0); box.delayMusical.setValue(index)
            })
            const track = TrackBox.create(graph, UUID.generate(), box => {
                box.tracks.refer(original.mandatoryBoxes.primaryAudioUnitBox.tracks)
                box.target.refer(delay.delayMusical); box.index.setValue(index)
            })
            const events = ValueEventCollectionBox.create(graph, UUID.generate())
            if (kind === "region") ValueRegionBox.create(graph, UUID.generate(), box => {
                box.regions.refer(track.regions); box.events.refer(events.owners)
                box.duration.setValue(960); box.loopDuration.setValue(960)
            })
            else ValueClipBox.create(graph, UUID.generate(), box => {
                box.clips.refer(track.clips); box.events.refer(events.owners); box.duration.setValue(960)
            })
            // Exercise shared region/clip ownership without double remapping.
            if (index === 0) {
                if (kind === "region") ValueClipBox.create(graph, UUID.generate(), box => {
                    box.clips.refer(track.clips); box.events.refer(events.owners); box.duration.setValue(960)
                })
                else ValueRegionBox.create(graph, UUID.generate(), box => {
                    box.regions.refer(track.regions); box.events.refer(events.owners)
                    box.duration.setValue(960); box.loopDuration.setValue(960)
                })
            }
            const event = ValueEventBox.create(graph, UUID.generate(), box => {
                box.events.refer(events.events); box.value.setValue(index / 16)
            })
            return {delay: delay.address.uuid, event: event.address.uuid, track: track.address.uuid}
        })
        // Unrelated automation must stay attached and unchanged.
        const unrelated = TrackBox.create(graph, UUID.generate(), box => {
            box.tracks.refer(original.mandatoryBoxes.primaryAudioUnitBox.tracks)
            box.target.refer(asInstanceOf(graph.findBox(delays[0].delay).unwrap(), DelayDeviceBox).feedback)
            box.index.setValue(17)
        })
        const otherEvents = ValueEventCollectionBox.create(graph, UUID.generate())
        ValueRegionBox.create(graph, UUID.generate(), box => {
            box.regions.refer(unrelated.regions); box.events.refer(otherEvents.owners)
            box.duration.setValue(960); box.loopDuration.setValue(960)
        })
        const otherEvent = ValueEventBox.create(graph, UUID.generate(), box => {
            box.events.refer(otherEvents.events); box.value.setValue(0.375)
        })
        graph.endTransaction()
        let project = ProjectSkeleton.decode(ProjectSkeleton.encode(graph))
        for (let round = 0; round < 2; round++) {
            for (const {delay} of delays) migrateDelayDeviceBox(project.boxGraph,
                asInstanceOf(project.boxGraph.findBox(delay).unwrap(), DelayDeviceBox))
            const context = adapterContext(project)
            for (const [index, ids] of delays.entries()) {
                const delay = asInstanceOf(project.boxGraph.findBox(ids.delay).unwrap(), DelayDeviceBox)
                const event = asInstanceOf(project.boxGraph.findBox(ids.event).unwrap(), ValueEventBox)
                const adapter = context.boxAdapters.adapterFor(delay, DelayDeviceBoxAdapter)
                const fraction = (value: number) => {
                    const [n, d] = DelayDeviceBoxAdapter.Fractions[value]
                    return n / d
                }
                expect(fraction(adapter.namedParameter.delay.getValue())).toBeCloseTo(oldDurations[index], 8)
                expect(fraction(adapter.namedParameter.delay.valueMapping.y(event.value.getValue())))
                    .toBeCloseTo(oldDurations[index], 8)
                expect(asInstanceOf(project.boxGraph.findBox(ids.track).unwrap(), TrackBox).target.targetAddress.unwrap()
                    .equals(delay.delayMusical.address)).toBe(true)
                expect(delay.version.getValue()).toBe(1)
            }
            expect(asInstanceOf(project.boxGraph.findBox(unrelated.address.uuid).unwrap(), TrackBox)
                .target.targetAddress.unwrap().equals(unrelated.target.targetAddress.unwrap())).toBe(true)
            expect(asInstanceOf(project.boxGraph.findBox(otherEvent.address.uuid).unwrap(), ValueEventBox).value.getValue()).toBe(0.375)
            context.boxAdapters.terminate()
            project = ProjectSkeleton.decode(ProjectSkeleton.encode(project.boxGraph))
        }
    })
})

describe("serialized Vaporisateur compatibility", () => {
    it.each([0, 1])("moves every incoming pointer from v%i and remains stable on reopen", version => {
        const original = empty(), graph = original.boxGraph
        graph.beginTransaction()
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
            box.collection.refer(original.mandatoryBoxes.rootBox.audioUnits)
            box.index.setValue(1)
        })
        const vapor = VaporisateurDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(unit.input)
            box.version.setValue(version); box.volume.setValue(version === 0 ? -6 : -21)
            box.waveform.setValue(2); box.octave.setValue(-1); box.tune.setValue(123)
        })
        const fields = [vapor.waveform, vapor.octave, vapor.tune, vapor.volume]
        const tracks = fields.map((field, index) => TrackBox.create(graph, UUID.generate(), box => {
            box.tracks.refer(unit.tracks); box.target.refer(field); box.index.setValue(index)
        }).address.uuid)
        const pointers = fields.map((field, index) => [0, 1, 2].map(control => MIDIControllerBox.create(graph, UUID.generate(), box => {
            box.controllers.refer(original.mandatoryBoxes.userInterfaceBoxes[0].midiControllers)
            box.parameter.refer(field); box.controlId.setValue(index * 3 + control)
        }).address.uuid))
        graph.endTransaction()
        let project = ProjectSkeleton.decode(legacyBytes(original, fields))
        for (let round = 0; round < 2; round++) {
            const box = asInstanceOf(project.boxGraph.findBox(vapor.address.uuid).unwrap(), VaporisateurDeviceBox)
            migrateVaporisateurDeviceBox(project.boxGraph, box)
            expect(box.version.getValue()).toBe(2)
            const [oscA, oscB] = box.oscillators.fields()
            const targets = [oscA.waveform, oscA.octave, oscA.tune, oscA.volume]
            tracks.forEach((id, index) => {
                expect(asInstanceOf(project.boxGraph.findBox(id).unwrap(), TrackBox).target.targetAddress.unwrap()
                    .equals(targets[index].address)).toBe(true)
                expect(targets[index].pointerHub.incoming()).toHaveLength(4)
            })
            pointers.forEach((ids, index) => ids.forEach(id => {
                const controller = asInstanceOf(project.boxGraph.findBox(id).unwrap(), MIDIControllerBox)
                expect(controller.parameter.targetAddress.unwrap().equals(targets[index].address)).toBe(true)
            }))
            const context = adapterContext(project)
            const adapter = context.boxAdapters.adapterFor(box, VaporisateurDeviceBoxAdapter)
            const parameters = adapter.namedParameter.oscillators[0]
            expect([parameters.waveform.getValue(), parameters.octave.getValue(), parameters.tune.getValue(), parameters.volume.getValue()])
                .toEqual([2, -1, 123, -21])
            expect(oscB.volume.getValue()).toBe(-Infinity)
            context.boxAdapters.terminate()
            project = ProjectSkeleton.decode(ProjectSkeleton.encode(project.boxGraph))
        }
    })
})


describe("delay automation shared across parameter targets", () => {
    it.each(["delay", "feedback"])("isolates a collection also owned by another %s target", async other => {
        const original = empty(), graph = original.boxGraph
        graph.beginTransaction()
        const delays = [0, 1].map(index => DelayDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(original.mandatoryBoxes.primaryAudioUnitBox.audioEffects)
            box.index.setValue(index); box.version.setValue(0)
        }))
        const collection = ValueEventCollectionBox.create(graph, UUID.generate())
        const legacy = ValueEventBox.create(graph, UUID.generate(), box => {
            box.events.refer(collection.events); box.value.setValue(4 / 16); box.slope.setValue(0.25)
        })
        const modern = ValueEventBox.create(graph, UUID.generate(), box => {
            box.events.refer(collection.events); box.position.setValue(960); box.value.setValue(8 / 16)
        })
        ValueEventCurveBox.create(graph, UUID.generate(), box => {
            box.event.refer(modern.interpolation); box.slope.setValue(0.75)
        })
        const regions = delays.map((delay, index) => {
            const track = TrackBox.create(graph, UUID.generate(), box => {
                box.tracks.refer(original.mandatoryBoxes.primaryAudioUnitBox.tracks); box.index.setValue(index)
                box.target.refer(index === 0 || other === "delay" ? delay.delayMusical : delay.feedback)
            })
            return ValueRegionBox.create(graph, UUID.generate(), box => {
                box.regions.refer(track.regions); box.events.refer(collection.owners)
                box.duration.setValue(960); box.loopDuration.setValue(960)
            }).address.uuid
        })
        graph.endTransaction()
        let project = ProjectSkeleton.decode(legacyBytes(original, [legacy.slope]))
        for (let round = 0; round < 2; round++) {
            await ProjectMigration.migrate({} as ProjectEnv, project)
            const normalized = regions.map(uuid => {
                const region = asInstanceOf(project.boxGraph.findBox(uuid).unwrap(), ValueRegionBox)
                const events = asInstanceOf(region.events.targetVertex.unwrap().box, ValueEventCollectionBox)
                const ordered = events.events.pointerHub.incoming().map(({box}) => asInstanceOf(box, ValueEventBox))
                    .sort((a, b) => a.position.getValue() - b.position.getValue())
                expect(ordered).toHaveLength(2)
                expect(asInstanceOf(ordered[0].interpolation.pointerHub.incoming()[0].box, ValueEventCurveBox).slope.getValue()).toBe(0.25)
                expect(asInstanceOf(ordered[1].interpolation.pointerHub.incoming()[0].box, ValueEventCurveBox).slope.getValue()).toBe(0.75)
                return ordered[0].value.getValue()
            })
            // Old choice index 4 (3/16) becomes new index 13 of 20.
            expect(normalized[0]).toBeCloseTo(13 / 20, 6)
            expect(normalized[1]).toBeCloseTo(other === "delay" ? 13 / 20 : 4 / 16, 6)
            project = ProjectSkeleton.decode(ProjectSkeleton.encode(project.boxGraph))
        }
    })
})
