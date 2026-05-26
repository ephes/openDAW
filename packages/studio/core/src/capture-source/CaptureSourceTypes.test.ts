import {describe, expect, it} from "vitest"
import {CaptureSourceMetadata} from "./CaptureSourceTypes"

const exampleMetadata = (overrides: Partial<CaptureSourceMetadata> = {}): CaptureSourceMetadata => ({
    kind: "getUserMedia",
    label: "test",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    deviceChannels: 2,
    actualChannels: 2,
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
    ...overrides
})

describe("CaptureSourceMetadata.mismatches", () => {
    it("returns no mismatches when requested and actual match", () => {
        expect(CaptureSourceMetadata.mismatches(exampleMetadata())).toEqual([])
    })

    it("reports a sample-rate mismatch", () => {
        const mismatches = CaptureSourceMetadata.mismatches(exampleMetadata({actualSampleRate: 44100}))
        expect(mismatches).toHaveLength(1)
        expect(mismatches[0].kind).toBe("sample-rate")
        expect(mismatches[0].requested).toBe(48000)
        expect(mismatches[0].actual).toBe(44100)
    })

    it("reports a channel-count mismatch", () => {
        const mismatches = CaptureSourceMetadata.mismatches(exampleMetadata({actualChannels: 1}))
        expect(mismatches).toHaveLength(1)
        expect(mismatches[0].kind).toBe("channel-count")
    })

    it("reports auto-processing modifications", () => {
        const mismatches = CaptureSourceMetadata.mismatches(exampleMetadata({autoGainControl: true}))
        expect(mismatches.some(report => report.kind === "auto-processing-modified")).toBe(true)
    })

    it("treats actualChannels as the post-mapping count, distinct from deviceChannels", () => {
        const mismatches = CaptureSourceMetadata.mismatches(exampleMetadata({
            requestedChannels: 4,
            deviceChannels: 6,
            actualChannels: 4
        }))
        expect(mismatches.some(report => report.kind === "channel-count")).toBe(false)
    })

    it("reports multiple issues independently", () => {
        const mismatches = CaptureSourceMetadata.mismatches(exampleMetadata({
            actualSampleRate: 32000,
            actualChannels: 1,
            noiseSuppression: true
        }))
        expect(new Set(mismatches.map(report => report.kind))).toEqual(new Set([
            "sample-rate", "channel-count", "auto-processing-modified"
        ]))
    })
})
