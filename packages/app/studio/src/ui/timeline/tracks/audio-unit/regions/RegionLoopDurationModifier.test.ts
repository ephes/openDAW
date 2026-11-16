import {afterEach, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {UnionAdapterTypes} from "@opendaw/studio-adapters"
import {RegionLoopDurationModifier} from "./RegionLoopDurationModifier"

vi.mock("@opendaw/studio-core", () => ({RegionModifyStrategy: {Identity: {}}}))
afterEach(() => vi.restoreAllMocks())

it.each([1000, 10000])("approval avoids whole-track diagnostic reads with %s unrelated regions", count => {
    vi.spyOn(UnionAdapterTypes, "isLoopableRegion").mockReturnValue(true)
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    let reads = 0
    const unrelated = Array.from({length: count}, () => ({get position() {reads++; return 0}, duration: 100, complete: 100}))
    const collection = {asArray: vi.fn(() => unrelated), greaterEqual: () => null}
    const track = {regions: {collection}}
    const region = {position: 0, complete: 1000, duration: 1000, loopDuration: 1000, loopOffset: 0,
        canResize: true, trackBoxAdapter: Option.wrap(track), box: {isAttached: () => true}}
    const apply = vi.fn((_tracks, _regions, _modifier, _delta, mutate: () => void) => mutate())
    const construct = {project: {overlapResolver: {apply}}, element: document.createElement("canvas"),
        snapping: {computeDelta: () => 100}, pointerPulse: 0, reference: region, resize: false}
    const tool = RegionLoopDurationModifier.create([region] as unknown as Parameters<typeof RegionLoopDurationModifier.create>[0],
        construct as unknown as Parameters<typeof RegionLoopDurationModifier.create>[1]).unwrap()
    tool.approve()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(collection.asArray).not.toHaveBeenCalled()
    expect(reads).toBe(0)
    expect(debug).not.toHaveBeenCalled()
})
