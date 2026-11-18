import {afterEach, expect, it, vi} from "vitest"
import {AudioRegionBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import {AudioRegionBox} from "@opendaw/studio-boxes"
import {audioGestureFixture} from "@/ui/timeline/editors/audio/AudioEditorGestures.test-fixture"
import {regionFadeDrag} from "./RegionFadeDrag"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})

let fixture: ReturnType<typeof audioGestureFixture>
afterEach(() => fixture.close())

it.each([true, false])("restores the opposite fade on retreat (fade-in %s)", isFadeIn => {
    fixture = audioGestureFixture("region", {duration: 100})
    const {reader, editing, box} = fixture
    const region = reader.audioContent as AudioRegionBoxAdapter
    const {fading} = box as AudioRegionBox
    editing.modify(() => {fading.in.setValue(20); fading.out.setValue(30)})
    const read = () => [fading.in.getValue(), fading.out.getValue()]
    const drag = regionFadeDrag(region, isFadeIn, editing, x => x)
    const move = (x: number) => drag.update({...fixture.at(0), clientX: x})
    move(isFadeIn ? 110 : -10)
    expect(read()).toEqual(isFadeIn ? [100, 0] : [0, 100])
    move(isFadeIn ? -10 : 110)
    expect(read()).toEqual(isFadeIn ? [0, 30] : [20, 0])
    move(isFadeIn ? 20 : 70)
    expect(read()).toEqual([20, 30])
    move(60)
    drag.approve?.()
    const approved = isFadeIn ? [60, 30] : [20, 40]
    expect(read()).toEqual(approved)
    const {boxGraph} = ProjectSkeleton.decode(ProjectSkeleton.encode(box.graph))
    const restored = boxGraph.findBox(box.address.uuid).unwrap() as AudioRegionBox
    expect([restored.fading.in.getValue(), restored.fading.out.getValue()]).toEqual(approved)
    expect(editing.undo()).toBe(true)
    expect(read()).toEqual([20, 30])

    const cancelled = regionFadeDrag(region, isFadeIn, editing, x => x)
    cancelled.update({...fixture.at(0), clientX: isFadeIn ? 110 : -10})
    cancelled.cancel?.()
    expect(read()).toEqual([20, 30])
    expect(editing.undo()).toBe(true)
    expect(read()).toEqual([0, 0])
})
