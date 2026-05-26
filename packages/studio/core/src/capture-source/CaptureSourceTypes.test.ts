import {describe, expect, it} from "vitest"
import {CaptureSourceMetadata} from "./CaptureSourceTypes"

const exampleMetadata = (overrides: Partial<CaptureSourceMetadata> = {}): CaptureSourceMetadata => ({
    kind: "getUserMedia",
    label: "test",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2,
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
    ...overrides
})

describe("CaptureSourceMetadata.toLongRecordingSource", () => {
    it("maps to a LongRecordingSource-shaped object preserving requested vs actual", () => {
        const source = CaptureSourceMetadata.toLongRecordingSource(exampleMetadata({
            actualSampleRate: 44100,
            actualChannels: 1,
            label: "my-mic"
        }))
        expect(source.kind).toBe("getUserMedia")
        expect(source.label).toBe("my-mic")
        expect(source.requestedSampleRate).toBe(48000)
        expect(source.actualSampleRate).toBe(44100)
        expect(source.requestedChannels).toBe(2)
        expect(source.actualChannels).toBe(1)
    })
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
