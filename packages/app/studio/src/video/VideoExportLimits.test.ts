import {expect, it} from "vitest"
import {validateVideoConfig} from "./VideoExportLimits"
const config = {width: 1280, height: 720, frameRate: 60, sampleRate: 48000, numberOfChannels: 2}
for (const duration of [NaN, Infinity, -1, 3601, Number.MAX_VALUE]) {
    it(`rejects invalid duration ${duration}`, () => {expect(() => validateVideoConfig(config, duration)).toThrow()})
}
for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160], [1080, 1920]]) {
    it(`admits preset ${width}x${height} and automatic/explicit duration`, () => {
        expect(() => validateVideoConfig({...config, width, height}, 0)).not.toThrow()
        expect(() => validateVideoConfig({...config, width, height, frameRate: 120}, 3600)).not.toThrow()
    })
}
