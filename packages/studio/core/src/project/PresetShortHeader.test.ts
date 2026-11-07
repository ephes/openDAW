import {afterEach, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {PresetDecoder, PresetHeader, ProjectSkeleton} from "@opendaw/studio-adapters"
afterEach(() => vi.restoreAllMocks())
for (let length = 0; length < 8; length++) {
    it(`rejects preset length ${length} without touching the graph`, () => {
        vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
        const target = new Proxy({}, {get() {throw new Error("target touched")}})
        const bytes = new ArrayBuffer(length)
        if (length >= 4) {new DataView(bytes).setInt32(0, PresetHeader.MAGIC_HEADER_OPEN)}
        expect(PresetDecoder.decode(bytes, target as ProjectSkeleton)).toEqual([])
        const result = PresetDecoder.insertEffectChain(bytes, target as AudioUnitBox, 0, PresetHeader.ChainKind.Audio)
        expect(result.isFailure()).toBe(true)
        expect(RuntimeNotifier.info).toHaveBeenCalledTimes(1)
    })
}
